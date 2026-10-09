# Sakshya AWS setup, part 1: budget alert, KMS keys, S3 evidence bucket (Object Lock). Idempotent: safe to re-run.
# Usage (PowerShell):  .\infra\01-core.ps1
# Writes non-secret resource ids to infra/aws-state.json. Secrets never printed.
$ErrorActionPreference = "Stop"
$aws = "C:\Users\Predator\AppData\Roaming\Python\Python313\Scripts\aws.cmd"
$Region = "ap-south-1"
$Email = "csuyash2506@gmail.com"
$StateFile = Join-Path $PSScriptRoot "aws-state.json"
$state = if (Test-Path $StateFile) { Get-Content $StateFile -Raw | ConvertFrom-Json -ErrorAction SilentlyContinue } else { $null }
if (-not $state) { $state = [pscustomobject]@{} }
function Save-State($k, $v) { $state | Add-Member -NotePropertyName $k -NotePropertyValue $v -Force; $state | ConvertTo-Json -Depth 5 | Set-Content $StateFile -Encoding utf8 }
function Aws {
  $ErrorActionPreference = "Continue"   # a CLI warning on stderr must not abort; the exit code decides
  $o = & $aws @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed: $($o | Out-String)" }
  $s = ($o | Out-String).Trim()
  if ($s -eq 'None' -or $s -eq 'null') { $s = '' }   # the CLI prints None/null for "nothing found"
  return $s
}

$Account = (Aws sts get-caller-identity --query Account --output text).Trim()
Save-State account $Account
Write-Host "Account $Account, region $Region"

# ---- 0. budget alert ($10 / month, email at 50% and 90% of actual spend)
$existing = (Aws budgets describe-budgets --account-id $Account --query "Budgets[?BudgetName=='sakshya-hackathon'].BudgetName" --output text).Trim()
if (-not $existing) {
  $budget = @{ BudgetName = "sakshya-hackathon"; BudgetLimit = @{ Amount = "10"; Unit = "USD" }; TimeUnit = "MONTHLY"; BudgetType = "COST" } | ConvertTo-Json -Depth 4 -Compress
  $notes = @(50, 90 | ForEach-Object { @{ Notification = @{ NotificationType = "ACTUAL"; ComparisonOperator = "GREATER_THAN"; Threshold = $_; ThresholdType = "PERCENTAGE" }; Subscribers = @(@{ SubscriptionType = "EMAIL"; Address = $Email }) } }) | ConvertTo-Json -Depth 6 -Compress
  $bf = New-TemporaryFile; $nf = New-TemporaryFile
  Set-Content $bf $budget -Encoding ascii; Set-Content $nf $notes -Encoding ascii
  Aws budgets create-budget --account-id $Account --budget "file://$($bf.FullName)" --notifications-with-subscribers "file://$($nf.FullName)" | Out-Null
  Remove-Item $bf, $nf -Force
  Write-Host "Budget alert created (USD 10/month -> $Email)"
} else { Write-Host "Budget alert already exists" }

# ---- 1. KMS: symmetric master key + ML-DSA-65 signing key
function Ensure-Key($alias, $specArgs, $desc) {
  $arn = (Aws kms list-aliases --query "Aliases[?AliasName=='$alias'].TargetKeyId" --output text).Trim()
  if (-not $arn) {
    $id = (Aws kms create-key @specArgs --description $desc --tags "TagKey=project,TagValue=sakshya" --query KeyMetadata.KeyId --output text).Trim()
    Aws kms create-alias --alias-name $alias --target-key-id $id | Out-Null
    $arn = $id; Write-Host "Created $alias -> $id"
  } else { Write-Host "$alias exists -> $arn" }
  return $arn
}
$master = Ensure-Key "alias/sakshya-master" @() "Sakshya: protects post-quantum seeds and S3 objects"
$signer = Ensure-Key "alias/sakshya-signer" @("--key-spec", "ML_DSA_65", "--key-usage", "SIGN_VERIFY") "Sakshya: ML-DSA-65 system signer (post-quantum)"
Save-State kmsMasterKeyId $master; Save-State kmsSignerKeyId $signer
Aws kms enable-key-rotation --key-id $master | Out-Null   # rotation is for symmetric keys only

# ---- 2. S3 evidence bucket: Object Lock + versioning + KMS + no public access
$Bucket = "sakshya-evidence-$Account-aps1"
$exists = $true
try { Aws s3api head-bucket --bucket $Bucket | Out-Null } catch { $exists = $false }
if (-not $exists) {
  Aws s3api create-bucket --bucket $Bucket --region $Region --create-bucket-configuration LocationConstraint=$Region --object-lock-enabled-for-bucket | Out-Null
  Write-Host "Created bucket $Bucket (Object Lock enabled)"
} else { Write-Host "Bucket exists" }
Aws s3api put-public-access-block --bucket $Bucket --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" | Out-Null
$enc = @{ Rules = @(@{ ApplyServerSideEncryptionByDefault = @{ SSEAlgorithm = "aws:kms"; KMSMasterKeyID = $master }; BucketKeyEnabled = $true }) } | ConvertTo-Json -Depth 6 -Compress
$ef = New-TemporaryFile; Set-Content $ef $enc -Encoding ascii
Aws s3api put-bucket-encryption --bucket $Bucket --server-side-encryption-configuration "file://$($ef.FullName)" | Out-Null; Remove-Item $ef -Force
# GOVERNANCE retention (1 day) keeps originals undeletable by normal users; admins can bypass it for cleanup.
$lock = @{ ObjectLockEnabled = "Enabled"; Rule = @{ DefaultRetention = @{ Mode = "GOVERNANCE"; Days = 1 } } } | ConvertTo-Json -Depth 5 -Compress
$lf = New-TemporaryFile; Set-Content $lf $lock -Encoding ascii
Aws s3api put-object-lock-configuration --bucket $Bucket --object-lock-configuration "file://$($lf.FullName)" | Out-Null; Remove-Item $lf -Force
Save-State s3Bucket $Bucket

Write-Host "`nVerification:"
Write-Host ("  versioning : " + (Aws s3api get-bucket-versioning --bucket $Bucket --query Status --output text).Trim())
Write-Host ("  object lock: " + (Aws s3api get-object-lock-configuration --bucket $Bucket --query "ObjectLockConfiguration.Rule.DefaultRetention.Mode" --output text).Trim())
Write-Host ("  encryption : " + (Aws s3api get-bucket-encryption --bucket $Bucket --query "ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm" --output text).Trim())
Write-Host ("  public blk : " + (Aws s3api get-public-access-block --bucket $Bucket --query "PublicAccessBlockConfiguration.BlockPublicPolicy" --output text).Trim())
Write-Host ("  signer spec: " + (Aws kms describe-key --key-id $signer --query "KeyMetadata.KeySpec" --output text).Trim())
Write-Host "`nDone. State saved to infra/aws-state.json"
