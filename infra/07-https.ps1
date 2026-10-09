# Sakshya AWS setup, part 7: HTTPS without CloudFront (new accounts must be verified for it). Elastic IP + Caddy (auto Let's Encrypt).
# Hostname: <ip-with-dashes>.sslip.io  (free wildcard DNS that resolves to the IP). Idempotent.
$ErrorActionPreference = "Stop"
$aws = "C:\Users\Predator\AppData\Roaming\Python\Python313\Scripts\aws.cmd"
$StateFile = Join-Path $PSScriptRoot "aws-state.json"
$state = Get-Content $StateFile -Raw | ConvertFrom-Json
function Save-State($k, $v) { $state | Add-Member -NotePropertyName $k -NotePropertyValue $v -Force; $state | ConvertTo-Json -Depth 5 | Set-Content $StateFile -Encoding utf8 }
function Aws {
  $ErrorActionPreference = "Continue"
  $o = & $aws @args 2>&1
  if ($LASTEXITCODE -ne 0) { throw "aws $($args -join ' ') failed: $($o | Out-String)" }
  $s = ($o | Out-String).Trim(); if ($s -eq 'None' -or $s -eq 'null') { $s = '' }; return $s
}
$iid = $state.webInstanceId; $sg = $state.webSgId

# ---- fixed public address
$alloc = $state.eipAllocationId
if (-not $alloc) {
  $alloc = Aws ec2 allocate-address --domain vpc --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=project,Value=sakshya}]" --query AllocationId --output text
  Save-State eipAllocationId $alloc
}
Aws ec2 associate-address --instance-id $iid --allocation-id $alloc | Out-Null
$ip = Aws ec2 describe-addresses --allocation-ids $alloc --query "Addresses[0].PublicIp" --output text
$host_ = ($ip -replace "\.", "-") + ".sslip.io"
Save-State publicIp $ip; Save-State appHost $host_
Write-Host "Elastic IP $ip -> https://$host_"

# ---- firewall: 80/443 from anywhere (HTTPS front door); app port 3000 stays closed to the internet
foreach ($port in 80, 443) {
  try { Aws ec2 authorize-security-group-ingress --group-id $sg --protocol tcp --port $port --cidr 0.0.0.0/0 | Out-Null } catch { if ("$_" -notmatch "Duplicate") { throw } }
}
try { Aws ec2 revoke-security-group-ingress --group-id $sg --ip-permissions "IpProtocol=tcp,FromPort=3000,ToPort=3000,PrefixListIds=[{PrefixListId=$($state.cloudfrontPrefixList)}]" | Out-Null } catch { }

# ---- Caddy: reverse proxy to localhost:3000 with automatic certificates
$caddyfile = "$host_ {`n  encode gzip`n  reverse_proxy localhost:3000`n  header {`n    Strict-Transport-Security `"max-age=31536000`"`n    X-Content-Type-Options nosniff`n    Referrer-Policy no-referrer`n  }`n}`n"
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($caddyfile))
$unit = "[Unit]`nDescription=Caddy`nAfter=network.target`n[Service]`nExecStart=/usr/local/bin/caddy run --config /etc/caddy/Caddyfile`nRestart=always`nEnvironment=HOME=/var/lib/caddy XDG_DATA_HOME=/var/lib/caddy`nAmbientCapabilities=CAP_NET_BIND_SERVICE`n[Install]`nWantedBy=multi-user.target`n"
$ub64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($unit))
$cmds = @(
  "set -e",
  "[ -x /usr/local/bin/caddy ] || (curl -fsSL 'https://caddyserver.com/api/download?os=linux&arch=amd64' -o /usr/local/bin/caddy && chmod +x /usr/local/bin/caddy)",
  "mkdir -p /etc/caddy /var/lib/caddy",
  "echo $b64 | base64 -d > /etc/caddy/Caddyfile",
  "echo $ub64 | base64 -d > /etc/systemd/system/caddy.service",
  "systemctl daemon-reload && systemctl enable --now caddy && systemctl restart caddy",
  "sleep 6; systemctl is-active caddy; /usr/local/bin/caddy version"
)
$jf = New-TemporaryFile; Set-Content $jf (@{ commands = $cmds } | ConvertTo-Json -Compress) -Encoding ascii
$cid = Aws ssm send-command --instance-ids $iid --document-name AWS-RunShellScript --parameters "file://$($jf.FullName)" --query Command.CommandId --output text
Remove-Item $jf -Force
for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Seconds 6; $st = Aws ssm get-command-invocation --command-id $cid --instance-id $iid --query Status --output text; if ($st -in "Success","Failed","Cancelled","TimedOut") { break } }
Write-Host "Caddy install: $st"
Aws ssm get-command-invocation --command-id $cid --instance-id $iid --query "[StandardOutputContent,StandardErrorContent]" --output text | Select-Object -Last 8
if ($st -ne "Success") { throw "caddy setup failed" }
Write-Host "`nLive URL: https://$host_   (the certificate is issued on the first request, allow ~20 seconds)"
