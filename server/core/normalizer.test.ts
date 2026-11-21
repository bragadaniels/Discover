import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeUrl,
  inferPublisherCountryFromDomain,
  isValidHttpUrl,
  normalizeDoi,
  normalizeRawItem,
  sanitizePlainText,
} from './normalizer';

test('isValidHttpUrl accepts http/https and rejects unsafe schemes', () => {
  assert.equal(isValidHttpUrl('https://arxiv.org/abs/2401.12345'), true);
  assert.equal(isValidHttpUrl('http://example.com/article'), true);
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
  assert.equal(isValidHttpUrl('data:text/html,<script>'), false);
  assert.equal(isValidHttpUrl('not-a-url'), false);
});

test('canonicalizeUrl strips tracking parameters, www, hash, and trailing slash', () => {
  const input = 'https://www.Nature.com/articles/s41586-024-0001/?utm_source=rss&utm_medium=feed&page=2#top';
  assert.equal(canonicalizeUrl(input), 'https://nature.com/articles/s41586-024-0001?page=2');
});

test('sanitizePlainText strips HTML tags, script blocks, and decodes entities', () => {
  const dirty = '<p>Rhodium &amp; <b>Catalysis</b></p><script>alert(1)</script> study.';
  assert.equal(sanitizePlainText(dirty), 'Rhodium & Catalysis study.');
  assert.equal(
    sanitizePlainText('miniss&#233;rie em alta no Al&#244; Al&#244; &#x2014; cinema'),
    'minissérie em alta no Alô Alô — cinema'
  );
});

test('normalizeDoi cleans URL prefix and casing', () => {
  assert.equal(normalizeDoi('https://doi.org/10.1021/JA0001'), '10.1021/ja0001');
  assert.equal(normalizeDoi('DOI: 10.1038/s41586-024-001'), '10.1038/s41586-024-001');
  assert.equal(normalizeDoi('invalid-doi'), null);
});

test('inferPublisherCountryFromDomain never guesses US/GB for generic .com domains', () => {
  assert.equal(inferPublisherCountryFromDomain('https://www.nytimes.com'), null);
  assert.equal(inferPublisherCountryFromDomain('https://www.folha.uol.com.br'), 'BR');
  assert.equal(inferPublisherCountryFromDomain('https://www.bbc.co.uk'), 'GB');
  assert.equal(inferPublisherCountryFromDomain('https://www.lemonde.fr'), 'FR');
  assert.equal(inferPublisherCountryFromDomain('https://www.spiegel.de'), 'DE');
});

test('normalizeRawItem rejects unsafe URLs and preserves language, publicationRegion, and publisherCountry separately', () => {
  assert.equal(
    normalizeRawItem({
      title: 'Unsafe item',
      contentType: 'news',
      originalUrl: 'javascript:void(0)',
      providerName: 'google_news',
    }),
    null
  );

  const normalized = normalizeRawItem({
    title: 'Advances in Rhodium-Catalyzed Hydroformylation',
    description: '<p>A detailed mechanistic study on asymmetric hydroformylation.</p>',
    contentType: 'article',
    originalUrl: 'https://www.science.org/doi/10.1126/science.abc123?utm_campaign=x',
    doi: '10.1126/SCIENCE.abc123',
    sourceName: 'Science',
    author: 'J. Doe',
    publishedAt: '2026-10-01T12:00:00Z',
    language: 'en',
    publicationRegion: 'GLOBAL',
    providerName: 'crossref',
  });

  assert.ok(normalized);
  assert.equal(normalized.canonicalUrl, 'https://science.org/doi/10.1126/science.abc123');
  assert.equal(normalized.doi, '10.1126/science.abc123');
  assert.equal(normalized.sourceDomain, 'science.org');
  assert.equal(normalized.publicationRegion, null);
  assert.equal(normalized.publisherCountry, null);
  assert.ok(normalized.metadataQuality >= 0.8);

  const ptNews = normalizeRawItem({
    title: 'Mostra de cinema independente reúne filmes pouco conhecidos em São Paulo',
    contentType: 'news',
    originalUrl: 'https://news.google.com/rss/articles/CBMi123',
    sourceName: 'Folha de S.Paulo',
    publisherDomainHint: 'https://www.folha.uol.com.br',
    language: 'pt',
    publicationRegion: 'BR',
    providerName: 'google_news',
  });
  assert.ok(ptNews);
  assert.equal(ptNews.language, 'pt');
  assert.equal(ptNews.publicationRegion, 'BR');
  assert.equal(ptNews.publisherCountry, 'BR');
  assert.equal(ptNews.sourceDomain, 'folha.uol.com.br');
});
