param(
    [string]$OllamaModel = 'qwen3:8b',
    [string]$WhisperModel = 'deepdml/faster-whisper-large-v3-turbo-ct2'
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

function Invoke-Checked {
    & $args[0] $args[1..($args.Count - 1)]
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $args" }
}

Invoke-Checked docker compose up -d speaches ollama

Write-Host 'Waiting for speaches and ollama to become ready...'
for ($attempt = 0; $attempt -lt 60; $attempt++) {
    docker compose exec speaches curl -sf http://localhost:8000/health | Out-Null
    $speachesReady = $LASTEXITCODE -eq 0
    docker compose exec ollama ollama list | Out-Null
    if ($speachesReady -and $LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
}

Write-Host "Pulling $OllamaModel into ollama..."
Invoke-Checked docker compose exec ollama ollama pull $OllamaModel

Write-Host "Downloading $WhisperModel into speaches..."
Invoke-Checked docker compose exec speaches curl -sS -X POST "http://localhost:8000/v1/models/$WhisperModel"
Write-Host ''
Write-Host 'Models are ready.'
