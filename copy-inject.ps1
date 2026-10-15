# UTF-8 BOM required on Windows PowerShell 5.1
$ErrorActionPreference = 'Stop'
$src = Join-Path $PSScriptRoot 'inject-keepalive.js'
$dst = Join-Path $env:APPDATA 'Cursor\User\cursor-chat-keepalive.js'
Copy-Item -Force $src $dst
$text = [System.IO.File]::ReadAllText($src)
Set-Clipboard -Value $text
Write-Host "已同步到: $dst"
Write-Host "已复制到剪贴板 ($((Get-Item $src).Length) bytes)"
Write-Host "日常: Ctrl+Shift+P -> Developer: Reload Window"
Write-Host "备用: Ctrl+Shift+I -> Console -> Ctrl+V -> Enter"
