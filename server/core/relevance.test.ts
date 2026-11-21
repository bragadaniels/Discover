import test from 'node:test';
import assert from 'node:assert/strict';
import {computeFreshnessScore, computeRelevanceScore, containsExcludedTerm} from './relevance';
import {APP_CONFIG} from '../config';

const nowMs = Date.parse('2026-11-20T12:00:00.000Z');

test('priority 5 direct match ranks higher than priority 1 expanded match', () => {
  const high = computeRelevanceScore(
    {
      contentType: 'article',
      publishedAt: '2026-11-15T12:00:00.000Z',
      discoveredAt: '2026-11-20T12:00:00.000Z',
      metadataQuality: 0.85,
      matches: [{priority: 5, matchType: 'direct'}],
      feedbackType: null,
      isRead: false,
    },
    APP_CONFIG.defaultScoringWeights,
    nowMs
  );

  const low = computeRelevanceScore(
    {
      contentType: 'article',
      publishedAt: '2026-11-19T12:00:00.000Z',
      discoveredAt: '2026-11-20T12:00:00.000Z',
      metadataQuality: 0.85,
      matches: [{priority: 1, matchType: 'expanded'}],
      feedbackType: null,
      isRead: false,
    },
    APP_CONFIG.defaultScoringWeights,
    nowMs
  );

  assert.ok(high > low);
});

test('scientific articles decay much slower than news items', () => {
  const thirtyDaysAgo = '2026-10-21T12:00:00.000Z';
  const articleFreshness = computeFreshnessScore(thirtyDaysAgo, thirtyDaysAgo, 'article', nowMs);
  const newsFreshness = computeFreshnessScore(thirtyDaysAgo, thirtyDaysAgo, 'news', nowMs);
  assert.ok(articleFreshness > 0.7);
  assert.ok(newsFreshness < 0.2);
});

test('like increases score and dislike lowers score', () => {
  const baseInput = {
    contentType: 'news' as const,
    publishedAt: '2026-11-20T06:00:00.000Z',
    discoveredAt: '2026-11-20T12:00:00.000Z',
    metadataQuality: 0.7,
    matches: [{priority: 3, matchType: 'direct' as const}],
    isRead: false,
  };

  const liked = computeRelevanceScore(
    {...baseInput, feedbackType: 'like'},
    APP_CONFIG.defaultScoringWeights,
    nowMs
  );
  const disliked = computeRelevanceScore(
    {...baseInput, feedbackType: 'dislike'},
    APP_CONFIG.defaultScoringWeights,
    nowMs
  );
  assert.ok(liked > disliked);
});

test('containsExcludedTerm detects case-insensitive exclusion matches', () => {
  assert.equal(containsExcludedTerm('Crypto Market Rally', 'Bitcoin rises', ['crypto']), true);
  assert.equal(containsExcludedTerm('Catalysis in Flow', 'Rhodium ligand design', ['crypto']), false);
});
