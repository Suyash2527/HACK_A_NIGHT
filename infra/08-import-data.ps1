# Load the fictional case folders into the LIVE system (RDS + S3) by running the importer on the EC2 instance through SSM.
#   .\infra\08-import-data.ps1                 (data\cases, chain DISABLED for the import; the server anchors the batch afterwards)
#   .\infra\08-import-data.ps1 -Dir data\cases -Check     (validate the manifest only, nothing imported)
# Why chain-disabled: ~120 documents x 3 transactions at 12 s/block would take over an hour. Integrity of imported files is still
# anchored on-chain: the running server (instrumentation.ts) puts them into ONE Merkle batch within a minute.
# Every document goes through the normal upload path (encrypted in parts, ML-DSA signed, audited), so nothing is inserted "behind the app".
param([string]$Dir = "data\cases", [switch]$Check)
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
Set-Location $Root
$dataDir = Join-Path $Root $Dir
if (-not (Test-Path (Join-Path $dataDir "manifest.csv"))) { throw "No manifest.csv in $dataDir (run npm run merge:data first)" }

# 1. validate locally first - the same rules the server will apply
& npm.cmd run import:cases -- $Dir --check
if ($LASTEXITCODE -ne 0) { throw "manifest validation failed; fix the data first" }
if ($Check) { return }

# 2. bundle the importer (all of its dependencies except the embedded database) and the data
$work = Join-Path $Root ".deploy\import"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force $work | Out-Null
& npx.cmd esbuild scripts/import-cases.mts --bundle --platform=node --format=esm --outfile="$work\import-cases.mjs" --external:@electric-sql/pglite --external:pg-native --log-level=warning
if ($LASTEXITCODE -ne 0) { throw "bundling the importer failed" }
$winTar = Join-Path $env:SystemRoot "System32\tar.exe"
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$pack = Join-Path $work "import-$stamp.tgz"
Copy-Item $dataDir "$work\cases" -Recurse
& $winTar -czf $pack -C $work import-cases.mjs cases
Write-Host ("Package: {0:N1} MB" -f ((Get-Item $pack).Length / 1MB))
$b = $state.deployBucket
Aws s3 cp $pack "s3://$b/imports/import-$stamp.tgz" --only-show-errors | Out-Null

# 3. run it on the server against RDS + S3, chain disabled
$cmds = @(
  "set -e",
  "rm -rf /tmp/sakshya-import && mkdir -p /tmp/sakshya-import && cd /tmp/sakshya-import",
  "aws s3 cp s3://$b/imports/import-$stamp.tgz /tmp/sakshya-import/p.tgz --only-show-errors && tar -xzf p.tgz",
  "cp import-cases.mjs /opt/app/current/import-cases.mjs",
  "cd /opt/app/current && set -a && . /opt/app/shared/production.env && set +a && unset QS_CHAIN QS_REGISTRY_ADDRESS QS_CHAIN_SIGNER_PRIVATE_KEY",
  "cd /opt/app/current && node import-cases.mjs /tmp/sakshya-import/cases",
  "rm -rf /tmp/sakshya-import /opt/app/current/import-cases.mjs"
)
$json = @{ commands = $cmds } | ConvertTo-Json -Compress
$jf = New-TemporaryFile; Set-Content $jf $json -Encoding ascii
$cid = Aws ssm send-command --instance-ids $state.webInstanceId --document-name AWS-RunShellScript --parameters "file://$($jf.FullName)" --timeout-seconds 3000 --query Command.CommandId --output text
Remove-Item $jf -Force
Write-Host "Importing on the server (command $cid)..."
for ($i = 0; $i -lt 300; $i++) {
  Start-Sleep -Seconds 10
  $st = Aws ssm get-command-invocation --command-id $cid --instance-id $state.webInstanceId --query Status --output text
  if ($st -in @("Success", "Failed", "Cancelled", "TimedOut")) { break }
}
Write-Host "Status: $st"
$out = Aws ssm get-command-invocation --command-id $cid --instance-id $state.webInstanceId --query "[StandardOutputContent,StandardErrorContent]" --output text
$out -replace "(?i)(password|secret|seed)=\S+", '$1=***' | Select-Object -Last 70
if ($st -ne "Success") { throw "import did not succeed" }
