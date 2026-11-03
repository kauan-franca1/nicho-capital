# Nicho Capital — equivalente ao Makefile para Windows sem make.
# Uso: powershell -ExecutionPolicy Bypass -File scripts/nicho.ps1 <alvo>
param(
    [Parameter(Position = 0)]
    [ValidateSet("help", "setup", "dev", "test", "lint", "db-up", "db-down", "migrate", "pipeline", "demo")]
    [string]$Target = "help"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot

function Invoke-In([string]$Dir, [scriptblock]$Block) {
    Push-Location (Join-Path $Root $Dir)
    try {
        & $Block
        if ($LASTEXITCODE -ne 0) { throw "Falhou em $Dir (código $LASTEXITCODE)" }
    }
    finally { Pop-Location }
}

switch ($Target) {
    "help" {
        Write-Output "Alvos: setup, dev, test, lint, db-up, db-down, migrate, pipeline, demo (ver Makefile)."
    }
    "setup" {
        Invoke-In "pipeline" { uv sync --python 3.12 }
        Invoke-In "web" { npm ci }
    }
    "dev" { Invoke-In "web" { npm run dev } }
    "test" {
        Invoke-In "pipeline" { uv run pytest }
        Invoke-In "web" { npm test }
    }
    "lint" {
        Invoke-In "pipeline" { uv run ruff check .; uv run ruff format --check .; uv run mypy }
        Invoke-In "web" { npm run lint; npm run typecheck }
    }
    "db-up" { Invoke-In "." { docker compose up -d db } }
    "db-down" { Invoke-In "." { docker compose down } }
    "migrate" { Invoke-In "pipeline" { uv run nicho migrate; uv run nicho sync-universo } }
    "pipeline" { Invoke-In "pipeline" { uv run nicho rodar; uv run nicho export-demo } }
    "demo" {
        $env:DEMO_MODE = "true"
        Invoke-In "web" { npm run build; npm run start }
    }
}
