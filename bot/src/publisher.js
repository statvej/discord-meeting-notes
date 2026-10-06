import { AttachmentBuilder, EmbedBuilder } from 'discord.js';

const MAXIMUM_DESCRIPTION_LENGTH = 4096;

export async function publishNotes(client, session, notes, transcriptPath, hasTranscript) {
  const startTime = new Date(session.startedAt).toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const description =
    notes.length > MAXIMUM_DESCRIPTION_LENGTH ? `${notes.slice(0, MAXIMUM_DESCRIPTION_LENGTH - 1)}…` : notes;
  const embed = new EmbedBuilder()
    .setTitle(`${session.channelName} – ${startTime}`.slice(0, 256))
    .setDescription(description)
    .setColor(0x5865f2);

  const channel = await client.channels.fetch(process.env.SUMMARY_CHANNEL_ID);
  await channel.send({
    embeds: [embed],
    files: hasTranscript ? [new AttachmentBuilder(transcriptPath, { name: 'transcript.txt' })] : [],
  });
}
