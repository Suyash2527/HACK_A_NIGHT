# Sakshya AWS setup, part 3: Cognito user pool + app client + the 8 demo users. Idempotent.
# Cognito only AUTHENTICATES (email + password). Roles/stations live in our database and are looked up by email.
$ErrorActionPreference = "Stop"
$aws = "C:\Users\Predator\AppData\Roaming\Python\Python313\Scripts\aws.cmd"
$Root = Split-Path $PSScriptRoot -Parent
$StateFile = Join-Path $PSScriptRoot "aws-state.json"
$state = Get-Content $StateFile -Raw | ConvertFrom-Json
function Save-State($k, $v) { $state | Add-Member -NotePropertyName $k -NotePropertyValue $v -Force; $state | ConvertTo-Json -Depth 5 | Set-Content $StateFile -Encoding utf8 }
function Aws {
  $ErrorActionPreference = "Continue"
  $o = & $aws @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed: $($o | Out-String)" }
  $s = ($o | Out-String).Trim(); if ($s -eq 'None' -or $s -eq 'null') { $s = '' }; return $s
}
function Env-Value($key) { $t = Get-Content (Join-Path $Root ".env.local") -Raw; $m = [regex]::Match($t, "(?m)^$key=(.+)$"); if ($m.Success) { $m.Groups[1].Value.Trim() } else { $null } }
function Set-Env($key, $value) { $f = Join-Path $Root ".env.local"; $t = Get-Content $f -Raw; if ($t -match "(?m)^$key=") { $t = [regex]::Replace($t, "(?m)^$key=.*$", "$key=$value") } else { $t = $t.TrimEnd() + "`n$key=$value`n" }; Set-Content $f $t -NoNewline -Encoding utf8 }

$demoPw = Env-Value "DEMO_PASSWORD"
if (-not $demoPw) { throw "DEMO_PASSWORD missing in .env.local (run: npm run init:env)" }

# ---- user pool
$pool = Aws cognito-idp list-user-pools --max-results 30 --query "UserPools[?Name=='sakshya-users'].Id" --output text
if (-not $pool) {
  $policy = @{ PasswordPolicy = @{ MinimumLength = 10; RequireUppercase = $false; RequireLowercase = $false; RequireNumbers = $false; RequireSymbols = $false } } | ConvertTo-Json -Depth 4 -Compress
  $pf = New-TemporaryFile; Set-Content $pf $policy -Encoding ascii
  $pool = Aws cognito-idp create-user-pool --pool-name sakshya-users --policies "file://$($pf.FullName)" --username-attributes email `
    --admin-create-user-config "AllowAdminCreateUserOnly=true" --mfa-configuration OFF --user-pool-tags "project=sakshya" --query UserPool.Id --output text
  Remove-Item $pf -Force; Write-Host "Created user pool $pool"
} else { Write-Host "User pool exists: $pool" }

# ---- app client (public, no secret; server-side USER_PASSWORD_AUTH)
$client = Aws cognito-idp list-user-pool-clients --user-pool-id $pool --query "UserPoolClients[?ClientName=='sakshya-web'].ClientId" --output text
if (-not $client) {
  $client = Aws cognito-idp create-user-pool-client --user-pool-id $pool --client-name sakshya-web --no-generate-secret `
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH --prevent-user-existence-errors ENABLED `
    --access-token-validity 60 --id-token-validity 60 --refresh-token-validity 1 --token-validity-units "AccessToken=minutes,IdToken=minutes,RefreshToken=days" `
    --query UserPoolClient.ClientId --output text
  Write-Host "Created app client $client"
} else { Write-Host "App client exists: $client" }

# ---- demo users (same fictional identities as lib/demo-users.ts)
$emails = @("police","lab","prosecutor","judge","admin","advocate","complainant","police2","police3") | ForEach-Object { "$_@sakshya.demo" }
foreach ($e in $emails) {
  $has = $true
  try { Aws cognito-idp admin-get-user --user-pool-id $pool --username $e | Out-Null } catch { $has = $false }
  if (-not $has) {
    Aws cognito-idp admin-create-user --user-pool-id $pool --username $e --message-action SUPPRESS --user-attributes "Name=email,Value=$e" "Name=email_verified,Value=true" | Out-Null
  }
  Aws cognito-idp admin-set-user-password --user-pool-id $pool --username $e --password $demoPw --permanent | Out-Null
  Write-Host "  user ready: $e"
}
Save-State cognitoUserPoolId $pool; Save-State cognitoClientId $client
Set-Env "COGNITO_USER_POOL_ID" $pool; Set-Env "COGNITO_CLIENT_ID" $client; Set-Env "AWS_REGION" "ap-south-1"

# ---- prove a real sign-in works (token is discarded, never printed)
$auth = Aws cognito-idp initiate-auth --client-id $client --auth-flow USER_PASSWORD_AUTH --auth-parameters "USERNAME=police@sakshya.demo,PASSWORD=$demoPw" --query "AuthenticationResult.TokenType" --output text
Write-Host "Test sign-in as police@sakshya.demo: $auth token issued"
