# Sakshya deploy: build -> package -> private S3 -> SSM -> pm2 on EC2.  No SSH, no keys. Secrets never printed.
#   .\infra\06-deploy.ps1                 (build + deploy)
#   .\infra\06-deploy.ps1 -Migrate        (also apply db/schema.sql + seed on RDS; first deploy)
#   .\infra\06-deploy.ps1 -SkipBuild      (re-deploy the last build)
param([switch]$Migrate, [switch]$SkipBuild)
$ErrorActionPreference = "Stop"
$aws = "C:\Users\Predator\AppData\Roaming\Python\Python313\Scripts\aws.cmd"
$Root = Split-Path $PSScriptRoot -Parent
$state = Get-Content (Join-Path $PSScriptRoot "aws-state.json") -Raw | ConvertFrom-Json
function Aws {
  $ErrorActionPreference = "Continue"
  $o = & $aws @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed: $($o | Out-String)" }
  $s = ($o | Out-String).Trim(); if ($s -eq 'None' -or $s -eq 'null') { $s = '' }; return $s
}
function Env-Value($key) { $t = Get-Content (Join-Path $Root ".env.local") -Raw; $m = [regex]::Match($t, "(?m)^$key=(.+)$"); if ($m.Success) { $m.Groups[1].Value.Trim() } else { throw "$key missing in .env.local" } }
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Set-Location $Root

# ---- 1. build
if (-not $SkipBuild) {
  Write-Host "Building..."
  $env:NEXT_TELEMETRY_DISABLED = "1"
  & npm.cmd run build 2>&1 | Select-Object -Last 6 | ForEach-Object { "  $_" }
  if ($LASTEXITCODE -ne 0) { throw "build failed" }
}
if (-not (Test-Path ".next\standalone\server.js")) { throw "no standalone build found" }

# ---- 2. package (standalone server + static assets + public + schema + migrate script + demo identities)
$pkg = Join-Path $Root ".deploy\pkg"
if (Test-Path ".deploy") { Remove-Item ".deploy" -Recurse -Force }
New-Item -ItemType Directory -Force $pkg | Out-Null
& robocopy ".next\standalone" $pkg /E /NFL /NDL /NJH /NJS /NP /XD ".data" | Out-Null
New-Item -ItemType Directory -Force "$pkg\.next" | Out-Null
& robocopy ".next\static" "$pkg\.next\static" /E /NFL /NDL /NJH /NJS /NP | Out-Null
if (Test-Path "public") { & robocopy "public" "$pkg\public" /E /NFL /NDL /NJH /NJS /NP | Out-Null }
Copy-Item "db\schema.sql" "$pkg\schema.sql"; Copy-Item "scripts\migrate.mjs" "$pkg\migrate.mjs"
$demoJson = (& npx.cmd tsx -e "import {DEMO_USERS} from './lib/demo-users'; process.stdout.write(JSON.stringify(DEMO_USERS))") -join ""
[IO.File]::WriteAllText("$pkg\demo-users.json", $demoJson, (New-Object Text.UTF8Encoding($false)))   # UTF-8 WITHOUT a byte-order mark
$tgz = Join-Path $Root ".deploy\release-$stamp.tgz"
$winTar = Join-Path $env:SystemRoot "System32\tar.exe"   # Windows' own bsdtar (Git Bash's GNU tar mis-parses D:\ paths)
& $winTar -czf $tgz -C $pkg .
Write-Host ("Package: {0:N1} MB" -f ((Get-Item $tgz).Length / 1MB))

# ---- 3. production environment file (kept in the private deploy bucket; read only by the instance role)
$rds = Aws rds describe-db-instances --db-instance-identifier sakshya-db --query "DBInstances[0].Endpoint.Address" --output text
$sepolia = Get-Content (Join-Path $Root "contracts\deployments\sepolia.json") -Raw | ConvertFrom-Json
$cenv = Get-Content (Join-Path $Root "contracts\.env") -Raw
$sepoliaKey = [regex]::Match($cenv, "(?m)^SEPOLIA_DEPLOYER_PRIVATE_KEY=(.+)$").Groups[1].Value.Trim()   # testnet-only key; never printed
if (-not $sepoliaKey) { throw "SEPOLIA_DEPLOYER_PRIVATE_KEY missing in contracts/.env" }
$appPw = Env-Value "APP_DB_PASSWORD"; $ancPw = Env-Value "ANCHOR_DB_PASSWORD"; $admPw = Env-Value "ADMIN_DB_PASSWORD"
$lines = @(
  "NODE_ENV=production", "PORT=3000", "HOSTNAME=0.0.0.0", "AWS_REGION=ap-south-1",
  "DATABASE_URL=postgres://app_user:$appPw@${rds}:5432/sakshya",
  "ANCHOR_DATABASE_URL=postgres://app_anchor:$ancPw@${rds}:5432/sakshya",
  "ADMIN_DATABASE_URL=postgres://sakshya_admin:$admPw@${rds}:5432/sakshya",
  "APP_DB_PASSWORD=$appPw", "ANCHOR_DB_PASSWORD=$ancPw",
  "PGSSL_CA_FILE=/opt/app/certs/rds-global-bundle.pem",
  "SESSION_SECRET=$(Env-Value 'SESSION_SECRET')", "PQC_KEM_SEED=$(Env-Value 'PQC_KEM_SEED')", "PQC_DSA_SEED=$(Env-Value 'PQC_DSA_SEED')",
  "ACTOR_HASH_SALT=$(Env-Value 'ACTOR_HASH_SALT')",
  "COGNITO_USER_POOL_ID=$($state.cognitoUserPoolId)", "COGNITO_CLIENT_ID=$($state.cognitoClientId)",
  "S3_EVIDENCE_BUCKET=$($state.s3Bucket)", "SAKSHYA_DEMO_ATTACK=1",
  "QS_CHAIN=sepolia", "QS_REGISTRY_ADDRESS=$($sepolia.address)", "QS_CHAIN_SIGNER_PRIVATE_KEY=$sepoliaKey"
)
$envFile = Join-Path $Root ".deploy\production.env"
[IO.File]::WriteAllText($envFile, ($lines -join "`n"), (New-Object Text.UTF8Encoding($false)))

# ---- 4. upload
$b = $state.deployBucket
Aws s3 cp $tgz "s3://$b/releases/release-$stamp.tgz" --only-show-errors | Out-Null
Aws s3 cp $envFile "s3://$b/env/production.env" --only-show-errors --sse AES256 | Out-Null
Remove-Item $envFile -Force
Write-Host "Uploaded release-$stamp.tgz"

# ---- 5. activate on the instance through SSM
$migrateCmd = if ($Migrate) { 'cd /opt/app/current && set -a && . /opt/app/shared/production.env && set +a && node migrate.mjs' } else { 'echo "migration skipped"' }
$cmds = @(
  "set -e",
  "until [ -f /opt/app/READY ]; do sleep 5; done",
  "mkdir -p /opt/app/releases/$stamp && cd /opt/app/releases/$stamp",
  "aws s3 cp s3://$b/releases/release-$stamp.tgz /tmp/release.tgz --only-show-errors && tar -xzf /tmp/release.tgz -C /opt/app/releases/$stamp && rm /tmp/release.tgz",
  "aws s3 cp s3://$b/env/production.env /opt/app/shared/production.env --only-show-errors && chmod 600 /opt/app/shared/production.env",
  "ln -sfn /opt/app/releases/$stamp /opt/app/current",
  $migrateCmd,
  "cd /opt/app/current && (pm2 delete sakshya >/dev/null 2>&1 || true)",
  "cd /opt/app/current && pm2 start server.js --name sakshya --node-args=\`"--env-file=/opt/app/shared/production.env\`" && pm2 save",
  "sleep 4 && curl -s -o /dev/null -w 'local health: HTTP %{http_code}\n' http://localhost:3000/api/auth/session",
  "ls -1dt /opt/app/releases/* | tail -n +4 | xargs -r rm -rf"
)
$json = @{ commands = $cmds } | ConvertTo-Json -Compress
$jf = New-TemporaryFile; Set-Content $jf $json -Encoding ascii
$cid = Aws ssm send-command --instance-ids $state.webInstanceId --document-name AWS-RunShellScript --parameters "file://$($jf.FullName)" --timeout-seconds 900 --query Command.CommandId --output text
Remove-Item $jf -Force
Write-Host "Deploying (command $cid)..."
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 8
  $st = Aws ssm get-command-invocation --command-id $cid --instance-id $state.webInstanceId --query Status --output text
  if ($st -in @("Success", "Failed", "Cancelled", "TimedOut")) { break }
}
Write-Host "Status: $st"
$out = Aws ssm get-command-invocation --command-id $cid --instance-id $state.webInstanceId --query "[StandardOutputContent,StandardErrorContent]" --output text
$out -replace "(?i)(password|secret|seed)=\S+", '$1=***' | Select-Object -Last 40
if ($st -ne "Success") { throw "deploy did not succeed" }
