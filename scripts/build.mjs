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
const MAX_PER_SOURCE_PER_DAY = 25; // so one busy site cannot fill a whole day
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

// Removes datelines at the start of a summary: "JATIMTIMES - ", "Surabaya (ANTARA) - ",
// "KOMINFO, Sidoarjo – ", "Pemkab Pamekasan- ", "Media Center, Senin ( 16/11 ) ".
function dropDateline(text) {
  return text
    .replace(/^[^.!?]{0,40}?\([A-Za-z]+\)\s*[-–—]\s*/, '')
    .replace(/^[A-Z][A-Z .]{2,30}\s[-–—]\s/, '')
    .replace(/^[A-Z][A-Za-z]+(?:\s[A-Z][A-Za-z]+)?,\s*[A-Z][a-z]+\s*[-–—]\s*/, '')
    .replace(/^(?:Pemkab|Pemkot|Humas|Diskominfo|Kominfo)\s+\w+\s*[-–—]\s*/, '')
    .replace(/^[^.!?]{0,40}?\(\s*\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s*\)\s*[-–—,]?\s*/, '');
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
      const summary = dropDateline(clean(item.contentSnippet || item.content || item.summary || ''));
      const title = clean(item.title);
      // some feeds repeat the headline at the start of the summary
      const body = summary.startsWith(title) ? summary.slice(title.length).replace(/^[^\p{L}\p{N}"'(]+/u, '') : summary;
      return {
        title,
        link: (item.link || item.guid || '').trim(),
        date: isNaN(date) ? null : date.toISOString(),
        summary: shorten(body, SUMMARY_LENGTH),
        image: findImage(item),
        ...sourceFields(source),
      };
    }).filter((a) => a.title && a.link.startsWith('http') && a.date);
    console.log(`  ok   ${String(items.length).padStart(3)}  ${source.name} (${source.section})`);
    return items;
  } catch (err) {
    console.log(`  FAIL      ${source.name} (${source.section}): ${err.cause?.message || err.message}`);
    return [];
  }
}

function sourceFields(source) {
  const fields = { source: source.name, section: source.section, lang: source.lang };
  if (source.official) Object.assign(fields, { official: true, homeArea: source.area, place: source.place });
  return fields;
}

const get = (url) => fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) })
  .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); });

const MONTHS = { januari: 0, februari: 1, maret: 2, april: 3, mei: 4, juni: 5, juli: 6, agustus: 7, september: 8, oktober: 9, november: 10, desember: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, agu: 7, agt: 7, ags: 7, sep: 8, okt: 9, nov: 10, des: 11 };

function metaTag(page, name) {
  const n = name.replace(/[.:]/g, '\\$&');
  // content="..." or content='...': the closing quote must match the opening one (titles contain apostrophes)
  const m = page.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*content=(["'])([\\s\\S]*?)\\1`, 'i'))
    || page.match(new RegExp(`<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]*(?:property|name|itemprop)=["']${n}["']`, 'i'));
  return m ? clean(m[2]) : '';
}

// Finds the publication date on an article page: machine-readable tags first, then a written
// Indonesian date such as "20 November 2026". Dates without a time are set to noon in Jakarta.
function findDate(page, opening = '') {
  const machine = metaTag(page, 'article:published_time') || page.match(/"datePublished"\s*:\s*"([^"]+)"/)?.[1];
  if (machine && !isNaN(new Date(machine))) return new Date(machine);
  return dateInText(opening) || dateInText(clean(page.replace(/<script[\s\S]*?<\/script>/gi, ' ')));
}

function dateInText(text) {
  const short = text.match(/\(\s*(\d{1,2})\/(\d{1,2})(?:\/(20\d\d))?\s*\)/);
  const m = text.match(/\b(\d{1,2})\s+(Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember|Jan|Feb|Mar|Apr|Jun|Jul|Agu|Agt|Ags|Sep|Okt|Nov|Des)\.?\s+(20\d\d)\b/i);
  // Press releases write their date as "(16/11)" right after the place: prefer that.
  let noon = null;
  if (short) {
    const year = Number(short[3]) || new Date().getUTCFullYear();
    noon = new Date(Date.UTC(year, Number(short[2]) - 1, Number(short[1]), 5));
    if (!short[3] && noon - Date.now() > 86400000) noon.setUTCFullYear(year - 1);  // "(28/12)" read in January
  } else if (m) noon = new Date(Date.UTC(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]), 5));
  if (!noon || isNaN(noon)) return null;
  return noon > new Date() ? new Date() : noon;
}

// Reads one article page and returns its headline, summary, photo and date.
async function readArticle(url, source, linkText) {
  const page = await get(url);
  // Many government pages use the site's name as their title; skip those.
  const generic = (t) => !t || t.length < 15 || /^(?:Pemerintah\s+(?:Kota|Kabupaten|Provinsi)|Pemkot|Pemkab|Portal|Website|Beranda|Home)\b/i.test(t) && t.length < 60;
  const description = metaTag(page, 'og:description') || metaTag(page, 'description');
  const title = [
    metaTag(page, 'og:title'),
    clean(page.match(/<title>([\s\S]*?)<\/title>/i)?.[1]).split(/\s+[|–]\s+|\s+-\s+(?=Pemerintah|Pemkab|Pemkot|Portal)/)[0],
    clean(page.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]),
    description.length < 160 && !/[.!?]$/.test(description) ? description : '',
    linkText,
  ].map((t) => (t || '').replace(/\s+[-|–]\s+(?:Pemerintah|Pemkab|Pemkot|Portal|Website|Diskominfo|Kominfo)\b[^|–]*$/i, ''))
    .find((t) => !generic(t)) || '';
  // A summary is a real sentence: long, with mostly lower-case words (menu text is Title Case).
  const sentence = (t) => t.length > 80 && !t.startsWith(title)
    && t.split(/\s+/).filter((w) => /^[a-z]/.test(w)).length >= t.split(/\s+/).length * 0.25;
  let summary = sentence(description) ? description : '';
  if (!summary) summary = [...page.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).find(sentence) || '';
  summary = dropDateline(summary);
  const image = metaTag(page, 'og:image');
  const opening = description + ' ' + ([...page.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).find(sentence) || '');
  const date = findDate(page, opening) || new Date();
  return {
    title,
    link: url,
    date: date.toISOString(),
    summary: shorten(summary, SUMMARY_LENGTH),
    image: image.startsWith('http') ? image : null,
    ...sourceFields(source),
  };
}

// For official websites without a news feed: finds article links on the news page, then reads
// each article page it has not seen before.
async function fetchHtmlSource(source, known) {
  try {
    const page = await get(source.url);
    const pattern = new RegExp(source.links);
    const texts = new Map();
    for (const m of page.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = new URL(decode(m[1]), source.url).href.split('#')[0];
      if (!pattern.test(href) || href.includes('?text=')) continue;
      const text = clean(m[2]);
      if (text.length > (texts.get(href) || '').length) texts.set(href, text);
    }
    const links = [...texts].filter(([, text]) => text.length >= (source.minText || 20)).map(([href]) => href).slice(0, 12);
    const fresh = links.filter((href) => !known.has(href));
    const items = [];
    for (const href of fresh) {  // one at a time, to be gentle with government servers
      try {
        items.push(await readArticle(href, source, texts.get(href).split(' ... ')[0]));
        known.add(href);  // remembered even if the article is not kept (too old, or not about East Java)
      } catch (err) { console.log(`       skip ${href}: ${err.message}`); }
    }
    console.log(`  ok   ${String(links.length).padStart(3)}  ${source.name} (${fresh.length} new)`);
    return items.filter((a) => a.title);
  } catch (err) {
    console.log(`  FAIL      ${source.name}: ${err.cause?.message || err.message}`);
    return [];
  }
}

// Words that, placed before a strict word, show it is a place name: "Kota Batu", "Pemkab Malang".
const PLACE_PREFIX = '(?:Kota|Kabupaten|Kab\\.|Pemkot|Pemkab|Polres|Polresta|Bupati|Wali Kota|Wakil Wali Kota|Wawali|DPRD|Kecamatan|Kejari|Kodim|Dinas\\s+\\S+|warga|di|ke|dari|asal|in|from|to|of)';

function areaMatchers(areas) {
  return Object.entries(areas)
    .filter(([key]) => !key.startsWith('_'))
    .map(([key, area]) => {
      const escape = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const parts = [];
      if (area.words.length) parts.push(`\\b(?:${area.words.map(escape).join('|')})\\b`);
      if (area.strict.length) parts.push(`\\b${PLACE_PREFIX}\\s+(?:${area.strict.map(escape).join('|')})\\b`);
      return { key, regex: new RegExp(parts.join('|')) };
    });
}

function tagAreas(articles, matchers) {
  for (const a of articles) {
    if (a.section !== 'jatim') continue;
    const text = a.title + ' ' + a.summary;
    a.areas = matchers.filter((m) => m.regex.test(text)).map((m) => m.key);
    if (a.official && !a.areas.includes(a.homeArea)) a.areas.push(a.homeArea);
  }
}

// Government sites also repost national releases (from ministries, for example). Keep only
// official releases that mention their own place or another East Java area.
const aboutEastJava = (a, matchers) => !a.official
  || (a.title + ' ' + a.summary).toLowerCase().includes(a.place.toLowerCase())
  || matchers.some((m) => m.regex.test(a.title + ' ' + a.summary));

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
    const saved = JSON.parse(await readFile(archiveFile, 'utf8'));
    return { articles: saved.articles || [], seen: saved.seen || [] };
  } catch {
    return { articles: [], seen: [] };
  }
}

async function main() {
  const sources = JSON.parse(await readFile(path.join(root, 'sources.json'), 'utf8'));
  console.log(`Collecting news from ${sources.length} sources…`);
  const saved = await readArchive();
  const previous = saved.articles;
  // Links of official pages already read, so government servers are not asked twice.
  const known = new Set([...saved.seen, ...previous.map((a) => a.link)]);
  const fresh = (await Promise.all(sources.map((s) => (s.type === 'html' ? fetchHtmlSource(s, known) : fetchSource(s))))).flat();

  // Fresh copies first, so updated titles and images win over older saved copies.
  // Drop saved articles from sections that no longer exist in sources.json.
  const sections = new Set(sources.map((s) => s.section));
  const areas = JSON.parse(await readFile(path.join(root, 'areas.json'), 'utf8'));
  const matchers = areaMatchers(areas);
  const candidates = [...fresh, ...previous.filter((a) => sections.has(a.section))].filter((a) => aboutEastJava(a, matchers));
  const archive = pickArticles(candidates, KEEP_DAYS);
  tagAreas(archive, matchers);
  if (archive.length === 0) throw new Error('No articles were collected. Check the network and sources.json.');
  await mkdir(path.dirname(archiveFile), { recursive: true });
  const seen = [...known].slice(-3000);
  await writeFile(archiveFile, JSON.stringify({ updated: new Date().toISOString(), articles: archive, seen }) + '\n');

  const editionStart = Date.now() - EDITION_DAYS * 86400000;
  const articles = archive.filter((a) => new Date(a.date).getTime() >= editionStart);

  const data = {
    updated: new Date().toISOString(),
    sources: [...new Set(sources.filter((s) => !s.official).map((s) => s.name))],
    official: [...new Set(sources.filter((s) => s.official).map((s) => s.name))],
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
  const inArea = (k) => articles.filter((a) => a.areas?.includes(k)).length;
  console.log(`Done: ${articles.length} articles this edition; archive holds ${archive.length} → dist/index.html`);
  console.log(`  Official releases ${articles.filter((a) => a.official).length}`);
  console.log(`  Jawa Timur ${count('jatim')} (Surabaya Raya ${inArea('surabaya')}, Malang Raya ${inArea('malang')}, Madura ${inArea('madura')}, Mataraman ${inArea('mataraman')}), Dunia ${count('dunia')}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
