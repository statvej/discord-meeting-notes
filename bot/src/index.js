import { Client, Events, GatewayIntentBits } from 'discord.js';
import { entersState, joinVoiceChannel, VoiceConnectionStatus } from '@discordjs/voice';
import { startRecording } from './recorder.js';
import { enqueueSession, findUnfinishedSessions } from './pipeline.js';
import { publishNotes } from './publisher.js';

const watchedChannelIds = (process.env.WATCHED_VOICE_CHANNEL_IDS ?? '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);
const activeSessions = new Map();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMembers],
});

const publish = (session, notes, transcriptPath, hasTranscript) =>
  publishNotes(client, session, notes, transcriptPath, hasTranscript);

const humanCount = channel => channel.members.filter(member => !member.user.bot).size;

const isWatched = channel =>
  channel.isVoiceBased() &&
  channel.id !== channel.guild.afkChannelId &&
  (watchedChannelIds.length === 0 || watchedChannelIds.includes(channel.id));

async function startSession(channel) {
  const summaryChannel = await client.channels.fetch(process.env.SUMMARY_CHANNEL_ID);
  await summaryChannel.send(`🔴 Recording started in ${channel} — notes will be posted after the call.`);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
  });
  const session = { channelId: channel.id, connection, recording: null };
  activeSessions.set(channel.guild.id, session);

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5000),
      ]);
    } catch {
      schedule(() => endSession(channel.guild.id, session));
    }
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    session.recording = await startRecording(connection, channel);
  } catch (error) {
    console.error(`Failed to start recording in #${channel.name}:`, error);
    await endSession(channel.guild.id, session);
  }
}

async function endSession(guildId, session = activeSessions.get(guildId)) {
  if (!session || activeSessions.get(guildId) !== session) return;
  activeSessions.delete(guildId);
  await session.recording?.stop();
  if (session.connection.state.status !== VoiceConnectionStatus.Destroyed) session.connection.destroy();
  if (session.recording) enqueueSession(session.recording.directory, publish);
}

async function reconcile(guild) {
  const active = activeSessions.get(guild.id);
  if (active) {
    const channel = guild.channels.cache.get(active.channelId);
    if (channel && humanCount(channel) > 0) return;
    await endSession(guild.id);
  }
  const channel = guild.channels.cache.find(candidate => isWatched(candidate) && humanCount(candidate) > 0);
  if (channel) await startSession(channel);
}

let lifecycleQueue = Promise.resolve();
function schedule(task) {
  lifecycleQueue = lifecycleQueue.then(task).catch(error => console.error('Session lifecycle error:', error));
}

client.on(Events.VoiceStateUpdate, (oldState, newState) => schedule(() => reconcile(newState.guild)));

client.once(Events.ClientReady, async readyClient => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  for (const directory of await findUnfinishedSessions()) enqueueSession(directory, publish);
  for (const guild of readyClient.guilds.cache.values()) schedule(() => reconcile(guild));
});

client.on(Events.Error, error => console.error('Discord client error:', error));
process.on('unhandledRejection', error => console.error('Unhandled rejection:', error));
process.on('uncaughtException', error => console.error('Uncaught exception:', error));

process.on('SIGTERM', async () => {
  await Promise.all([...activeSessions.values()].map(session => session.recording?.stop()));
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN).catch(error => {
  console.error('Discord login failed:', error.message);
  process.exit(1);
});
