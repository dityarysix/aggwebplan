# Jawa Timur Sepekan

A weekly digest of news from East Java, Indonesia and the world: https://jatimsepekan.com

The site collects headlines and short summaries from public news feeds (RSS)
and links every headline to the original article. Each edition covers the last 7 days.

## How it works

- `sources.json` lists the news sources. Add or remove a line to change sources.
  `section` is `jatim` or `dunia`; `lang` is `id` or `en`.
  - News feeds (RSS) need only `name` and `url`.
  - Official local government sites without a feed use `"type": "html"`: `url` is
    their news page and `links` is a pattern that matches their article links. The
    build reads each new article page once for its headline, summary, photo and date.
  - `"official": true` marks a local government source: its stories get the
    *Rilis resmi* label, always appear in its `area` tab, and are dropped when they do
    not mention `place` or another East Java area (government sites also repost
    national releases).
- Every story shows its summary with the **last three words linked to the source**, then
  "Sumber: site.com". When two outlets report the same story, both summaries appear,
  each linking to its own outlet.
- Official releases can get **their own article page** (`dist/berita/…`), written from the
  release by Claude (`scripts/rewrite.mjs`). This needs an Anthropic API key in the
  `ANTHROPIC_API_KEY` environment variable (a repository secret on GitHub). Without it,
  official releases simply show their summary. At most 15 articles are written per run.
- **Wrap-ups** (`scripts/digest.mjs`): every day from 08:00 WIB a daily wrap-up (5-6
  paragraphs) and every Friday from 17:00 WIB a weekly wrap-up (7-8 paragraphs), written by
  Claude from 3-4 interesting stories, each story paragraph linked to its source. The newest
  wrap-up leads Sorotan Utama for 2 hours, and up to 12 hours (daily) or 24 hours (weekly)
  until a story reported by two outlets arrives. Saved in `data/digests.json`.
- **Catatan Sepekan:** the editor's own column. One Markdown file per column in `catatan/`
  (see `catatan/README.md` and the template `catatan/_contoh.md`). Shown on its own page, in
  the list at `/catatan/`, and the latest one on Sorotan Utama. A future `tanggal` keeps a
  column hidden until that day.
- **Archive:** `/arsip/` lists every daily and weekly wrap-up, newest first, grouped by
  month (template `src/archive.html`). Linked from the front page, footer and article pages.
- **Search engines:** every build writes `sitemap.xml` (front page, every article and wrap-up
  page) and `robots.txt`. Article and wrap-up pages are kept permanently in
  `data/pages.json` and `data/digests.json`; a copy is published under `/data/` and is used
  to restore them if GitHub's cache is ever cleared.
- `areas.json` lists the place names for each area tab (Surabaya Raya, Malang Raya,
  Madura, Mataraman, Tapal Kuda).
- Local outlets have `"localArea"` in `sources.json`: only their stories about an East Java
  area are kept. Busy outlets can have `"maxPerDay"` (the Radar papers: 12 a day).
- `scripts/build.mjs` downloads the feeds, adds new articles to the weekly archive
  (`data/archive.json`) and builds the website into `dist/`.
- `src/` holds the page design: `index.html`, `style.css`, `app.js`.
- `.github/workflows/publish.yml` runs the build every hour on GitHub and
  publishes the result on GitHub Pages.

## Build it yourself

```bash
npm install
npm run build
npm run preview
```

Then open http://localhost:8080.

Behind a proxy that Node does not pick up automatically, run the build as
`NODE_USE_ENV_PROXY=1 npm run build`.

## Kontrol (editor's controls)

**Report:** https://jatimsepekan.com/laporan/ (updated every hour, hidden from Google):
stories per area and per source, which sources failed, and every AI-written page to review.

**Controls:** edit `kontrol.json` on GitHub (pencil icon, then Commit changes). It applies at
the next hourly update.

| Setting | What it does | Example |
|---|---|---|
| `artikelAI` | AI articles from official releases on/off | `false` |
| `ringkasanHarian` | daily wrap-up on/off | `false` |
| `ringkasanSepekan` | weekly wrap-up on/off | `false` |
| `kataTerlarang` | hide every story whose headline contains one of these words | `["judi online", "Honda"]` |
| `tautanDihapus` | remove specific stories or pages: paste the story's link, or an AI page address from the report | `["https://jatimsepekan.com/berita/....html"]` |
| `sumberDijeda` | pause sources (names as in the footer); their stories are hidden too | `["Malang Voice"]` |

Keep the quotes, commas and square brackets exactly as in the examples.
