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
- `areas.json` lists the place names for each area tab (Surabaya Raya, Malang Raya,
  Madura, Mataraman).
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
