// Writes the daily (08:00 WIB) and weekly (Friday 17:00 WIB) wrap-up stories with Claude.
// Claude picks 3-4 interesting East Java stories from the collected news and writes a short
// piece; every paragraph about a story is linked to that story's source by build.mjs.
// Needs ANTHROPIC_API_KEY, like scripts/rewrite.mjs.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';  // the strongest writer; about US$2.50 a month for both wrap-ups

const KINDS = {
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

const SYSTEM = (kind) => `Kamu adalah redaktur Jawa Timur Sepekan, situs berita mingguan Jawa Timur.
Tugasmu: menulis ${kind.name} dari daftar berita ${kind.period} yang diberikan.

Cara memilih:
- Pilih 3 sampai 4 berita yang paling penting atau paling menarik bagi pembaca di Jawa Timur.
- Utamakan berita yang diberitakan lebih dari satu media, berita yang berdampak pada banyak warga, dan
  berita dari daerah yang berbeda-beda. Hindari jadwal salat, prakiraan cuaca rutin, ramalan, dan iklan.

Cara menulis:
- Tulis dalam Bahasa Indonesia baku dengan gaya berita, total ${kind.paragraphs}.
- Paragraf pertama adalah pembuka yang merangkum isi tulisan. Lalu satu paragraf (atau dua, untuk
  berita besar) untuk setiap berita yang dipilih. Paragraf terakhir boleh menjadi penutup singkat.
- Gunakan hanya fakta dari daftar berita. Jangan menambah fakta, angka, nama, kutipan, atau dugaan.
  Nama, jabatan, tempat, angka, dan tanggal harus sama persis.
- Nada netral. Klaim pemerintah ditulis sebagai klaim ("menurut Pemkab ...").
- Untuk setiap paragraf tentang satu berita, isi "story" dengan nomor berita itu. Tiga kata terakhir
  paragraf tersebut akan menjadi tautan ke sumber beritanya, jadi akhiri paragraf dengan frasa biasa,
  bukan angka atau kutipan. Untuk paragraf pembuka dan penutup, isi "story" dengan 0.
- Judul singkat dan informatif, tanpa kata-kata yang memancing klik.`;

const SCHEMA = {
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

let client = null;

// candidates: [{ id, line }]. Returns { title, paragraphs: [{ text, story }] } or null.
export async function writeDigest(kindName, candidates) {
  const kind = KINDS[kindName];
  client ??= new Anthropic();
  try {
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
    const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
    const digest = JSON.parse(text);
    const ids = new Set(candidates.map((c) => c.id));
    digest.paragraphs = digest.paragraphs
      .map((p) => ({ text: p.text.replace(/\s+/g, ' ').trim(), story: ids.has(p.story) ? p.story : 0 }))
      .filter((p) => p.text);
    const stories = new Set(digest.paragraphs.map((p) => p.story).filter(Boolean));
    if (stories.size < 3 || digest.paragraphs.length < kind.min - 1 || digest.paragraphs.length > kind.max + 1) {
      console.log(`       ${kind.name} rejected: ${stories.size} stories, ${digest.paragraphs.length} paragraphs (will try again next run)`);
      return null;
    }
    return digest;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) console.log(`       ${kind.name} skipped: the API key was rejected`);
    else if (err instanceof Anthropic.RateLimitError) console.log(`       ${kind.name} paused: rate limit reached, will try again next run`);
    else if (err instanceof Anthropic.APIError) console.log(`       ${kind.name} failed (${err.status}): ${err.message}`);
    else console.log(`       ${kind.name} failed: ${err.message}`);
    return null;
  }
}
