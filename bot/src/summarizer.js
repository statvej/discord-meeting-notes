const MAXIMUM_CHUNK_TOKENS = 24000;
const CHARACTERS_PER_TOKEN = 4;

const INSTRUCTIONS = `You write meeting notes from a meeting transcript.
Always write the notes in English, regardless of the language spoken in the meeting.
Keep names, product terms and code identifiers exactly as spoken; do not translate them.
Use only information from the transcript. Do not invent facts, owners or deadlines.
If a section has no content, write "None".
Use exactly this Markdown structure and these headings:

## Summary
3–5 sentences.

## Main topics
- topic

## Decisions
- decision

## Action items
- **Owner** – task – deadline if mentioned

## Open questions
- question`;

async function chat(content) {
  const response = await fetch(`${process.env.OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL,
      messages: [
        { role: 'system', content: INSTRUCTIONS },
        { role: 'user', content },
      ],
      stream: false,
      think: false,
      keep_alive: 0,
      options: { num_ctx: 32768 },
    }),
  });
  if (!response.ok) throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  return (await response.json()).message.content.trim();
}

function splitIntoChunks(transcript) {
  const maximumCharacters = MAXIMUM_CHUNK_TOKENS * CHARACTERS_PER_TOKEN;
  const chunks = [''];
  for (const line of transcript.split('\n')) {
    if (chunks.at(-1).length + line.length > maximumCharacters) chunks.push('');
    chunks[chunks.length - 1] += `${line}\n`;
  }
  return chunks;
}

export async function summarize(transcript) {
  const chunks = splitIntoChunks(transcript);
  if (chunks.length === 1) return chat(`Transcript:\n\n${transcript}`);

  const partialNotes = [];
  for (const [index, chunk] of chunks.entries()) {
    partialNotes.push(await chat(`Transcript (part ${index + 1} of ${chunks.length} of one meeting):\n\n${chunk}`));
  }
  return chat(
    `These are notes for consecutive parts of one meeting. Merge them into a single set of notes for the whole meeting.\n\n` +
      partialNotes.map((notes, index) => `# Part ${index + 1}\n\n${notes}`).join('\n\n'),
  );
}
