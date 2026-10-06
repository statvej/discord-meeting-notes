import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { EndBehaviorType } from '@discordjs/voice';
import prism from 'prism-media';

export const SESSIONS_DIRECTORY = resolve('data/sessions');

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * 2;
const MINIMUM_UTTERANCE_BYTES = BYTES_PER_SECOND / 2;
const SILENCE_DURATION_MS = 1200;

function wavHeader(dataLength) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(CHANNELS * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLength, 40);
  return header;
}

export async function startRecording(connection, channel) {
  const startedAt = new Date();
  const sessionId = `${startedAt.toISOString().replace(/[:.]/g, '-')}_${channel.guild.id}`;
  const directory = join(SESSIONS_DIRECTORY, sessionId);
  await mkdir(directory, { recursive: true });

  const session = {
    guildId: channel.guild.id,
    channelId: channel.id,
    channelName: channel.name,
    startedAt: startedAt.toISOString(),
    speakerNames: {},
  };
  let pendingSave = Promise.resolve();
  const saveSession = () =>
    (pendingSave = pendingSave
      .then(() => writeFile(join(directory, 'session.json'), JSON.stringify(session, null, 2)))
      .catch(error => console.error(`[${sessionId}] Failed to save session.json:`, error)));
  await saveSession();

  const receiver = connection.receiver;
  const pendingUtterances = new Set();

  async function rememberSpeaker(userId) {
    const member = await channel.guild.members.fetch(userId).catch(() => null);
    session.speakerNames[userId] = member?.displayName ?? userId;
    await saveSession();
  }

  async function recordUtterance(userId) {
    const offsetMs = Date.now() - startedAt.getTime();
    const opusStream = receiver.subscribe(userId, {
      end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_DURATION_MS },
    });
    const decoder = new prism.opus.Decoder({ rate: SAMPLE_RATE, channels: CHANNELS, frameSize: 960 });
    const chunks = [];
    await pipeline(opusStream, decoder, async source => {
      for await (const chunk of source) chunks.push(chunk);
    }).catch(error => console.error(`[${sessionId}] Audio stream error for ${userId}:`, error.message));

    const pcm = Buffer.concat(chunks);
    if (pcm.length < MINIMUM_UTTERANCE_BYTES) return;
    const fileName = `${String(offsetMs).padStart(10, '0')}_${userId}.wav`;
    await writeFile(join(directory, fileName), Buffer.concat([wavHeader(pcm.length), pcm]));
  }

  function onSpeakingStart(userId) {
    if (receiver.subscriptions.has(userId)) return;
    if (channel.guild.members.cache.get(userId)?.user.bot) return;
    if (!(userId in session.speakerNames)) {
      session.speakerNames[userId] = userId;
      rememberSpeaker(userId);
    }
    const utterance = recordUtterance(userId)
      .catch(error => console.error(`[${sessionId}] Failed to write utterance for ${userId}:`, error))
      .finally(() => pendingUtterances.delete(utterance));
    pendingUtterances.add(utterance);
  }

  receiver.speaking.on('start', onSpeakingStart);
  console.log(`[${sessionId}] Recording started in #${channel.name}`);

  return {
    sessionId,
    directory,
    async stop() {
      receiver.speaking.off('start', onSpeakingStart);
      for (const stream of receiver.subscriptions.values()) stream.push(null);
      await Promise.all(pendingUtterances);
      await pendingSave;
      console.log(`[${sessionId}] Recording stopped`);
    },
  };
}
