// Writes a short news article from an official government press release, using Claude.
// Needs the ANTHROPIC_API_KEY environment variable (a GitHub Actions secret on the live site).
// Without it, nothing is rewritten and the site shows the summary as usual.
import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5-5';

const SYSTEM = `Kamu adalah redaktur di Jawa Timur Sepekan, situs rangkuman berita mingguan Jawa Timur.
Tugasmu: menulis ulang satu siaran pers resmi pemerintah daerah menjadi berita yang ringkas dan netral.

Aturan:
- Tulis dalam Bahasa Indonesia baku, gaya berita, 3 sampai 5 paragraf, tiap paragraf 2 sampai 4 kalimat.
- Paragraf pertama menjawab apa, siapa, di mana, dan kapan.
- Gunakan hanya fakta yang ada di siaran pers. Jangan menambah fakta, angka, nama, atau kutipan baru.
- Nama orang, jabatan, tempat, angka, dan tanggal harus sama persis dengan siaran pers.
- Kutipan langsung boleh dipakai hanya jika ada di siaran pers, dan sebutkan siapa yang mengatakannya.
- Tulis dengan nada netral. Klaim keberhasilan ditulis sebagai klaim pemerintah daerah ("menurut Pemkab ...").
- Jangan menulis judul, baris tanggal, nama sumber, atau ajakan membaca. Itu sudah ditambahkan oleh situs.
- Balas hanya dengan paragraf beritanya, dipisahkan satu baris kosong.`;

let client = null;

export function canRewrite() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Returns the article as an array of paragraphs, or null when it could not be written.
export async function writeStory(article) {
  client ??= new Anthropic();
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',  // if the request is declined, Anthropic retries it on its recommended model
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Sumber: ${article.source}\nJudul: ${article.title}\nTanggal: ${article.date.slice(0, 10)}\n\nSiaran pers:\n${article.body}`,
      }],
    });
    if (response.stop_reason !== 'end_turn') {
      console.log(`       not rewritten (${response.stop_reason}): ${article.title}`);
      return null;
    }
    const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n');
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return paragraphs.length >= 2 ? paragraphs : null;
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) console.log('       AI writing skipped: the API key was rejected');
    else if (err instanceof Anthropic.RateLimitError) console.log('       AI writing paused: rate limit reached, will continue next hour');
    else if (err instanceof Anthropic.APIError) console.log(`       AI writing failed (${err.status}): ${err.message}`);
    else console.log(`       AI writing failed: ${err.message}`);
    return null;
  }
}
