# Sakshya AWS setup, part 4: deploy bucket, IAM role (no keys, no SSH), EC2 web server. Idempotent.
$ErrorActionPreference = "Stop"
$aws = "C:\Users\Predator\AppData\Roaming\Python\Python313\Scripts\aws.cmd"
$Region = "ap-south-1"
$StateFile = Join-Path $PSScriptRoot "aws-state.json"
$state = Get-Content $StateFile -Raw | ConvertFrom-Json
function Save-State($k, $v) { $state | Add-Member -NotePropertyName $k -NotePropertyValue $v -Force; $state | ConvertTo-Json -Depth 5 | Set-Content $StateFile -Encoding utf8 }
function Aws {
  $ErrorActionPreference = "Continue"
  $o = & $aws @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed: $($o | Out-String)" }
  $s = ($o | Out-String).Trim(); if ($s -eq 'None' -or $s -eq 'null') { $s = '' }; return $s
}
$acct = $state.account; $evidence = $state.s3Bucket; $masterKey = $state.kmsMasterKeyId; $signerKey = $state.kmsSignerKeyId

# ---- private deploy bucket (build artifacts only)
$deploy = "sakshya-deploy-$acct-aps1"
$has = $true; try { Aws s3api head-bucket --bucket $deploy | Out-Null } catch { $has = $false }
if (-not $has) { Aws s3api create-bucket --bucket $deploy --region $Region --create-bucket-configuration LocationConstraint=$Region | Out-Null; Write-Host "Created $deploy" }
Aws s3api put-public-access-block --bucket $deploy --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" | Out-Null
Save-State deployBucket $deploy

# ---- IAM role for the instance: SSM (shell without SSH) + least-privilege access to our bucket and keys
$role = "sakshya-web-role"
$trust = '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
$exists = $true; try { Aws iam get-role --role-name $role | Out-Null } catch { $exists = $false }
if (-not $exists) {
  $tf = New-TemporaryFile; Set-Content $tf $trust -Encoding ascii
  Aws iam create-role --role-name $role --assume-role-policy-document "file://$($tf.FullName)" --tags "Key=project,Value=sakshya" | Out-Null; Remove-Item $tf -Force
  Write-Host "Created role $role"
}
Aws iam attach-role-policy --role-name $role --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore | Out-Null
$masterArn = "arn:aws:kms:${Region}:${acct}:key/$masterKey"; $signerArn = "arn:aws:kms:${Region}:${acct}:key/$signerKey"
$policy = @"
{"Version":"2012-10-17","Statement":[
 {"Sid":"EvidenceBucket","Effect":"Allow","Action":["s3:PutObject","s3:GetObject","s3:GetObjectVersion","s3:ListBucket","s3:ListBucketVersions","s3:GetObjectRetention"],"Resource":["arn:aws:s3:::$evidence","arn:aws:s3:::$evidence/*"]},
 {"Sid":"DeployArtifactsReadOnly","Effect":"Allow","Action":["s3:GetObject","s3:ListBucket"],"Resource":["arn:aws:s3:::$deploy","arn:aws:s3:::$deploy/*"]},
 {"Sid":"KeysForEnvelope","Effect":"Allow","Action":["kms:Decrypt","kms:GenerateDataKey","kms:DescribeKey"],"Resource":"$masterArn"},
 {"Sid":"PostQuantumSigner","Effect":"Allow","Action":["kms:Sign","kms:Verify","kms:GetPublicKey","kms:DescribeKey"],"Resource":"$signerArn"}
]}
"@
$pf = New-TemporaryFile; Set-Content $pf $policy -Encoding ascii
Aws iam put-role-policy --role-name $role --policy-name sakshya-app --policy-document "file://$($pf.FullName)" | Out-Null; Remove-Item $pf -Force
$ip = $true; try { Aws iam get-instance-profile --instance-profile-name $role | Out-Null } catch { $ip = $false }
if (-not $ip) { Aws iam create-instance-profile --instance-profile-name $role | Out-Null; Aws iam add-role-to-instance-profile --instance-profile-name $role --role-name $role | Out-Null; Write-Host "Created instance profile; waiting for IAM to propagate"; Start-Sleep -Seconds 12 }

# ---- user-data: Node 24, pm2, RDS CA bundle, swap. The app itself arrives from the deploy bucket (deploy script).
$userData = @'
#!/bin/bash
set -euxo pipefail
dnf install -y tar xz gzip unzip
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
curl -fsSL https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz -o /tmp/node.tar.xz
tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
npm i -g pm2@6
mkdir -p /opt/app/certs /opt/app/releases /opt/app/shared
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /opt/app/certs/rds-global-bundle.pem
chown -R ec2-user:ec2-user /opt/app
touch /opt/app/READY
'@
$udf = New-TemporaryFile; Set-Content $udf $userData -Encoding ascii

# ---- EC2 instance
$iid = Aws ec2 describe-instances --filters "Name=tag:Name,Values=sakshya-web" "Name=instance-state-name,Values=pending,running,stopped" --query "Reservations[0].Instances[0].InstanceId" --output text
if (-not $iid) {
  $ami = Aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 --query Parameter.Value --output text
  $bdm = '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":30,"VolumeType":"gp3","Encrypted":true,"DeleteOnTermination":true}}]'
  $bf = New-TemporaryFile; Set-Content $bf $bdm -Encoding ascii
  $iid = Aws ec2 run-instances --image-id $ami --instance-type t3.small --iam-instance-profile "Name=$role" --security-group-ids $state.webSgId `
    --associate-public-ip-address --metadata-options "HttpTokens=required,HttpEndpoint=enabled" --block-device-mappings "file://$($bf.FullName)" `
    --user-data "file://$($udf.FullName)" --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=sakshya-web},{Key=project,Value=sakshya}]" `
    --query "Instances[0].InstanceId" --output text
  Remove-Item $bf -Force; Write-Host "Launched $iid"
} else { Write-Host "Instance exists: $iid" }
Remove-Item $udf -Force
Save-State webInstanceId $iid
Aws ec2 wait instance-running --instance-ids $iid
$dns = Aws ec2 describe-instances --instance-ids $iid --query "Reservations[0].Instances[0].PublicDnsName" --output text
Save-State webPublicDns $dns
Write-Host "Instance running: $dns"
Write-Host "Waiting for the SSM agent to come online..."
for ($i = 0; $i -lt 30; $i++) {
  $online = Aws ssm describe-instance-information --filters "Key=InstanceIds,Values=$iid" --query "InstanceInformationList[0].PingStatus" --output text
  if ($online -eq "Online") { break }; Start-Sleep -Seconds 10
}
Write-Host "SSM status: $online"
