import path from 'node:path';
import type {DiscoveryIntervals, ScoringWeights} from '../shared/types';

export const APP_CONFIG = {
  port: Number(process.env.PORT) || 3000,
  dbPath: process.env.DISCOVER_DB_PATH || path.resolve(process.cwd(), 'instance', 'discover.db'),
  archivesDir: process.env.DISCOVER_ARCHIVES_DIR || path.resolve(process.cwd(), 'archives'),
  youtubeApiKey: process.env.YOUTUBE_API_KEY?.trim() || '',
  semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY?.trim() || '',
  openalexMailto: process.env.OPENALEX_MAILTO?.trim() || '',
  requestTimeoutMs: 12000,
  archiveTimeoutMs: 25000,
  maxArchiveResourceBytes: 5 * 1024 * 1024,
  maxArchiveTotalBytes: 45 * 1024 * 1024,
  maxRetries: 2,
  maxQueriesPerRun: 60,
  defaultLanguage: 'en',
  defaultRegion: 'US',
  defaultLanguages: ['en'],
  defaultRegions: ['US'],
  defaultIntervals: {
    newsMinutes: 45,
    articlesHours: 6,
    videosHours: 6,
  } satisfies DiscoveryIntervals,
  defaultScoringWeights: {
    directMatchWeight: 1.0,
    expandedMatchWeight: 0.6,
    freshnessWeight: 0.45,
    qualityWeight: 0.25,
    feedbackWeight: 0.4,
  } satisfies ScoringWeights,
};
