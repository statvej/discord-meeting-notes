# Discord Meeting Notes

A self-hosted Discord bot that records voice calls and posts meeting notes, similar to the Teams Copilot recap. When someone joins a watched voice channel, the bot joins and records each speaker separately. When the channel is empty again, it:

1. transcribes the audio locally with Whisper ([speaches](https://github.com/speaches-ai/speaches), `faster-whisper-large-v3-turbo`),
2. writes structured meeting notes in English with a local LLM ([Ollama](https://ollama.com), `qwen3:8b`),
3. posts the notes as an embed to a text channel, with the full transcript attached as `transcript.txt`.

Nothing leaves your machine except the Discord messages.

## 1. Prerequisites

- Windows 10/11 with a current NVIDIA driver (Game Ready or Studio). Install it on Windows; do **not** install a driver inside WSL.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with the WSL2 backend (Settings → General → "Use the WSL 2 based engine").
- An NVIDIA GPU with 12 GB VRAM (tested target: RTX 3060 12 GB). Smaller GPUs work too, but more slowly, because Ollama offloads part of the model to the CPU.
- Check that Docker can see the GPU:

  ```powershell
  docker run --rm --gpus all nvidia/cuda:12.6.0-base-ubuntu24.04 nvidia-smi
  ```

  This should print a table that shows your GPU.

## 2. Create the Discord application and bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. **Bot** tab → **Reset Token** → copy the token (this is `DISCORD_TOKEN`).
3. On the same tab, under **Privileged Gateway Intents**, enable **Server Members Intent**. The bot uses the intents `Guilds`, `GuildVoiceStates` and `GuildMembers`; only the last one is privileged.
4. **General Information** tab → copy the **Application ID**.
5. Invite the bot. Replace `APPLICATION_ID` and open:

   ```
   https://discord.com/oauth2/authorize?client_id=APPLICATION_ID&scope=bot&permissions=1100800
   ```

   `1100800` grants View Channel, Send Messages, Embed Links, Attach Files and Connect.

6. In Discord, enable **User Settings → Advanced → Developer Mode**, then right-click channels → **Copy Channel ID** to get the IDs for `.env`.

## 3. Configure and start

```powershell
Copy-Item .env.example .env
notepad .env
```

| Variable | Meaning |
|---|---|
| `DISCORD_TOKEN` | Bot token from step 2 |
| `SUMMARY_CHANNEL_ID` | Text channel for the recording notice and the notes |
| `WATCHED_VOICE_CHANNEL_IDS` | Comma-separated voice channel IDs; empty = all voice channels (except the AFK channel) |
| `WHISPER_URL`, `WHISPER_MODEL` | speaches endpoint and model (defaults are fine) |
| `OLLAMA_URL`, `OLLAMA_MODEL` | Ollama endpoint and model (defaults are fine) |

Start everything and download the models (about 7 GB in total, needed only once):

```powershell
docker compose up -d
powershell -ExecutionPolicy Bypass -File scripts/pull-models.ps1
docker compose logs -f bot
```

Optional check without Discord: `scripts/test-pipeline.ps1` creates a short two-speaker session with Windows text-to-speech in `data/test-session`, then prints the transcript and the notes.

### How it behaves

- There is one recording per server. It starts when the first person joins a watched voice channel and ends when no people (bots don't count) are left.
- When the bot starts recording, it posts "🔴 Recording started in #channel …" to the summary channel, so participants know they are being recorded (German law, § 201 StGB). If the bot can't post this notice, it doesn't record.
- Recordings are stored in `data/sessions/<sessionId>/` as one WAV file per utterance, plus `session.json`, the cached transcriptions (`*.txt`), `transcript.txt`, and `summary.md` once the notes are posted. Delete old session folders whenever you like.
- Processing is restart-safe: when the bot starts, it finishes every session folder that has no `summary.md` yet, and it reuses transcriptions that were already done.

## 4. Windows settings for an always-on host

- **Settings → System → Power & battery → Screen and sleep**: set "When plugged in, put my device to sleep after" to **Never**.
- **Docker Desktop → Settings → General**: enable **Start Docker Desktop when you sign in to your computer**. All containers use `restart: unless-stopped`, so they come back up by themselves.
- To make sure Docker starts after a reboot without anyone being at the PC, enable automatic sign-in (e.g. with Sysinternals [Autologon](https://learn.microsoft.com/sysinternals/downloads/autologon)).

## 5. Troubleshooting

**The bot joins, but no audio is recorded (no WAV files).**
Discord requires end-to-end encryption for voice (DAVE). Receiving audio needs a current `@discordjs/voice` (≥ 0.19) together with `@snazzah/davey`. Check what is installed in the container:

```powershell
docker compose run --rm --no-deps bot node -e "console.log(require('@discordjs/voice').generateDependencyReport())"
```

If Discord changes the protocol again, update `@discordjs/voice`, `@snazzah/davey` and `discord.js` in `bot/package.json`, run `npm install` in `bot/`, and then `docker compose up -d --build`. Also make sure nobody server-muted or server-deafened the bot.

**Out of VRAM / CUDA out of memory.**
Whisper (int8, about 1.5 GB) and qwen3:8b with a 32k context (about 7 GB) fit into 12 GB together. Other GPU users, such as games, browsers with hardware acceleration or other containers, can push it over. Check with `nvidia-smi`. Ollama unloads its model after every request (`keep_alive: 0`). Speaches unloads Whisper 5 minutes after it was last used. To free that memory right away, add `STT_MODEL_TTL: 0` to the speaches service. On smaller GPUs, use a smaller `OLLAMA_MODEL` (e.g. `qwen3:4b`) and pull it with `scripts/pull-models.ps1 -OllamaModel qwen3:4b`.

**Transcripts are empty or contain only things like "Thank you."**
- Check `docker compose logs speaches` for model download or CUDA errors, and re-run `scripts/pull-models.ps1`.
- Make sure `WHISPER_MODEL` in `.env` exactly matches the downloaded model.
- Very short or quiet utterances are often dropped by the voice activity filter, or Whisper hallucinates on them. Utterances shorter than 0.5 s are never saved.
- Listen to a WAV file from `data/sessions/...`. If it is silent or distorted, the problem is in receiving the audio (see the DAVE section above), not in transcription.
