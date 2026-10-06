import { access, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { SESSIONS_DIRECTORY } from './recorder.js';
import { transcribe } from './transcriber.js';
import { summarize } from './summarizer.js';

const RETRY_DELAYS_MS = [5000, 15000, 45000];

async function withRetry(description, action) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length) throw error;
      console.warn(`${description} failed (attempt ${attempt + 1}), retrying:`, error.message);
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
}

function formatOffset(offsetMs) {
  const totalSeconds = Math.floor(offsetMs / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

export async function processSession(directory, publish) {
  const sessionId = basename(directory);
  const session = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8'));
  const audioFiles = (await readdir(directory)).filter(file => file.endsWith('.wav')).sort();
  console.log(`[${sessionId}] Processing ${audioFiles.length} utterances`);

  const lines = [];
  for (const audioFile of audioFiles) {
    const cachePath = join(directory, audioFile.replace(/\.wav$/, '.txt'));
    let text = await readFile(cachePath, 'utf8').catch(() => null);
    if (text === null) {
      text = await withRetry(`[${sessionId}] Transcribing ${audioFile}`, () => transcribe(join(directory, audioFile)));
      await writeFile(cachePath, text);
    }
    if (!text) continue;
    const [offsetMs, userId] = basename(audioFile, '.wav').split('_');
    lines.push(`[${formatOffset(Number(offsetMs))}] ${session.speakerNames[userId] ?? userId}: ${text}`);
  }

  const transcript = lines.join('\n');
  const transcriptPath = join(directory, 'transcript.txt');
  await writeFile(transcriptPath, transcript);

  const notes = transcript
    ? await withRetry(`[${sessionId}] Summarizing`, () => summarize(transcript))
    : 'No speech was captured during this call.';
  await publish(session, notes, transcriptPath, Boolean(transcript));
  await writeFile(join(directory, 'summary.md'), notes);
  console.log(`[${sessionId}] Notes published`);
}

let processingQueue = Promise.resolve();

export function enqueueSession(directory, publish) {
  processingQueue = processingQueue
    .then(() => processSession(directory, publish))
    .catch(error => console.error(`[${basename(directory)}] Processing failed:`, error));
}

export async function findUnfinishedSessions() {
  const entries = await readdir(SESSIONS_DIRECTORY, { withFileTypes: true }).catch(() => []);
  const unfinished = [];
  for (const entry of entries.filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const directory = join(SESSIONS_DIRECTORY, entry.name);
    const isDone = await access(join(directory, 'summary.md')).then(() => true, () => false);
    if (!isDone) unfinished.push(directory);
  }
  return unfinished;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = resolve(process.argv[2] ?? '');
  await processSession(directory, async (session, notes) => console.log(`\n${notes}\n`));
}
