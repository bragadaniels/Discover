import type {ContentType, FeedbackType, ScoringWeights} from '../../shared/types';

export interface RelevanceTagMatch {
  priority: number; // 1..5
  matchType: 'direct' | 'expanded';
}

export interface RelevanceInput {
  contentType: ContentType;
  publishedAt: string | null;
  discoveredAt: string;
  metadataQuality: number;
  matches: RelevanceTagMatch[];
  feedbackType: FeedbackType;
  isRead: boolean;
  sourceAffinityBoost?: number; // Derived from prior likes on same source/tags
}

const PRIORITY_MULTIPLIER: Record<number, number> = {
  1: 0.55,
  2: 0.8,
  3: 1.0,
  4: 1.3,
  5: 1.65,
};

// Half-life in hours per content type:
// News ages quickly; videos moderately; scientific publications retain relevance far longer.
const HALF_LIFE_HOURS: Record<ContentType, number> = {
  news: 48,
  video: 336, // 14 days
  article: 4320, // 180 days
};

export function computeFreshnessScore(
  publishedAt: string | null,
  discoveredAt: string,
  contentType: ContentType,
  nowMs = Date.now()
): number {
  const refIso = publishedAt || discoveredAt;
  const refMs = Date.parse(refIso);
  if (Number.isNaN(refMs)) return 0.5;

  const ageHours = Math.max(0, (nowMs - refMs) / (1000 * 60 * 60));
  const halfLife = HALF_LIFE_HOURS[contentType];
  // Exponential decay bounded to [0.1, 1.0] so foundational scientific papers never hit zero
  const decay = Math.pow(0.5, ageHours / halfLife);
  return Math.max(0.1, Math.min(1.0, decay));
}

export function computeRelevanceScore(
  input: RelevanceInput,
  weights: ScoringWeights,
  nowMs = Date.now()
): number {
  if (input.matches.length === 0) {
    return 0.1;
  }

  // 1. Tag priority & match type score
  let strongestTagScore = 0;
  let multiTagBonus = 0;

  for (const m of input.matches) {
    const pMult = PRIORITY_MULTIPLIER[m.priority] ?? 1.0;
    const matchWeight =
      m.matchType === 'direct' ? weights.directMatchWeight : weights.expandedMatchWeight;
    const candidate = pMult * matchWeight;
    if (candidate > strongestTagScore) {
      strongestTagScore = candidate;
    }
    multiTagBonus += 0.12 * pMult;
  }

  // Subtract the first match from multiTagBonus so single match doesn't get double-counted
  const extraMatchesBonus = Math.max(0, Math.min(0.45, multiTagBonus - 0.12));

  // 2. Content freshness
  const freshness = computeFreshnessScore(
    input.publishedAt,
    input.discoveredAt,
    input.contentType,
    nowMs
  );

  // 3. Metadata quality
  const quality = Math.max(0, Math.min(1, input.metadataQuality));

  // 4. User feedback & affinity
  let feedbackDelta = input.sourceAffinityBoost ?? 0;
  if (input.feedbackType === 'like') {
    feedbackDelta += 0.35;
  } else if (input.feedbackType === 'dislike') {
    feedbackDelta -= 0.75;
  }
  if (input.isRead) {
    feedbackDelta -= 0.08;
  }

  const raw =
    strongestTagScore +
    extraMatchesBonus +
    freshness * weights.freshnessWeight +
    quality * weights.qualityWeight +
    feedbackDelta * weights.feedbackWeight;

  return Math.max(0, Math.round(raw * 1000) / 1000);
}

export function containsExcludedTerm(
  title: string,
  description: string | null,
  exclusions: string[]
): boolean {
  if (exclusions.length === 0) return false;
  const haystack = `${title} ${description || ''}`.toLowerCase();
  return exclusions.some((term) => {
    const clean = term.trim().toLowerCase();
    return clean.length > 0 && haystack.includes(clean);
  });
}
