// Writes the daily (08:00 WIB) and weekly (Friday 17:00 WIB) wrap-up stories with Claude.
// Claude picks 3-4 interesting East Java stories from the collected news and writes a short
// piece; every paragraph about a story is linked to that story's source by build.mjs.
// Needs ANTHROPIC_API_KEY, like scripts/rewrite.mjs.
//
// Two ways to write a wrap-up:
// - full: Opus 5.5 picks the stories AND writes the piece (the weekly wrap-up always does this);
// - economical (the daily wrap-up's default): Opus picks 3-4 stories (a short answer), then Haiku 5.5
//   writes the piece from only those stories. About a third of the cost. If it fails the checks,
//   the daily wrap-up is written the full way instead. kontrol.json "ringkasanHarianCara" switches.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';         // picks stories; writes the whole weekly wrap-up
const WRITER = 'claude-haiku-5-5';       // writes the daily wrap-up from the stories Opus picked

export const KINDS = {
  daily: {
    name: 'ringkasan harian',
    paragraphs: '5 sampai 6 paragraf',
    period: '24 jam terakhir',
    min: 5, max: 6,
  },
  weekly: {
    name: 'ringkasan sepekan',
    paragraphs: '7 sampai 8 paragraf',
    period: 'tujuh hari terakhir',
    min: 7, max: 8,
  },
};

const INTRO = 'Kamu adalah redaktur Jawa Timur Sepekan, situs berita mingguan Jawa Timur.';

const SELECTION = `- Pilih 3 sampai 4 berita yang paling penting atau paling menarik bagi pembaca di Jawa Timur.
- Utamakan berita yang diberitakan lebih dari satu media, berita yang berdampak pada banyak warga, dan
  berita dari daerah yang berbeda-beda. Hindari jadwal salat, prakiraan cuaca rutin, ramalan, dan iklan.`;

const WRITING = (kind) => `- Tulis dalam Bahasa Indonesia baku dengan gaya berita, total ${kind.paragraphs}.
- Paragraf pertama adalah pembuka yang merangkum isi tulisan. Lalu satu paragraf (atau dua, untuk
  berita besar) untuk setiap berita yang dipilih. Paragraf terakhir boleh menjadi penutup singkat.
- Gunakan hanya fakta dari daftar berita. Jangan menambah fakta, angka, nama, kutipan, atau dugaan.
  Nama, jabatan, tempat, angka, dan tanggal harus sama persis.
- Nada netral. Klaim pemerintah ditulis sebagai klaim ("menurut Pemkab ...").
- Untuk setiap paragraf tentang satu berita, isi "story" dengan nomor berita itu. Tiga kata terakhir
  paragraf tersebut akan menjadi tautan ke sumber beritanya, jadi akhiri paragraf dengan frasa biasa,
  bukan angka atau kutipan. Untuk paragraf pembuka dan penutup, isi "story" dengan 0.
- Judul singkat dan informatif, tanpa kata-kata yang memancing klik.`;

// The full instructions (pick and write). Unchanged by the economical way.
export const SYSTEM = (kind) => `${INTRO}
Tugasmu: menulis ${kind.name} dari daftar berita ${kind.period} yang diberikan.

Cara memilih:
${SELECTION}

Cara menulis:
${WRITING(kind)}`;

// Opus's part of the economical way: only choose, in a short answer.
const CHOOSE_SYSTEM = (kind) => `${INTRO}
Tugasmu: memilih berita untuk ${kind.name} dari daftar berita ${kind.period} yang diberikan. Kamu tidak menulis
ringkasannya; penulis lain akan menulisnya dari pilihanmu.

Cara memilih:
${SELECTION}
- Urutkan dari yang terpenting. Untuk setiap berita, tulis satu kalimat pendek tentang sudut yang perlu
  ditekankan agar pembaca memahami mengapa berita itu penting.
- Pakai nomor berita persis seperti di daftar.`;

// Haiku's part: write from the stories that were picked.
const WRITE_SYSTEM = (kind) => `${INTRO}
Tugasmu: menulis ${kind.name} dari beberapa berita yang SUDAH DIPILIH redaksi. Berita diberikan urut dari yang
terpenting, masing-masing dengan sudut yang disarankan. Gunakan semuanya; jangan menambah berita lain.

Cara menulis:
${WRITING(kind)}`;

export const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    paragraphs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { text: { type: 'string' }, story: { type: 'integer' } },
        required: ['text', 'story'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'paragraphs'],
  additionalProperties: false,
};

const PICKS_SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'integer' }, sudut: { type: 'string' } },
        required: ['id', 'sudut'],
        additionalProperties: false,
      },
    },
  },
  required: ['picks'],
  additionalProperties: false,
};

let client = null;

const textOf = (response) => response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');

// Cleans a written wrap-up and checks it: 3+ stories and a sensible number of paragraphs.
// Returns the digest, or null (with the reason logged).
function checked(kind, candidates, digest, label) {
  const ids = new Set(candidates.map((c) => c.id));
  digest.paragraphs = digest.paragraphs
    .map((p) => ({ text: p.text.replace(/\s+/g, ' ').trim(), story: ids.has(p.story) ? p.story : 0 }))
    .filter((p) => p.text);
  const stories = new Set(digest.paragraphs.map((p) => p.story).filter(Boolean));
  if (stories.size < 3 || digest.paragraphs.length < kind.min - 1 || digest.paragraphs.length > kind.max + 1) {
    console.log(`       ${label} rejected: ${stories.size} stories, ${digest.paragraphs.length} paragraphs`);
    return null;
  }
  return digest;
}

// The full way: Opus picks and writes.
async function writeFull(kind, candidates) {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',  // if the request is declined, Anthropic retries it on its recommended model
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: SYSTEM(kind),
    messages: [{ role: 'user', content: `Daftar berita:\n\n${candidates.map((c) => c.line).join('\n\n')}` }],
  });
  if (response.stop_reason !== 'end_turn') {
    console.log(`       ${kind.name} not written (${response.stop_reason})`);
    return null;
  }
  console.log(`       ${kind.name} (Opus): ${response.usage.input_tokens} in / ${response.usage.output_tokens} out tokens`);
  return checked(kind, candidates, JSON.parse(textOf(response)), kind.name);
}

// The economical way. Returns { digest, steps: [{ model, usage }], picks } where digest is null if
// the pick or the writing did not pass; throws on API errors (callers decide what to do).
export async function economical(kind, candidates) {
  client ??= new Anthropic();
  const steps = [];
  const chosen = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 2000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PICKS_SCHEMA } },
    system: CHOOSE_SYSTEM(kind),
    messages: [{ role: 'user', content: `Daftar berita:\n\n${candidates.map((c) => c.line).join('\n\n')}` }],
  });
  steps.push({ model: MODEL, usage: chosen.usage });
  if (chosen.stop_reason !== 'end_turn') return { digest: null, steps, reason: `pick stopped: ${chosen.stop_reason}` };
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const seen = new Set();
  const picks = JSON.parse(textOf(chosen)).picks
    .filter((p) => byId.has(p.id) && !seen.has(p.id) && seen.add(p.id))
    .slice(0, 4);
  if (picks.length < 3) return { digest: null, steps, picks, reason: `only ${picks.length} valid picks` };

  const written = await client.messages.create({
    model: WRITER,
    max_tokens: 8000,
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
    system: WRITE_SYSTEM(kind),
    messages: [{
      role: 'user',
      content: `Berita pilihan (urut dari yang terpenting):\n\n${picks.map((p) => `${byId.get(p.id).line}\nSudut yang disarankan: ${p.sudut}`).join('\n\n')}`,
    }],
  });
  steps.push({ model: WRITER, usage: written.usage });
  if (written.stop_reason !== 'end_turn') return { digest: null, steps, picks, reason: `writing stopped: ${written.stop_reason}` };
  const picked = picks.map((p) => byId.get(p.id));
  const digest = checked(kind, picked, JSON.parse(textOf(written)), `${kind.name} (Haiku)`);
  return { digest, steps, picks, reason: digest ? null : 'writing did not pass the checks' };
}

// candidates: [{ id, line }]. Returns { title, paragraphs: [{ text, story }] } or null.
// options.economical: write the daily wrap-up the economical way (falls back to the full way).
export async function writeDigest(kindName, candidates, options = {}) {
  const kind = KINDS[kindName];
  client ??= new Anthropic();
  try {
    if (options.economical && kindName === 'daily') {
      const result = await economical(kind, candidates);
      const used = result.steps.map((s) => `${s.model.replace('claude-', '')} ${s.usage.input_tokens}/${s.usage.output_tokens}`).join(', ');
      if (result.digest) {
        console.log(`       ${kind.name} (Opus picks, Haiku writes): ${used} tokens`);
        return result.digest;
      }
      console.log(`       economical way did not work (${result.reason}); writing the full ${kind.name} with Opus`);
    }
    return await writeFull(kind, candidates);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) console.log(`       ${kind.name} skipped: the API key was rejected`);
    else if (err instanceof Anthropic.RateLimitError) console.log(`       ${kind.name} paused: rate limit reached, will try again next run`);
    else if (err instanceof Anthropic.APIError) console.log(`       ${kind.name} failed (${err.status}): ${err.message}`);
    else console.log(`       ${kind.name} failed: ${err.message}`);
    return null;
  }
}
