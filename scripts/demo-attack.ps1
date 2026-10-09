# Demo helper: simulates the INSIDER ATTACK on one stored document so you can show detection live.
#   .\scripts\demo-attack.ps1 -DocId <uuid from the document page URL>          (default: live site)
#   .\scripts\demo-attack.ps1 -DocId <uuid> -Offset 9000 -Url http://localhost:3100
# What it does: signs in as the ADMIN demo account (password read from .env.local, never printed), then calls the guarded
# POST /api/demo/attack. The server flips ONE byte of the document's plaintext, re-encrypts it validly and overwrites the stored
# part — exactly what an insider with key + storage access could do. Then press "Verify now" on the document page.
param(
  [Parameter(Mandatory = $true)][string]$DocId,
  [int]$Offset = 9000,
  [string]$Url = "https://3-109-114-12.sslip.io"
)
$ErrorActionPreference = "Stop"
$envFile = Join-Path (Split-Path $PSScriptRoot -Parent) ".env.local"
$m = [regex]::Match((Get-Content $envFile -Raw), "(?m)^DEMO_PASSWORD=(.+)$")
if (-not $m.Success) { throw "DEMO_PASSWORD not found in .env.local" }
if ($DocId -notmatch "^[0-9a-fA-F-]{36}$") { throw "DocId must be the UUID from the document page URL (/documents/<uuid>)" }

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = @{ email = "admin@sakshya.demo"; password = $m.Groups[1].Value.Trim() } | ConvertTo-Json
try {
  Invoke-RestMethod -Uri "$Url/api/auth/login" -Method Post -Body $login -ContentType "application/json" -WebSession $session | Out-Null
  $body = @{ docId = $DocId; offset = $Offset } | ConvertTo-Json
  $r = Invoke-RestMethod -Uri "$Url/api/demo/attack" -Method Post -Body $body -ContentType "application/json" -WebSession $session
} catch {
  $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
  Write-Host "Attack request failed: $msg" -ForegroundColor Red; exit 1
}
Write-Host "Attack done." -ForegroundColor Yellow
Write-Host ("  document        : {0}" -f $r.docId)
Write-Host ("  byte changed    : offset {0} (part {1}), value {2} -> {3}" -f $r.offset, $r.partIndex, $r.flippedByte.before, $r.flippedByte.after)
Write-Host "Now open the document page and press 'Verify now' - expect: Tampered, chunk $([math]::Floor($Offset / 4096)), bytes $([math]::Floor($Offset / 4096) * 4096)-$([math]::Floor($Offset / 4096) * 4096 + 4095)." -ForegroundColor Cyan
