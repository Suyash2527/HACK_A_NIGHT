# Sakshya AWS setup, part 2: security groups + private RDS PostgreSQL 17. Idempotent. Passwords go to .env.local, never printed.
$ErrorActionPreference = "Stop"
$aws = "C:\Users\Predator\AppData\Roaming\Python\Python313\Scripts\aws.cmd"
$Region = "ap-south-1"
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
function New-Secret($len) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $len -SetSeed ([Environment]::TickCount) | ForEach-Object { [char]$_ }) }
function Ensure-Env($key, $makeValue) {
  $f = Join-Path $Root ".env.local"; $txt = if (Test-Path $f) { Get-Content $f -Raw } else { "" }
  if ($txt -match "(?m)^$key=.+") { return ([regex]::Match($txt, "(?m)^$key=(.+)$").Groups[1].Value.Trim()) }
  $v = & $makeValue; Add-Content $f ("{0}{1}={2}" -f $(if ($txt -and -not $txt.EndsWith("`n")) { "`n" } else { "" }), $key, $v); return $v
}
function SecureToken($n) { $b = New-Object byte[] $n; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]', '').Substring(0, [Math]::Min($n, 30)) }

$vpc = Aws ec2 describe-vpcs --filters "Name=isDefault,Values=true" --query "Vpcs[0].VpcId" --output text
Write-Host "Default VPC $vpc"

# ---- security groups: web (CloudFront -> :3000) and db (only the web SG -> :5432)
function Ensure-Sg($name, $desc) {
  $id = Aws ec2 describe-security-groups --filters "Name=group-name,Values=$name" "Name=vpc-id,Values=$vpc" --query "SecurityGroups[0].GroupId" --output text
  if (-not $id) { $id = Aws ec2 create-security-group --group-name $name --description $desc --vpc-id $vpc --tag-specifications "ResourceType=security-group,Tags=[{Key=project,Value=sakshya}]" --query GroupId --output text; Write-Host "Created SG $name -> $id" }
  return $id
}
$webSg = Ensure-Sg "sakshya-web-sg" "Sakshya web: CloudFront origin only"
$dbSg  = Ensure-Sg "sakshya-db-sg"  "Sakshya database: web tier only"
$pl = Aws ec2 describe-managed-prefix-lists --filters "Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing" --query "PrefixLists[0].PrefixListId" --output text
try { Aws ec2 authorize-security-group-ingress --group-id $webSg --ip-permissions "IpProtocol=tcp,FromPort=3000,ToPort=3000,PrefixListIds=[{PrefixListId=$pl}]" | Out-Null } catch { if ("$_" -notmatch "Duplicate") { throw } }
try { Aws ec2 authorize-security-group-ingress --group-id $dbSg --ip-permissions "IpProtocol=tcp,FromPort=5432,ToPort=5432,UserIdGroupPairs=[{GroupId=$webSg}]" | Out-Null } catch { if ("$_" -notmatch "Duplicate") { throw } }
Save-State vpcId $vpc; Save-State webSgId $webSg; Save-State dbSgId $dbSg; Save-State cloudfrontPrefixList $pl
Write-Host "Security groups ready (db accepts 5432 ONLY from the web tier)"

# ---- RDS subnet group (default VPC subnets)
$subnets = (Aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpc" --query "Subnets[].SubnetId" --output text) -split "\s+"
$sg = Aws rds describe-db-subnet-groups --query "DBSubnetGroups[?DBSubnetGroupName=='sakshya-db-subnets'].DBSubnetGroupName" --output text
if (-not $sg) { Aws rds create-db-subnet-group --db-subnet-group-name sakshya-db-subnets --db-subnet-group-description "Sakshya DB" --subnet-ids @subnets | Out-Null; Write-Host "Created DB subnet group" }

# ---- RDS PostgreSQL 17 (private)
$adminPw = Ensure-Env "ADMIN_DB_PASSWORD" { SecureToken 30 }
Ensure-Env "APP_DB_PASSWORD" { SecureToken 30 } | Out-Null
Ensure-Env "ANCHOR_DB_PASSWORD" { SecureToken 30 } | Out-Null
$db = ""; try { $db = Aws rds describe-db-instances --db-instance-identifier sakshya-db --query "DBInstances[0].DBInstanceStatus" --output text } catch { if ("$_" -notmatch "DBInstanceNotFound") { throw } }
if (-not $db) {
  $ver = Aws rds describe-db-engine-versions --engine postgres --query "DBEngineVersions[?starts_with(EngineVersion,'17.')].EngineVersion" --output text
  $ver = ($ver -split "\s+" | Sort-Object { [version]($_ ) } | Select-Object -Last 1)
  Write-Host "Creating RDS postgres $ver (db.t4g.micro, private, 20 GB gp3)..."
  Aws rds create-db-instance --db-instance-identifier sakshya-db --engine postgres --engine-version $ver --db-instance-class db.t4g.micro `
    --allocated-storage 20 --storage-type gp3 --master-username sakshya_admin --master-user-password $adminPw --db-name sakshya `
    --vpc-security-group-ids $dbSg --db-subnet-group-name sakshya-db-subnets --no-publicly-accessible --no-multi-az `
    --backup-retention-period 1 --storage-encrypted --no-deletion-protection --tags "Key=project,Value=sakshya" | Out-Null
  Save-State rdsEngineVersion $ver
} else { Write-Host "RDS exists (status $db)" }
Write-Host "RDS is building in the background (about 5-10 minutes). Check: aws rds describe-db-instances --db-instance-identifier sakshya-db"
