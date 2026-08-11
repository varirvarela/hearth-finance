# Sets Cloudflare Worker secrets for Hearth Finance.
# Values already in .env.local are set automatically.
# You will be prompted only for the ones we don't have locally.
#
# Run from the project root:
#   .\scripts\setup-worker-secrets.ps1

$ErrorActionPreference = "Stop"
$config = "workers/wrangler.toml"

function Read-EnvFile {
    $vars = @{}
    foreach ($line in (Get-Content ".env.local")) {
        if ($line -match "^([^#=][^=]*)=(.*)$") {
            $vars[$matches[1].Trim()] = $matches[2].Trim()
        }
    }
    return $vars
}

# Pipes a value to wrangler via a temp file to avoid PowerShell BOM encoding issues.
function Set-Secret([string]$Name, [string]$Value) {
    Write-Host "  Setting $Name ..." -ForegroundColor DarkGray
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmp, $Value, [System.Text.Encoding]::ASCII)
    Get-Content -Raw $tmp | npx wrangler secret put $Name --config $config
    Remove-Item $tmp -ErrorAction SilentlyContinue
    Write-Host "  OK: $Name set"
}

# Runs wrangler interactively so it prompts "Enter a secret value:".
function Prompt-Secret([string]$Name, [string]$Hint) {
    Write-Host ""
    Write-Host "  SECRET: $Name" -ForegroundColor Yellow
    if ($Hint) { Write-Host "  Hint: $Hint" -ForegroundColor DarkGray }
    npx wrangler secret put $Name --config $config
}

# --- Step 1: auto-fill from .env.local ---

Write-Host ""
Write-Host "Auto-filling from .env.local..." -ForegroundColor Cyan

$env = Read-EnvFile

if (-not $env["VITE_FIREBASE_API_KEY"]) {
    Write-Host "ERROR: .env.local not found or missing VITE_FIREBASE_API_KEY" -ForegroundColor Red
    exit 1
}

Set-Secret "FIREBASE_API_KEY"      $env["VITE_FIREBASE_API_KEY"]
Set-Secret "FIREBASE_DATABASE_URL" $env["VITE_FIREBASE_DATABASE_URL"]

# Auto-fill service account credentials from service-account.json
if (Test-Path "service-account.json") {
    $sa = Get-Content "service-account.json" -Raw | ConvertFrom-Json
    Set-Secret "FIREBASE_CLIENT_EMAIL" $sa.client_email
    Set-Secret "FIREBASE_PRIVATE_KEY"  $sa.private_key
} else {
    Write-Host "  WARNING: service-account.json not found -- skipping Firebase admin credentials" -ForegroundColor Yellow
}

# --- Step 2: prompt for secrets we don't have locally ---

Write-Host ""
Write-Host "Manual entries -- paste value and press Enter for each:" -ForegroundColor Cyan

Prompt-Secret "GOOGLE_AI_API_KEY" "Free Gemini API key from aistudio.google.com -> Get API key"
Prompt-Secret "PLAID_CLIENT_ID_1" "Plaid account 1 -- dashboard.plaid.com -> Team Settings -> Keys -> client_id"
Prompt-Secret "PLAID_SECRET_1" "Plaid account 1 -- secret (Development)"

Write-Host ""
$ans = Read-Host "Do you have a second Plaid account for slot 2? (y/n)"
if ($ans -eq "y") {
    Prompt-Secret "PLAID_CLIENT_ID_2" "Plaid account 2 -- client_id"
    Prompt-Secret "PLAID_SECRET_2" "Plaid account 2 -- secret (Development)"
}

# --- Done ---

Write-Host ""
Write-Host "All secrets set. Now deploy the Worker:" -ForegroundColor Green
Write-Host ""
Write-Host "  npm run worker:deploy"
Write-Host ""
Write-Host "Copy the URL it prints, then run:"
Write-Host "  gh secret set VITE_WORKER_URL --body ""https://hearth-worker.xxx.workers.dev"" --repo varirvarela/hearth-finance"
Write-Host ""
