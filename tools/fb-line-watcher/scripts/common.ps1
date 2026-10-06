# 共用：切到專案根目錄、檢查 Node 版本
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

function Assert-Node {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Host '找不到 node.exe。請先安裝 Node.js 22 LTS（https://nodejs.org/），安裝後重新開啟 PowerShell。' -ForegroundColor Red
    exit 1
  }
  $ver = (& node --version).TrimStart('v')
  $major = [int]($ver.Split('.')[0]); $minor = [int]($ver.Split('.')[1])
  if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 13)) {
    Write-Host "Node.js 版本為 v$ver，需要 22.13 以上（內建 SQLite）。" -ForegroundColor Red
    exit 1
  }
}

# 執行原生命令（npm、npx、icacls 等）並檢查結束代碼。
# PowerShell 的 try/catch 與 $ErrorActionPreference 不會攔截原生程序的非零結束代碼，
# 必須自己檢查 $LASTEXITCODE，否則安裝失敗也會被當成成功。
function Invoke-Native {
  param(
    [Parameter(Mandatory)][string]$Description,
    [Parameter(Mandatory)][scriptblock]$Command
  )
  & $Command
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  X $Description 失敗（結束代碼 $LASTEXITCODE）" -ForegroundColor Red
    exit $LASTEXITCODE
  }
}

function Assert-Config {
  if (-not (Test-Path 'config\targets.yaml')) {
    Write-Host '找不到 config\targets.yaml，請先複製 config\targets.example.yaml 並填入粉專／社團網址。' -ForegroundColor Yellow
    exit 1
  }
  if (-not (Test-Path '.env')) {
    Write-Host '找不到 .env，請先複製 .env.example 並填入 LINE 設定。' -ForegroundColor Yellow
    exit 1
  }
}
