# Windows DPAPI helper. Ship only. Do not run it on macOS.
# The secret is read from stdin and stored as a ProtectedData blob, never as a plaintext file.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) {
  '{"ok":false,"code":"bad-request"}'
  exit 1
}
$request = $raw | ConvertFrom-Json
if ($request.op -eq 'ping') {
  '{"ok":true,"op":"ping"}'
  exit 0
}
$service = [string]$request.service
$account = [string]$request.account
if (-not $service -or -not $account) {
  '{"ok":false,"code":"bad-request"}'
  exit 1
}
$root = Join-Path $env:LOCALAPPDATA 'dsh-provider-quota-rings'
$file = Join-Path $root (($service + '-' + $account + '.dpapi'))
if ($request.op -eq 'set') {
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $bytes = [Text.Encoding]::UTF8.GetBytes([string]$request.secret)
  $protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')
  [IO.File]::WriteAllBytes($file, $protected)
  '{"ok":true,"op":"set"}'
  exit 0
}
if ($request.op -eq 'get') {
  if (-not (Test-Path -LiteralPath $file)) {
    '{"ok":false,"code":"not-found"}'
    exit 1
  }
  $protected = [IO.File]::ReadAllBytes($file)
  $bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, 'CurrentUser')
  $secret = [Text.Encoding]::UTF8.GetString($bytes)
  @{ ok = $true; op = 'get'; secret = $secret } | ConvertTo-Json -Compress
  exit 0
}
if ($request.op -eq 'delete') {
  if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
  '{"ok":true,"op":"delete"}'
  exit 0
}
'{"ok":false,"code":"bad-op"}'
exit 1
