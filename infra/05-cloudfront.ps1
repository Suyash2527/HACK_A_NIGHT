# Sakshya AWS setup, part 5: CloudFront HTTPS front door for the EC2 origin. Idempotent.
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
function Ensure-Env($key, $make) {
  $f = Join-Path $Root ".env.local"; $t = Get-Content $f -Raw
  $m = [regex]::Match($t, "(?m)^$key=(.+)$"); if ($m.Success) { return $m.Groups[1].Value.Trim() }
  $v = & $make; Add-Content $f ("`n{0}={1}" -f $key, $v); return $v
}
$secret = Ensure-Env "ORIGIN_VERIFY" { $b = New-Object byte[] 24; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); ([Convert]::ToBase64String($b) -replace '[^A-Za-z0-9]', '') }

$existing = Aws cloudfront list-distributions --query "DistributionList.Items[?Comment=='Sakshya'].[Id,DomainName]" --output text
if (-not $existing) {
  $cfg = @{
    CallerReference = "sakshya-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())"; Comment = "Sakshya"; Enabled = $true; HttpVersion = "http2"; PriceClass = "PriceClass_200"
    Origins = @{ Quantity = 1; Items = @(@{
      Id = "ec2-web"; DomainName = $state.webPublicDns
      CustomOriginConfig = @{ HTTPPort = 3000; HTTPSPort = 443; OriginProtocolPolicy = "http-only"; OriginReadTimeout = 60; OriginKeepaliveTimeout = 5 }
      CustomHeaders = @{ Quantity = 1; Items = @(@{ HeaderName = "X-Origin-Verify"; HeaderValue = $secret }) } }) }
    DefaultCacheBehavior = @{
      TargetOriginId = "ec2-web"; ViewerProtocolPolicy = "redirect-to-https"; Compress = $true
      AllowedMethods = @{ Quantity = 7; Items = @("GET","HEAD","OPTIONS","PUT","POST","PATCH","DELETE"); CachedMethods = @{ Quantity = 2; Items = @("GET","HEAD") } }
      CachePolicyId = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"          # CachingDisabled: evidence is never cached
      OriginRequestPolicyId = "216adef6-5c7f-47e4-b989-5492eafa07d3" } # AllViewer: cookies, headers, query strings reach the app
  } | ConvertTo-Json -Depth 10 -Compress
  $cf = New-TemporaryFile; Set-Content $cf $cfg -Encoding ascii
  $out = Aws cloudfront create-distribution --distribution-config "file://$($cf.FullName)" --query "Distribution.[Id,DomainName]" --output text
  Remove-Item $cf -Force; $existing = $out; Write-Host "Created distribution"
}
$parts = $existing -split "\s+"
Save-State cloudfrontId $parts[0]; Save-State appDomain $parts[1]
Write-Host "CloudFront: https://$($parts[1])  (id $($parts[0]))  - global rollout takes a few minutes"
