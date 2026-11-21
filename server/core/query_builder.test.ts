import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDiscoveryQueries,
  buildLocalePairs,
  formatArxivQuery,
  formatNewsQuery,
  suggestExpandedTerms,
} from './query_builder';
import {HIDDEN_GEMS_TAG_NAME} from './domain_expansion';

test('suggestExpandedTerms returns deterministic expansions without replacing original tag', () => {
  const terms = suggestExpandedTerms('Hydroformylation', 'Chemistry');
  assert.ok(terms.includes('oxo process'));
  assert.ok(terms.includes('homogeneous catalysis'));
  assert.equal(terms.includes('hydroformylation'), false);
});

test('formatNewsQuery wraps multi-word terms and appends exclusions', () => {
  const q = formatNewsQuery('Green chemistry', ['stock', 'sponsored post']);
  assert.equal(q, '"Green chemistry" -stock -"sponsored post"');
});

test('formatArxivQuery formats title/abstract phrases and ANDNOT exclusions', () => {
  const q = formatArxivQuery('Olefin metathesis', ['polymer']);
  assert.equal(q, '(ti:"Olefin metathesis" OR abs:"Olefin metathesis") ANDNOT all:polymer');
});

test('buildLocalePairs covers every selected language and region simultaneously', () => {
  const pairs = buildLocalePairs(['en', 'pt', 'fr'], ['US', 'BR', 'FR'], 6);
  const langs = new Set(pairs.map((p) => p.language));
  const regs = new Set(pairs.map((p) => p.region));
  assert.ok(langs.has('en'));
  assert.ok(langs.has('pt'));
  assert.ok(langs.has('fr'));
  assert.ok(regs.has('US'));
  assert.ok(regs.has('BR'));
  assert.ok(regs.has('FR'));
});

test('buildDiscoveryQueries executes multilingual queries for news/crossref, skips arxiv for cinema, and keeps arxiv single-locale', () => {
  const queries = buildDiscoveryQueries(
    [
      {
        id: 1,
        categoryId: 10,
        categoryName: 'Technology',
        name: 'Artificial Intelligence',
        priority: 4,
        expandedTerms: ['machine learning'],
        exclusions: [],
        languages: ['en', 'pt'],
        regions: ['US', 'BR'],
      },
      {
        id: 2,
        categoryId: 20,
        categoryName: 'Cinema',
        name: HIDDEN_GEMS_TAG_NAME,
        priority: 5,
        expandedTerms: ['underrated independent films'],
        exclusions: ['mcu'],
        languages: ['en', 'pt'],
        regions: ['US', 'BR'],
      },
    ],
    ['google_news', 'crossref', 'arxiv'],
    24
  );

  // Cinema should NOT hit arxiv or crossref
  assert.equal(queries.some((q) => q.tagId === 2 && (q.provider === 'arxiv' || q.provider === 'crossref')), false);
  // Technology arXiv should only execute once (not repeated per region)
  assert.equal(queries.filter((q) => q.tagId === 1 && q.provider === 'arxiv').length, 1);
  // Google News runs for both en/US and pt/BR with translated queries
  const aiPt = queries.find((q) => q.tagId === 1 && q.provider === 'google_news' && q.language === 'pt');
  assert.ok(aiPt);
  assert.ok(aiPt.queryString.includes('Inteligência Artificial'));
});

test('buildDiscoveryQueries expands single-tag focused tabs for Crossref and Google News', () => {
  const queries = buildDiscoveryQueries(
    [
      {
        id: 99,
        categoryId: 1,
        categoryName: 'Chemistry',
        name: 'Cardanol',
        priority: 3,
        expandedTerms: ['cashew nutshell liquid'],
        exclusions: [],
        languages: ['en'],
        regions: ['US'],
      },
    ],
    ['google_news', 'crossref', 'arxiv'],
    24
  );

  assert.ok(queries.some((q) => q.provider === 'crossref' && q.matchType === 'direct' && q.queryString === 'Cardanol'));
  assert.ok(
    queries.some(
      (q) => q.provider === 'crossref' && q.matchType === 'expanded' && q.queryString === 'cashew nutshell liquid'
    )
  );
  assert.ok(queries.some((q) => q.provider === 'google_news' && q.matchType === 'expanded'));
  assert.equal(queries.filter((q) => q.provider === 'arxiv').length, 1);
});

