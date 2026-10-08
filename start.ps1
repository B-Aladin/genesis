# GENESIS in one command (Windows PowerShell):   .\start.ps1          or   .\start.ps1 -Lan   (phone capture)
# Creates the Python environment and builds the UI the first time, then starts the bench and opens the browser.
param([switch]$Lan, [int]$Port = 8000)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "First run: creating the Python environment..."
    py -3.12 -m venv .venv
    .venv\Scripts\python.exe -m pip install -e ".[test,free-models,mcp-tools]"
}
if (-not (Test-Path ".env")) {
    Copy-Item .env.example .env
    Write-Host "Created .env. Add your GOOGLE_API_KEY to run on your own boards (the sample boards work without it)."
}
if (-not (Test-Path "web\dist\index.html")) {
    Write-Host "First run: building the interface..."
    Push-Location web; npm install; npm run build; Pop-Location
}

$serverArgs = @("-m", "genesis_see.web", "--port", $Port)
if ($Lan) { $serverArgs += "--lan" }
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoProfile", "-Command", "Start-Sleep 3; Start-Process http://localhost:$Port"
& .venv\Scripts\python.exe @serverArgs
