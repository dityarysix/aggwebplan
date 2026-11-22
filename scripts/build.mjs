// Collects headlines from the RSS feeds in sources.json, adds them to the weekly archive
// (data/archive.json) and builds the website into dist/.
// Run with: npm run build
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import Parser from 'rss-parser';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const archiveFile = path.join(root, 'data', 'archive.json');

const DOMAIN = 'jatimsepekan.com';
const EDITION_DAYS = 7;          // one edition = the last 7 days
const KEEP_DAYS = 8;             // the archive keeps a little more than one edition
const MAX_PER_SOURCE_PER_DAY = 10; // so one busy site cannot fill a whole day
const SUMMARY_LENGTH = 200;      // characters
const USER_AGENT = 'Mozilla/5.0 (compatible; JatimSepekan/0.2; +https://' + DOMAIN + ')';

const parser = new Parser({
  customFields: { item: [['media:content', 'mediaContent'], ['media:thumbnail', 'mediaThumbnail']] },
});

const decode = (s) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&[a-z]+;/gi, ' ');

const clean = (html = '') => decode(String(html).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

function shorten(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[\s,.;:–-]+$/, '') + '…';
}

function findImage(item) {
  const fromAttr = (x) => x && (x.$?.url || x.url);
  const candidates = [
    item.enclosure?.type?.startsWith('image') || item.enclosure?.url?.match(/\.(jpe?g|png|webp)/i) ? item.enclosure.url : null,
    fromAttr(Array.isArray(item.mediaContent) ? item.mediaContent[0] : item.mediaContent),
    fromAttr(Array.isArray(item.mediaThumbnail) ? item.mediaThumbnail[0] : item.mediaThumbnail),
    (item['content:encoded'] || item.content || '').match(/<img[^>]+src=["']([^"']+)["']/i)?.[1],
  ];
  const url = candidates.find((u) => typeof u === 'string' && u.startsWith('http'));
  return url ? decode(url) : null;
}

async function fetchSource(source) {
  try {
    const response = await fetch(source.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const feed = await parser.parseString(await response.text());
    const items = feed.items.map((item) => {
      const date = new Date(item.isoDate || item.pubDate);
      const summary = clean(item.contentSnippet || item.content || item.summary || '')
        // drop datelines such as "JATIMTIMES - " or "Surabaya (ANTARA) - " at the start
        .replace(/^[^.!?]{0,40}?\([A-Za-z]+\)\s*[-–—]\s*/, '')
        .replace(/^[A-Z][A-Z .]{2,30}\s[-–—]\s/, '');
      return {
        title: clean(item.title),
        link: (item.link || item.guid || '').trim(),
        date: isNaN(date) ? null : date.toISOString(),
        summary: shorten(summary, SUMMARY_LENGTH),
        image: findImage(item),
        source: source.name,
        section: source.section,
        lang: source.lang,
      };
    }).filter((a) => a.title && a.link.startsWith('http') && a.date);
    console.log(`  ok   ${String(items.length).padStart(3)}  ${source.name} (${source.section})`);
    return items;
  } catch (err) {
    console.log(`  FAIL      ${source.name} (${source.section}): ${err.cause?.message || err.message}`);
    return [];
  }
}

const jakartaDay = (iso) => new Date(new Date(iso).getTime() + 7 * 3600000).toISOString().slice(0, 10);

function pickArticles(all, keepDays) {
  const oldest = Date.now() - keepDays * 86400000;
  const newestFirst = all
    .filter((a) => new Date(a.date).getTime() >= oldest && new Date(a.date).getTime() <= Date.now() + 3600000)
    .sort((a, b) => b.date.localeCompare(a.date));

  const seen = new Set();
  const counts = {};
  const result = [];
  for (const a of newestFirst) {
    // The same story often appears in several feeds: keep the first copy only.
    const key = a.section + '|' + a.title.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (seen.has(key) || seen.has(a.section + '|' + a.link)) continue;
    seen.add(key); seen.add(a.section + '|' + a.link);
    const perDay = `${a.section}|${a.source}|${jakartaDay(a.date)}`;
    counts[perDay] = (counts[perDay] || 0) + 1;
    if (counts[perDay] > MAX_PER_SOURCE_PER_DAY) continue;
    result.push(a);
  }
  return result;
}

async function readArchive() {
  try {
    return JSON.parse(await readFile(archiveFile, 'utf8')).articles || [];
  } catch {
    return [];
  }
}

async function main() {
  const sources = JSON.parse(await readFile(path.join(root, 'sources.json'), 'utf8'));
  console.log(`Collecting news from ${sources.length} feeds…`);
  const fresh = (await Promise.all(sources.map(fetchSource))).flat();
  const previous = await readArchive();

  // Fresh copies first, so updated titles and images win over older saved copies.
  const archive = pickArticles([...fresh, ...previous], KEEP_DAYS);
  if (archive.length === 0) throw new Error('No articles were collected. Check the network and sources.json.');
  await mkdir(path.dirname(archiveFile), { recursive: true });
  await writeFile(archiveFile, JSON.stringify({ updated: new Date().toISOString(), articles: archive }) + '\n');

  const editionStart = Date.now() - EDITION_DAYS * 86400000;
  const articles = archive.filter((a) => new Date(a.date).getTime() >= editionStart);

  const data = {
    updated: new Date().toISOString(),
    sources: [...new Set(sources.map((s) => s.name))],
    articles,
  };

  await rm(dist, { recursive: true, force: true });
  await mkdir(path.join(dist, 'fonts'), { recursive: true });

  const fonts = [
    ['@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2', 'serif-400.woff2'],
    ['@fontsource/source-serif-4/files/source-serif-4-latin-400-italic.woff2', 'serif-400-italic.woff2'],
    ['@fontsource/source-serif-4/files/source-serif-4-latin-600-normal.woff2', 'serif-600.woff2'],
    ['@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2', 'serif-700.woff2'],
    ['@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-400-normal.woff2', 'sans-400.woff2'],
    ['@fontsource/schibsted-grotesk/files/schibsted-grotesk-latin-600-normal.woff2', 'sans-600.woff2'],
  ];
  for (const [from, to] of fonts) await copyFile(path.join(root, 'node_modules', from), path.join(dist, 'fonts', to));
  for (const file of ['style.css', 'app.js', 'favicon.svg']) await copyFile(path.join(root, 'src', file), path.join(dist, file));
  await writeFile(path.join(dist, 'CNAME'), DOMAIN + '\n'); // tells GitHub Pages which domain to answer

  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const template = await readFile(path.join(root, 'src', 'index.html'), 'utf8');
  await writeFile(path.join(dist, 'index.html'), template.replace('__NEWS_DATA__', () => json));

  const count = (s) => articles.filter((a) => a.section === s).length;
  console.log(`Done: ${articles.length} articles this edition (Jawa Timur ${count('jatim')}, Indonesia ${count('indonesia')}, Dunia ${count('dunia')}); archive holds ${archive.length} → dist/index.html`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
