# Warta Wetan

News from East Java, Indonesia and the world, collected on one page.
"Wetan" is Javanese for "east".

The site collects headlines and short summaries from public news feeds (RSS)
and links every headline to the original article.

## How it works

- `sources.json` lists the news feeds. Add or remove a line to change sources.
  `section` is `jatim`, `indonesia` or `dunia`; `lang` is `id` or `en`.
- `scripts/build.mjs` downloads the feeds and builds the website into `dist/`.
- `src/` holds the page design: `index.html`, `style.css`, `app.js`.

## Build it yourself

```bash
npm install
npm run build
npm run preview
```

Then open http://localhost:8080.

Behind a proxy that Node does not pick up automatically, run the build as
`NODE_USE_ENV_PROXY=1 npm run build`.
