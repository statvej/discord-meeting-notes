import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

export async function transcribe(wavPath) {
  const form = new FormData();
  form.append('file', new Blob([await readFile(wavPath)], { type: 'audio/wav' }), basename(wavPath));
  form.append('model', process.env.WHISPER_MODEL);

  const response = await fetch(`${process.env.WHISPER_URL}/v1/audio/transcriptions`, { method: 'POST', body: form });
  if (!response.ok) throw new Error(`Whisper returned ${response.status}: ${await response.text()}`);
  return (await response.json()).text.trim();
}
