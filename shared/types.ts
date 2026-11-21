export type ContentType = 'news' | 'article' | 'video';

export type FilmCategory = 'about_film' | 'to_watch' | null;

export type TopicDomain = 'science' | 'technology' | 'entertainment' | 'geopolitics' | 'general';

export type FeedbackType = 'like' | 'dislike' | null;

export type SortOption = 'relevant' | 'newest' | 'oldest';

export type CategorySelection = number | 'all' | 'lucky';

export type FeedFilterType =
  | 'all'
  | 'news'
  | 'article'
  | 'video'
  | 'to_watch'
  | 'about_film'
  | 'unread'
  | 'saved'
  | 'notes';

export interface SearchHighlightSegment {
  text: string;
  match: boolean;
}

export interface SearchMatchPreview {
  source: 'metadata' | 'note' | 'archive_text';
  segments: SearchHighlightSegment[];
}

export interface ItemNote {
  id: number;
  canonicalUrl: string;
  contentItemId: number | null;
  archiveUid: string | null;
  noteText: string;
  createdAt: string;
  updatedAt: string;
}

export interface TagRelation {
  id: number;
  tagId: number;
  term: string;
  relationType: 'expanded' | 'exclusion';
  isEnabled: boolean;
  isUserDefined: boolean;
  createdAt: string;
}

export interface Tag {
  id: number;
  categoryId: number;
  name: string;
  description: string | null;
  priority: number; // 1 = Low, 2 = Normal, 3 = High, 4 = Very High, 5 = Essential
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  relations: TagRelation[];
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  icon: string;
  sortOrder: number;
  isEnabled: boolean;
  languages: string[] | null; // null = inherit global languages
  regions: string[] | null; // null = inherit global regions
  createdAt: string;
  updatedAt: string;
  tags: Tag[];
}

export interface SuggestedTermItem {
  term: string;
  facet: string;
  language?: string;
}

export interface TagSuggestionPreview {
  domain: TopicDomain;
  suggestions: SuggestedTermItem[];
  exclusions: string[];
  multilingualTerms: Array<{language: string; term: string}>;
}

export interface ContentTagBadge {
  tagId: number;
  tagName: string;
  categoryId: number;
  categoryName: string;
  priority: number;
  matchType: 'direct' | 'expanded';
  matchedTerm: string;
}

export interface ContentItem {
  id: number;
  title: string;
  description: string | null;
  contentType: ContentType;
  filmCategory: FilmCategory;
  originalUrl: string;
  canonicalUrl: string;
  doi: string | null;
  externalId: string | null;
  sourceName: string;
  sourceDomain: string;
  author: string | null;
  thumbnailUrl: string | null;
  publishedAt: string | null;
  discoveredAt: string;
  language: string;
  publicationRegion: string | null;
  publisherCountry: string | null;
  duration: string | null;
  openAccessUrl: string | null;
  metadataQuality: number;
  baseScore: number;
  relevanceScore: number;
  providerName: string;
  associatedTags: ContentTagBadge[];
  feedbackType: FeedbackType;
  isRead: boolean;
  isSaved: boolean;
  isHidden: boolean;
  note?: string | null;
  noteUpdatedAt?: string | null;
  searchMatch?: SearchMatchPreview | null;
}

export interface FeedResponse {
  items: ContentItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ProviderStatusInfo {
  providerName: string;
  displayName: string;
  contentType: ContentType;
  isEnabled: boolean;
  isConfigured: boolean;
  supportsMultiLanguage: boolean;
  supportsMultiRegion: boolean;
  localeLimitationNote: string;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  note: string | null;
}

export interface DiscoveryQueryLog {
  id: number;
  providerName: string;
  queryText: string;
  language: string | null;
  region: string | null;
  tagId: number | null;
  tagName: string | null;
  status: 'success' | 'error' | 'rate_limited';
  itemsFound: number;
  itemsAdded: number;
  durationMs?: number | null;
  errorMessage: string | null;
  executedAt: string;
}

export interface ProviderHealthMetric {
  providerName: string;
  displayName: string;
  contentType: ContentType;
  isEnabled: boolean;
  isConfigured: boolean;
  totalRuns: number;
  successRuns: number;
  errorRuns: number;
  rateLimitedRuns: number;
  successRatePct: number | null;
  avgLatencyMs: number | null;
  totalFound: number;
  totalAdded: number;
  rateLimitResetAt: string | null;
  lastRunAt: string | null;
  lastError: string | null;
}

export interface DiscoveryIntervals {
  newsMinutes: number;
  articlesHours: number;
  videosHours: number;
}

export interface ScoringWeights {
  directMatchWeight: number;
  expandedMatchWeight: number;
  freshnessWeight: number;
  qualityWeight: number;
  feedbackWeight: number;
}

export interface CustomLanguage {
  code: string;
  name: string;
}

export interface CustomRegion {
  code: string;
  name: string;
  countryCode: string;
  defaultLanguage: string;
  queryLocation?: string | null;
}

export interface UserPreferences {
  theme: 'light' | 'dark';
  language: string;
  region: string;
  languages: string[];
  regions: string[];
  customLanguages: CustomLanguage[];
  customRegions: CustomRegion[];
  activeCategoryId: number | 'all';
  onboardingCompleted: boolean;
  intervals: DiscoveryIntervals;
  scoringWeights: ScoringWeights;
}

export interface DiscoveryRunSummary {
  startedAt: string;
  finishedAt: string;
  queriesExecuted: number;
  itemsDiscovered: number;
  itemsAdded: number;
  itemsPruned?: number;
  duplicatesMerged: number;
  errors: string[];
}

export type ArchiveFormat = 'html' | 'warc' | 'pdf';

export type ArchiveStatus = 'complete' | 'partial' | 'text_only' | 'failed';

export interface ArchiveFilePaths {
  html?: string | null;
  warc?: string | null;
  pdf?: string | null;
  metadata?: string | null;
  thumbnail?: string | null;
}

export interface ArchiveFileSizes {
  html?: number;
  warc?: number;
  pdf?: number;
  metadata?: number;
  thumbnail?: number;
}

export interface ArchiveChecksums {
  html?: string;
  warc?: string;
  pdf?: string;
  metadata?: string;
  thumbnail?: string;
}

export interface ArchiveCaptureDetails {
  requestedFormats: ArchiveFormat[];
  generatedFormats: ArchiveFormat[];
  failedFormats: Array<{format: ArchiveFormat; reason: string}>;
  resourcesCaptured: number;
  resourcesFailed: number;
  warnings: string[];
  limitations: string[];
  captureMethod: 'playwright' | 'fetch_fallback' | 'none';
  httpStatus: number | null;
  mimeType: string | null;
  durationMs: number;
  error?: string | null;
}

export interface ArchiveRecord {
  id: number;
  archiveUid: string;
  versionNumber: number;
  parentArchiveUid: string | null;
  contentItemId: number | null;
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  author: string | null;
  publisher: string | null;
  publishedAt: string | null;
  archivedAt: string;
  contentType: ContentType;
  categoryName: string | null;
  tagNames: string[];
  doi: string | null;
  language: string | null;
  filePaths: ArchiveFilePaths;
  fileSizes: ArchiveFileSizes;
  checksums: ArchiveChecksums;
  status: ArchiveStatus;
  completeness: number;
  availableFormats: ArchiveFormat[];
  thumbnailPath: string | null;
  captureDetails: ArchiveCaptureDetails;
  note?: string | null;
  noteUpdatedAt?: string | null;
  searchMatch?: SearchMatchPreview | null;
}

export interface ArchiveJobStatus {
  jobId: string;
  url: string;
  title: string;
  requestedFormats: ArchiveFormat[];
  stage:
    | 'queued'
    | 'validating'
    | 'fetching_page'
    | 'capturing_resources'
    | 'generating_html'
    | 'generating_warc'
    | 'generating_pdf'
    | 'saving_metadata'
    | 'completed'
    | 'failed';
  progress: number;
  message: string;
  archive: ArchiveRecord | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface WarcRecordSummary {
  warcType: string;
  targetUri: string | null;
  recordId: string | null;
  date: string | null;
  contentType: string | null;
  httpStatus: number | null;
  payloadBytes: number;
  httpHeaders: Record<string, string>;
}

export interface ArchiveIntegrityResult {
  archiveUid: string;
  valid: boolean;
  checkedAt: string;
  files: Array<{
    format: keyof ArchiveChecksums;
    path: string;
    expectedSha256: string | null;
    actualSha256: string | null;
    exists: boolean;
    valid: boolean;
  }>;
}

export interface ArchiveRestoreConflict {
  archiveUid: string;
  title: string;
  archivedAt: string;
}

export interface ArchiveRestoreResponse {
  restored: number;
  skipped: number;
  overwritten: number;
  conflicts: ArchiveRestoreConflict[];
  requiresConfirmation: boolean;
  warnings: string[];
}

