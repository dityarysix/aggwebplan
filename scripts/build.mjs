// Collects headlines from the RSS feeds in sources.json, adds them to the weekly archive
// (data/archive.json) and builds the website into dist/.
// Run with: npm run build
import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Parser from 'rss-parser';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import { canRewrite, writeStory } from './rewrite.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const archiveFile = path.join(root, 'data', 'archive.json');

const DOMAIN = 'jatimsepekan.com';
const EDITION_DAYS = 7;          // one edition = the last 7 days
const KEEP_DAYS = 8;             // the archive keeps a little more than one edition
const MAX_PER_SOURCE_PER_DAY = 25; // so one busy site cannot fill a whole day
const SUMMARY_LENGTH = 200;      // characters
const MAX_STORIES_PER_RUN = 15;  // AI-written articles per hourly run, to keep the cost predictable
const BODY_LENGTH = 8000;        // characters of a press release kept for the AI writer
const USER_AGENT = 'Mozilla/5.0 (compatible; JatimSepekan/0.2; +https://' + DOMAIN + ')';

// Indonesian sites can be slow to answer servers abroad (GitHub runs in the US): allow 30 seconds
// to connect instead of 10. EnvHttpProxyAgent also respects a proxy when one is set.
setGlobalDispatcher(new EnvHttpProxyAgent({ connect: { timeout: 30000 } }));

// Downloads a page; when it fails (timeout, connection reset, server error, block), waits a
// few seconds and tries once more.
async function fetchText(url, attempts = 2) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (err) {
      if (attempt >= attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

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

// Removes promotional leftovers from a summary: links, "Ikuti kami di ...", "Baca juga ...",
// and labels such as "Ringkasan Berita *".
function tidySummary(text = '') {
  return text
    .replace(/^Ringkasan Berita\s*\*?\s*/i, '')
    .split(/\s+--\s+|\s*(?:Ikuti kami|Baca juga|Simak juga|Simak berita|Dapatkan update|Klik di sini)\b/i)[0]
    .replace(/(?:👉\s*)?https?:\/\/\S+/g, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
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
    const feed = await parser.parseString(await fetchText(source.url));
    const items = feed.items.map((item) => {
      const date = new Date(item.isoDate || item.pubDate);
      const summary = dropDateline(clean(item.contentSnippet || item.content || item.summary || ''));
      const title = clean(item.title);
      // some feeds repeat the headline at the start of the summary
      const body = summary.startsWith(title) ? summary.slice(title.length).replace(/^[^\p{L}\p{N}"'(]+/u, '') : summary;
      const fullText = source.official ? paragraphsOf(item['content:encoded'] || item.content || '') : undefined;
      return {
        title,
        body: fullText,
        link: (item.link || item.guid || '').trim(),
        date: isNaN(date) ? null : date.toISOString(),
        summary: shorten(tidySummary(body), SUMMARY_LENGTH),
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

// A summary is a real sentence: long, with enough lower-case words (menu text is Title Case).
const isSentence = (t) => t.length > 80
  && t.split(/\s+/).filter((w) => /^[a-z]/.test(w)).length >= t.split(/\s+/).length * 0.25;

// The readable paragraphs of an HTML fragment, joined with blank lines.
function paragraphsOf(html) {
  const parts = [...String(html).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).filter(isSentence);
  return [...new Set(parts)].join('\n\n').slice(0, BODY_LENGTH) || undefined;
}

function sourceFields(source) {
  const fields = { source: source.name, section: source.section, lang: source.lang };
  if (source.official) Object.assign(fields, { official: true, homeArea: source.area, place: source.place });
  return fields;
}

const get = (url) => fetchText(url);

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
  const sentence = (t) => isSentence(t) && !t.startsWith(title);
  let summary = sentence(description) ? description : '';
  if (!summary) summary = [...page.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).find(sentence) || '';
  summary = dropDateline(summary);
  const image = metaTag(page, 'og:image');
  const opening = description + ' ' + ([...page.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map((m) => clean(m[1])).find(sentence) || '');
  const date = findDate(page, opening) || new Date();
  return {
    title,
    body: paragraphsOf(page),
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

  const kept = new Map();
  const counts = {};
  const result = [];
  for (const a of newestFirst) {
    // The same story often appears in several feeds: keep the first copy only, but carry over
    // an article already written for it (the fresh copy from the feed does not have one).
    const key = a.section + '|' + a.title.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const linkKey = a.section + '|' + a.link;
    const earlier = kept.get(key) || kept.get(linkKey);
    if (earlier) {
      if (!earlier.story && a.story) earlier.story = a.story;
      if (!earlier.body && a.body) earlier.body = a.body;
      continue;
    }
    kept.set(key, a); kept.set(linkKey, a);
    const perDay = `${a.section}|${a.source}|${jakartaDay(a.date)}`;
    counts[perDay] = (counts[perDay] || 0) + 1;
    if (counts[perDay] > MAX_PER_SOURCE_PER_DAY) continue;
    result.push(a);
  }
  return result;
}

// "jatim.antaranews.com" -> "antaranews.com", "www.detik.com" -> "detik.com",
// "sumenepkab.go.id" stays as it is (Indonesian second-level domains such as .go.id and .co.id).
function siteName(link) {
  const labels = new URL(link).hostname.replace(/^www\./, '').split('.');
  const keep = /^(?:go|co|ac|or|web|my|sch|net)$/.test(labels.at(-2)) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

const STOPWORDS = new Set(('yang dengan untuk dari dalam pada akan oleh atas bagi para ini itu jadi lebih secara '
  + 'kabupaten kota pemkab pemkot pemerintah jawa timur jatim tahun hari warga masyarakat juga telah sudah bisa '
  + 'tidak menjadi saat setelah sebagai kepada antara karena masih adalah').split(' '));
const keywords = (text) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4 && !STOPWORDS.has(w)));
const sharedCount = (a, b) => [...a].filter((w) => b.has(w)).length;

// Same story: at least half of the headline keywords shared, and the headline plus summary
// overlapping clearly. Headlines alone mix up a match preview with its result.
function sameStory(a, b) {
  if (a.section !== b.section || a.source === b.source) return false;
  if (Math.abs(new Date(a.date) - new Date(b.date)) > 36 * 3600000) return false;
  const ta = keywords(a.title), tb = keywords(b.title);
  const inTitles = sharedCount(ta, tb);
  if (inTitles < 2 || inTitles / Math.min(ta.size, tb.size) < 0.5) return false;
  const fa = keywords(a.title + ' ' + a.summary), fb = keywords(b.title + ' ' + b.summary);
  const inBoth = sharedCount(fa, fb);
  return inBoth / (fa.size + fb.size - inBoth) >= 0.2;
}

// The same story is often reported by two outlets. Attach the second outlet's version to the
// first ("also"), so the page shows one story with two sources. Official releases go first,
// because they get their own article page.
function groupSameStories(articles) {
  const order = [...articles].sort((a, b) => (b.official ? 1 : 0) - (a.official ? 1 : 0) || b.date.localeCompare(a.date));
  const primaries = [];
  const absorbed = new Set();
  for (const a of order) {
    const match = primaries.find((p) => !p.also && sameStory(p, a));
    if (match) {
      match.also = { source: a.source, link: a.link, summary: a.summary, site: siteName(a.link), official: a.official || undefined };
      absorbed.add(a);
    } else primaries.push(a);
  }
  return articles.filter((a) => !absorbed.has(a));
}

const pageSlug = (a) => a.title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70)
  + '-' + createHash('sha1').update(a.link).digest('hex').slice(0, 6);

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Wraps the last three words of a paragraph in a link to the source.
function linkLastWords(paragraph, href) {
  const words = paragraph.split(' ');
  const cut = Math.max(0, words.length - 3);
  const lead = words.slice(0, cut).join(' ');
  const tail = words.slice(cut).join(' ');
  const trailing = tail.match(/[.,;:!?"”)]+$/)?.[0] || '';
  const linked = trailing ? tail.slice(0, -trailing.length) : tail;
  return `${escapeHtml(lead)}${lead ? ' ' : ''}<a href="${escapeHtml(href)}" rel="noopener">${escapeHtml(linked)}</a>${escapeHtml(trailing)}`;
}

const WEEKDAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
function longDate(iso) {
  const d = new Date(new Date(iso).getTime() + 7 * 3600000);  // Jakarta time
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function renderStoryPage(template, a) {
  // Paragraph 1 links to the official source; paragraph 2 to the second outlet, when there is one.
  const paragraphs = a.story.map((p, i) => {
    if (i === 0) return `<p>${linkLastWords(p, a.link)}</p>`;
    if (i === 1 && a.also) return `<p>${linkLastWords(p, a.also.link)}</p>`;
    return `<p>${escapeHtml(p)}</p>`;
  });
  const sites = [siteName(a.link), a.also?.site].filter(Boolean);
  const fill = {
    TITLE: escapeHtml(a.title),
    DESCRIPTION: escapeHtml(a.story[0].slice(0, 160)),
    URL: `https://${DOMAIN}/${a.page}`,
    IMAGE: a.image ? `<figure class="story__image"><img src="${escapeHtml(a.image)}" alt="" referrerpolicy="no-referrer"></figure>` : '',
    OG_IMAGE: a.image ? `<meta property="og:image" content="${escapeHtml(a.image)}">` : '',
    SOURCE: escapeHtml(a.source),
    DATE: escapeHtml(longDate(a.date)),
    DATETIME: escapeHtml(a.date),
    BODY: paragraphs.join('\n      '),
    SITES: escapeHtml(sites.join(', ')),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => fill[key] ?? '');
}

// Writes articles for official releases that do not have one yet.
async function writeStories(archive) {
  const waiting = archive.filter((a) => a.official && !a.story);
  if (!waiting.length) return;
  if (!canRewrite()) {
    console.log(`  AI writing off (no ANTHROPIC_API_KEY): ${waiting.length} official releases keep their summary only`);
    return;
  }
  let written = 0;
  for (const a of waiting.slice(0, MAX_STORIES_PER_RUN)) {
    if (!a.body) {  // saved before full texts were kept: read the release page once more
      try { a.body = paragraphsOf(await get(a.link)); } catch { /* try again next run */ }
      if (!a.body) continue;
    }
    const story = await writeStory(a);
    if (story) { a.story = story; written++; }
  }
  console.log(`  AI writing: ${written} new articles (${Math.max(0, waiting.length - MAX_STORIES_PER_RUN)} left for the next run)`);
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
  await writeStories(archive);
  for (const a of archive) {
    if (a.story) delete a.body;  // the full release text is only needed until the article is written
    a.page = a.story ? `berita/${pageSlug(a)}.html` : undefined;
  }
  if (archive.length === 0) throw new Error('No articles were collected. Check the network and sources.json.');
  await mkdir(path.dirname(archiveFile), { recursive: true });
  const seen = [...known].slice(-3000);
  await writeFile(archiveFile, JSON.stringify({ updated: new Date().toISOString(), articles: archive, seen }) + '\n');

  const editionStart = Date.now() - EDITION_DAYS * 86400000;
  const edition = archive.filter((a) => new Date(a.date).getTime() >= editionStart)
    .map((a) => ({ ...a, summary: tidySummary(a.summary), also: undefined, body: undefined, homeArea: undefined, place: undefined, site: siteName(a.link) }));
  const articles = groupSameStories(edition);

  const data = {
    updated: new Date().toISOString(),
    sources: [...new Set(sources.filter((s) => !s.official).map((s) => s.name))],
    official: [...new Set(sources.filter((s) => s.official).map((s) => s.name))],
    articles: articles.map(({ story, ...rest }) => rest),  // the full article text lives on its own page
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

  // One page per AI-written official release.
  const storyTemplate = await readFile(path.join(root, 'src', 'article.html'), 'utf8');
  const withPages = articles.filter((a) => a.story);
  if (withPages.length) await mkdir(path.join(dist, 'berita'), { recursive: true });
  for (const a of withPages) await writeFile(path.join(dist, a.page), renderStoryPage(storyTemplate, a));

  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  const template = await readFile(path.join(root, 'src', 'index.html'), 'utf8');
  await writeFile(path.join(dist, 'index.html'), template.replace('__NEWS_DATA__', () => json));

  const count = (s) => articles.filter((a) => a.section === s).length;
  const inArea = (k) => articles.filter((a) => a.areas?.includes(k)).length;
  console.log(`Done: ${articles.length} articles this edition; archive holds ${archive.length} → dist/index.html`);
  console.log(`  Official releases ${articles.filter((a) => a.official).length}, with their own article page ${withPages.length}`);
  console.log(`  Stories reported by two outlets ${articles.filter((a) => a.also).length}`);
  console.log(`  Jawa Timur ${count('jatim')} (Surabaya Raya ${inArea('surabaya')}, Malang Raya ${inArea('malang')}, Madura ${inArea('madura')}, Mataraman ${inArea('mataraman')}), Dunia ${count('dunia')}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
