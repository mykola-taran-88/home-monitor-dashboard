# TarON Home Monitor Dashboard

Dashboard served by a Cloudflare Worker with static assets.

## Project layout

- `src/index.js` — Cloudflare Worker entry point. It serves the dashboard page and applies the HTML security and cache headers.
- `assets/index.html` — page structure and metadata.
- `assets/css/dashboard.css` — dashboard styles and responsive layout.
- `assets/js/dashboard.js` — dashboard behavior, data loading, and charts.
- `assets/` — images, icons, web manifest, and other static files.
- `wrangler.toml` — Worker and static asset configuration.

## Local development

```sh
npm install
npm run dev
```

## Formatting and syntax checks

```sh
npm run format
npm run format:check
npm run check:syntax
```

## Deploy

```sh
npm run deploy
```
