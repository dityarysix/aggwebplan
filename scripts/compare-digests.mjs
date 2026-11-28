// One-off test: writes today's daily wrap-up with Haiku, Sonnet and Opus from the SAME list of
// stories and the SAME instructions, so the three can be compared side by side. Nothing is
// published: the result goes to perbandingan/hasil.md (the workflow saves it on its own branch).
// Needs ANTHROPIC_API_KEY. Run from GitHub: Actions > "Bandingkan model ringkasan" > Run workflow.
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM, SCHEMA, KINDS, economical } from './digest.mjs';

const SITE = process.env.SITE_URL || 'https://jatimsepekan.com';
const MODELS = [  // price per million tokens: input, output (prompts up to 100K tokens)
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', input: 0.10, output: 0.50 },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', input: 2, output: 10 },
  { id: 'claude-opus-5-5', label: 'Opus 5.5', input: 4, output: 20 },
];

const WEEKDAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const AREA_NAMES = { surabaya: 'Surabaya Raya', malang: 'Malang Raya', madura: 'Madura', mataraman: 'Mataraman', tapalkuda: 'Tapal Kuda', jelajah: 'Jelajah Jatim' };
const longDate = (iso) => {
  const d = new Date(new Date(iso).getTime() + 7 * 3600000);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

// The same candidate list the real daily wrap-up gets (see digestCandidates in build.mjs): East Java
// stories in Indonesian from the last 24 hours, stories reported by two outlets and official
// releases first, at most 60.
async function candidates() {
  const response = await fetch(`${SITE}/edisi.json`);
  if (!response.ok) throw new Error(`edisi.json: HTTP ${response.status}`);
  const { articles } = await response.json();
  const since = Date.now() - 24 * 3600000;
  return articles
    .filter((a) => a.section === 'jatim' && a.lang === 'id' && new Date(a.date) >= since)
    .sort((a, b) => (b.also ? 1 : 0) - (a.also ? 1 : 0) || (b.official ? 1 : 0) - (a.official ? 1 : 0) || b.date.localeCompare(a.date))
    .slice(0, 60)
    .map((a, i) => {
      const areas = (a.areas || []).filter((k) => AREA_NAMES[k] && k !== 'jelajah').map((k) => AREA_NAMES[k]).join(', ');
      let line = `[${i + 1}] ${longDate(a.date)}${areas ? ` (${areas})` : ''}. ${a.source}: ${a.title}. ${a.summary}`;
      if (a.also) line += ` Juga diberitakan ${a.also.source}: ${a.also.summary}`;
      return { id: i + 1, line, article: a };
    });
}

async function run(client, model, list) {
  const kind = KINDS.daily;
  const started = Date.now();
  try {
    const response = await client.messages.create({
      model: model.id,
      max_tokens: 16000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM(kind),
      messages: [{ role: 'user', content: `Daftar berita:\n\n${list.map((c) => c.line).join('\n\n')}` }],
    });
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const usage = response.usage || {};
    const cost = ((usage.input_tokens || 0) * model.input + (usage.output_tokens || 0) * model.output) / 1e6;
    if (response.stop_reason !== 'end_turn') return { model, error: `stopped: ${response.stop_reason}`, seconds, usage, cost };
    const text = response.content.filter((block) => block.type === 'text').map((block) => block.text).join('');
    return { model, digest: JSON.parse(text), seconds, usage, cost };
  } catch (err) {
    return { model, error: `${err.status || ''} ${err.message}`.trim(), seconds: Math.round((Date.now() - started) / 100) / 10 };
  }
}

// The economical way (cara hemat) that the daily wrap-up uses now: Opus picks the stories in a
// short answer, Haiku writes from them. Cost is the sum of both steps.
async function runEconomical(list) {
  const started = Date.now();
  const label = { id: 'claude-opus-5-5 memilih + claude-haiku-5-5 menulis', label: 'Cara hemat (Opus memilih, Haiku menulis)' };
  try {
    const result = await economical(KINDS.daily, list);
    const seconds = Math.round((Date.now() - started) / 100) / 10;
    const price = (id) => MODELS.find((m) => m.id === id);
    const cost = result.steps.reduce((sum, st) => sum + ((st.usage.input_tokens || 0) * price(st.model).input + (st.usage.output_tokens || 0) * price(st.model).output) / 1e6, 0);
    const usage = { input_tokens: result.steps.reduce((n, st) => n + (st.usage.input_tokens || 0), 0), output_tokens: result.steps.reduce((n, st) => n + (st.usage.output_tokens || 0), 0) };
    const byId = new Map(list.map((c) => [c.id, c]));
    const extra = (result.picks || []).map((p) => `  - [${p.id}] ${byId.get(p.id).article.title} (sudut: ${p.sudut})`);
    if (!result.digest) return { model: label, error: result.reason || 'tidak lolos pemeriksaan', seconds, usage, cost, extra };
    return { model: label, digest: result.digest, seconds, usage, cost, extra };
  } catch (err) {
    return { model: label, error: `${err.status || ''} ${err.message}`.trim(), seconds: Math.round((Date.now() - started) / 100) / 10 };
  }
}

function describe(result, list) {
  const lines = [`## ${result.model.label} (${result.model.id})`, ''];
  if (result.error) return [...lines, `**Gagal:** ${result.error}`, ...(result.extra?.length ? ['', 'Berita yang dipilih Opus:', ...result.extra] : []), ''].join('\n');
  const { digest } = result;
  const ids = new Set(list.map((c) => c.id));
  const stories = new Set(digest.paragraphs.map((p) => p.story).filter((id) => id));
  const words = digest.paragraphs.reduce((n, p) => n + p.text.split(/\s+/).length, 0);
  const bad = digest.paragraphs.filter((p) => p.story && !ids.has(p.story)).length;
  lines.push(
    `- Biaya: **US$${result.cost.toFixed(4)}** (${result.usage.input_tokens} token masuk, ${result.usage.output_tokens} token keluar), waktu ${result.seconds} detik`,
    `- ${digest.paragraphs.length} paragraf, ${stories.size} berita dirangkum, ${words} kata${bad ? `, **${bad} nomor berita tidak valid**` : ''}`,
    ...(result.extra?.length ? ['', 'Berita yang dipilih Opus:', ...result.extra] : []),
    '', `### Judul: ${digest.title}`, '');
  for (const p of digest.paragraphs) {
    const source = p.story && ids.has(p.story) ? list.find((c) => c.id === p.story).article : null;
    lines.push(`${p.text}`, source ? `> berita [${p.story}] (${source.source}): ${source.title}` : '> (pembuka atau penutup)', '');
  }
  return lines.join('\n');
}

const list = await candidates();
if (list.length < 6) throw new Error(`only ${list.length} stories in the last 24 hours`);
const client = new Anthropic();
const results = [];
for (const model of MODELS) results.push(await run(client, model, list));  // one at a time
results.push(await runEconomical(list));

const now = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
const report = [
  `# Perbandingan model: ringkasan harian (${now} WIB)`, '',
  `Instruksi dan daftar berita sama untuk keempat percobaan (${list.length} kandidat, 24 jam terakhir). Tidak ada yang diterbitkan.`, '',
  '| Model | Biaya | Waktu | Paragraf | Berita dirangkum |', '|---|---|---|---|---|',
  ...results.map((r) => r.error
    ? `| ${r.model.label} | - | ${r.seconds} dtk | gagal: ${r.error} | - |`
    : `| ${r.model.label} | US$${r.cost.toFixed(4)} | ${r.seconds} dtk | ${r.digest.paragraphs.length} | ${new Set(r.digest.paragraphs.map((p) => p.story).filter(Boolean)).size} |`),
  '', '---', '', ...results.map((r) => describe(r, list)),
  '---', '', '## Daftar berita yang diberikan ke ketiga model', '', ...list.map((c) => c.line), '',
].join('\n');

await mkdir('perbandingan', { recursive: true });
await writeFile('perbandingan/hasil.md', report);
// The whole report also goes into the run summary, as a second place to read it.
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report);
console.log(report.split('\n---\n')[0]);
