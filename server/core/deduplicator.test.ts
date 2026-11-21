import test from 'node:test';
import assert from 'node:assert/strict';
import {computeTitleSimilarity, findDuplicateCandidate, type ExistingDedupeCandidate} from './deduplicator';

const existing: ExistingDedupeCandidate[] = [
  {
    id: 10,
    title: 'Rhodium-Catalyzed Hydroformylation of Internal Alkenes under Mild Conditions',
    contentType: 'article',
    canonicalUrl: 'https://pubs.acs.org/doi/10.1021/jacs.1234',
    doi: '10.1021/jacs.1234',
    externalId: null,
    publishedAt: '2026-11-10T00:00:00.000Z',
  },
  {
    id: 11,
    title: 'Deep Space Exoplanet Spectra Explained',
    contentType: 'video',
    canonicalUrl: 'https://youtube.com/watch?v=abc123xyz',
    doi: null,
    externalId: 'youtube:abc123xyz',
    publishedAt: '2026-11-15T00:00:00.000Z',
  },
  {
    id: 12,
    title: 'Inteligência Artificial transforma pesquisa em catálise química na América Latina',
    contentType: 'news',
    canonicalUrl: 'https://news.google.com/rss/articles/pt-br-1',
    doi: null,
    externalId: null,
    publishedAt: '2026-11-18T00:00:00.000Z',
  },
];

test('findDuplicateCandidate matches DOI regardless of URL difference or casing', () => {
  const match = findDuplicateCandidate(
    {
      title: 'Different Mirror Title',
      contentType: 'article',
      canonicalUrl: 'https://europepmc.org/article/123',
      doi: 'HTTPS://doi.org/10.1021/JACS.1234',
      externalId: null,
      publishedAt: '2026-11-10T00:00:00.000Z',
    },
    existing
  );
  assert.equal(match?.id, 10);
});

test('findDuplicateCandidate matches YouTube video externalId', () => {
  const match = findDuplicateCandidate(
    {
      title: 'Deep Space Exoplanet Spectra Explained (Mirror)',
      contentType: 'video',
      canonicalUrl: 'https://youtu.be/abc123xyz',
      doi: null,
      externalId: 'youtube:abc123xyz',
      publishedAt: '2026-11-15T00:00:00.000Z',
    },
    existing
  );
  assert.equal(match?.id, 11);
});

test('findDuplicateCandidate deduplicates multilingual/diacritic titles across regional Google News queries', () => {
  const match = findDuplicateCandidate(
    {
      title: 'Inteligencia Artificial transforma pesquisa em catalise quimica na America Latina',
      contentType: 'news',
      canonicalUrl: 'https://news.google.com/rss/articles/pt-pt-2',
      doi: null,
      externalId: null,
      publishedAt: '2026-11-18T00:00:00.000Z',
    },
    existing
  );
  assert.equal(match?.id, 12);
});

test('computeTitleSimilarity does not merge distinct papers with partial keyword overlap', () => {
  const sim = computeTitleSimilarity(
    'Rhodium-Catalyzed Hydroformylation of Internal Alkenes',
    'Cobalt-Catalyzed Hydroformylation of Terminal Alkynes in Water'
  );
  assert.ok(sim < 0.88);
});
