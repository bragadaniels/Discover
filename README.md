# Discover

Personal intelligent content aggregator driven by user-defined tags and automatic source discovery across news, scientific publications, and videos.

## Core Principles

- **Tag-Driven Discovery**: Define categories and interest tags instead of manually subscribing to RSS feeds, channels, or publishers.
- **Multi-Provider Engine**: Discovers content automatically from Google News RSS, Crossref Scholarly API, arXiv Preprints API, and optionally YouTube Data API v3.
- **Multi-Level Deduplication**: Deduplicates by canonical URL, normalized URL, DOI, external ID (`arxiv:`, `youtube:`), and conservative title similarity while preserving all matched tag associations.
- **Transparent Personalization**: Ranks items by direct vs. expanded term match, tag priority (1–5), content-type freshness half-life, metadata quality, and user feedback (`Like`, `Dislike`, `Save`, `Mark as read`, `Hide`).
- **Editorial Interface & PWA**: Warm archival paper (Light) and subdued charcoal (Dark) themes, installable Progressive Web App with offline caching, and JSON workspace export/import.

## Architecture

- `server.ts` — Express server mounting REST API routes (`/api/*`), background discovery scheduler, and Vite middleware.
- `server/db/` — SQLite persistence (`instance/discover.db`) via Node's native `node:sqlite`.
- `server/core/` — Decoupled discovery pipeline (`query_builder.ts`, `normalizer.ts`, `deduplicator.ts`, `relevance.ts`, `discovery_engine.ts`, `scheduler.ts`).
- `server/providers/` — Modular connectors (`google_news.ts`, `crossref.ts`, `arxiv.ts`, `youtube.ts`).
- `src/` — Modular React + TypeScript + Tailwind CSS v4 frontend (`components/`, `services/api.ts`, `hooks/`).

## Running Locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Optional environment configuration (`.env`):
   - `YOUTUBE_API_KEY` — Optional YouTube Data API v3 key for automatic video discovery. If omitted, Google News, Crossref, and arXiv continue operating normally.
   - `DISCOVER_DB_PATH` — Optional custom SQLite database path (defaults to `instance/discover.db`).
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Build for production & run:
   ```bash
   npm run build
   npm start
   ```

## Tests

Run unit tests for normalization, query building, deduplication, and relevance scoring:

```bash
npx --yes tsx --test server/core/*.test.ts
```
