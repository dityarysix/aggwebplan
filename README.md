# Jawa Timur Sepekan

A weekly digest of news from East Java, Indonesia and the world: https://jatimsepekan.com

The site collects headlines and short summaries from public news feeds (RSS)
and links every headline to the original article. Each edition covers the last 7 days.

## How it works

- `sources.json` lists the news feeds. Add or remove a line to change sources.
  `section` is `jatim`, `indonesia` or `dunia`; `lang` is `id` or `en`.
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
