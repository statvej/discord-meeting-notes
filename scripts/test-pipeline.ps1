# Generates a two-speaker sample session with Windows text-to-speech and runs the
# transcription + summarization pipeline on it inside the bot container (no Discord needed).
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

$sessionDirectory = 'data/test-session'
Remove-Item -Recurse -Force $sessionDirectory -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $sessionDirectory | Out-Null

$speakers = @{ '111111111111111111' = 'Alice'; '222222222222222222' = 'Bob' }
$utterances = @(
    @{ OffsetMs = 0;     UserId = '111111111111111111'; Text = 'Good morning Bob. Let us plan the release of version two of the billing service.' }
    @{ OffsetMs = 7000;  UserId = '222222222222222222'; Text = 'Sure. The payment retry feature is done, but the invoice export still has a bug with time zones.' }
    @{ OffsetMs = 15000; UserId = '111111111111111111'; Text = 'Then we postpone the release to next Friday. Bob, can you fix the time zone bug by Wednesday?' }
    @{ OffsetMs = 23000; UserId = '222222222222222222'; Text = 'Yes, I will fix it by Wednesday. We still need to decide whether to notify customers by email.' }
)

$voice = New-Object -ComObject SAPI.SpVoice
$voices = $voice.GetVoices()
$speakerIds = @($speakers.Keys | Sort-Object)
foreach ($utterance in $utterances) {
    $fileName = '{0:D10}_{1}.wav' -f $utterance.OffsetMs, $utterance.UserId
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Format.Type = 39  # 48 kHz, 16 bit, stereo
    $stream.Open((Join-Path (Resolve-Path $sessionDirectory) $fileName), 3)
    $voice.Voice = $voices.Item([array]::IndexOf($speakerIds, $utterance.UserId) % $voices.Count)
    $voice.AudioOutputStream = $stream
    $voice.Speak($utterance.Text) | Out-Null
    $stream.Close()
}

@{
    guildId      = '0'
    channelId    = '0'
    channelName  = 'Test Meeting'
    startedAt    = (Get-Date).ToUniversalTime().ToString('o')
    speakerNames = $speakers
} | ConvertTo-Json | ForEach-Object { [IO.File]::WriteAllText((Join-Path (Resolve-Path $sessionDirectory) 'session.json'), $_) }

docker compose run --rm --build bot node src/pipeline.js /app/data/test-session
if ($LASTEXITCODE -ne 0) { throw 'Pipeline failed' }

Write-Host '--- transcript.txt ---'
Get-Content -Encoding utf8 (Join-Path $sessionDirectory 'transcript.txt')
