// Reads the "Catatan Sepekan" columns: one Markdown file per column in catatan/.
// See catatan/README.md for the format.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Bold, italic and links inside a line of already-escaped text.
function inline(text) {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, href) => `<a href="${href}" rel="noopener">${label}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// The small part of Markdown the column template explains: paragraphs, "## " subheadings,
// "> " quotes and "- " lists.
export function markdownToHtml(markdown) {
  return markdown.trim().split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines[0].startsWith('## ')) return `<h2>${inline(lines.join(' ').slice(3))}</h2>`;
    if (lines.every((l) => l.startsWith('- '))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`;
    if (lines.every((l) => l.startsWith('>'))) return `<blockquote><p>${inline(lines.map((l) => l.replace(/^>\s?/, '')).join(' '))}</p></blockquote>`;
    return `<p>${inline(lines.join(' '))}</p>`;
  }).join('\n      ');
}

// The first paragraph as plain text, for the front page and search engines.
function firstParagraph(markdown) {
  const block = markdown.trim().split(/\n\s*\n/).find((b) => !/^(##|>|-)\s/.test(b.trim())) || '';
  return block.replace(/\s+/g, ' ').replace(/\*\*?([^*]+)\*\*?/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
}

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

// Returns the published columns, newest first. A column with a future date (Jakarta time) waits.
export async function readColumns(dir) {
  let files = [];
  try { files = await readdir(dir); } catch { return []; }
  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const columns = [];
  for (const file of files) {
    if (!file.endsWith('.md') || file.startsWith('_') || file.toLowerCase() === 'readme.md') continue;
    const text = (await readFile(path.join(dir, file), 'utf8')).replace(/\r\n/g, '\n');
    const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) { console.log(`  column skipped (no --- header): ${file}`); continue; }
    const fields = Object.fromEntries(match[1].split('\n').map((line) => {
      const i = line.indexOf(':');
      return i < 0 ? [] : [line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim()];
    }).filter((pair) => pair.length));
    const date = /^\d{4}-\d{2}-\d{2}$/.test(fields.tanggal || '') ? fields.tanggal : null;
    if (!fields.judul || !date) { console.log(`  column skipped (needs judul and tanggal YYYY-MM-DD): ${file}`); continue; }
    if (date > today) { console.log(`  column waiting until ${date}: ${file}`); continue; }
    columns.push({
      title: fields.judul,
      author: fields.penulis || 'Redaksi Jawa Timur Sepekan',
      date: `${date}T01:00:00.000Z`,  // 08:00 WIB on that day
      image: /^https?:\/\//.test(fields.gambar || '') ? fields.gambar : null,
      summary: firstParagraph(match[2]),
      html: markdownToHtml(match[2]),
      page: `catatan/${slugify(file.replace(/\.md$/, ''))}.html`,
    });
  }
  return columns.sort((a, b) => b.date.localeCompare(a.date));
}
