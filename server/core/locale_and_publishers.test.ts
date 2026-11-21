import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getLocaleProviderLimitations,
  normalizeLanguageList,
  normalizeRegionList,
  validateCustomLanguage,
  validateCustomRegion,
} from '../../shared/locale';
import {decodeXmlBuffer, scoreRssEntryMatch} from '../providers/rss_publishers';
import {buildDiscoveryQueries} from './query_builder';

test('validateCustomLanguage accepts valid ISO codes, resolves display names, and rejects invalid/duplicate codes', () => {
  const nlRes = validateCustomLanguage({code: 'NL'});
  assert.equal(nlRes.ok, true);
  if (nlRes.ok) {
    assert.equal(nlRes.language.code, 'nl');
    assert.equal(nlRes.language.name, 'Dutch');
  }

  const dupRes = validateCustomLanguage({code: 'en'});
  assert.equal(dupRes.ok, false);

  const badRes = validateCustomLanguage({code: '12345'});
  assert.equal(badRes.ok, false);
});

test('validateCustomRegion supports custom countries and city/local regions', () => {
  const countryRes = validateCustomRegion({code: 'AR'});
  assert.equal(countryRes.ok, true);
  if (countryRes.ok) {
    assert.equal(countryRes.region.code, 'AR');
    assert.equal(countryRes.region.name, 'Argentina');
    assert.equal(countryRes.region.defaultLanguage, 'es');
  }

  const cityRes = validateCustomRegion({
    name: 'Fortaleza',
    countryCode: 'BR',
    defaultLanguage: 'pt',
    queryLocation: 'Fortaleza',
  });
  assert.equal(cityRes.ok, true);
  if (cityRes.ok) {
    assert.equal(cityRes.region.code, 'BR-FORTALEZA');
    assert.equal(cityRes.region.countryCode, 'BR');
    assert.equal(cityRes.region.queryLocation, 'Fortaleza');
  }

  const customLangs = normalizeLanguageList(['en', 'nl'], ['en'], ['nl']);
  assert.deepEqual(customLangs, ['en', 'nl']);

  const customRegs = normalizeRegionList(['US', 'BR-FORTALEZA'], ['US'], ['BR-FORTALEZA']);
  assert.deepEqual(customRegs, ['US', 'BR-FORTALEZA']);

  const notes = getLocaleProviderLimitations(
    ['nl'],
    ['BR-FORTALEZA'],
    [{code: 'nl', name: 'Dutch'}],
    cityRes.ok ? [cityRes.region] : []
  );
  assert.equal(notes.length >= 2, true);
});

test('decodeXmlBuffer decodes ISO-8859-1 Brazilian RSS XML cleanly without accent corruption', () => {
  const latin1Xml = '<?xml version="1.0" encoding="ISO-8859-1"?><title>São Paulo e cinema técnico</title>';
  const bytes = Buffer.from(latin1Xml, 'latin1');
  const decoded = decodeXmlBuffer(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    'application/xml; charset=ISO-8859-1'
  );
  assert.ok(decoded.includes('São Paulo'));
  assert.ok(decoded.includes('técnico'));
});

test('scoreRssEntryMatch matches tag keywords and respects exclusions', () => {
  const entry = {
    title: 'Novo festival de cinema independente destaca diretores do Ceará',
    description: 'Mostra exibe filmes pouco conhecidos em Fortaleza.',
    link: 'https://g1.globo.com/pop-arte/noticia/exemplo.ghtml',
    pubDate: null,
    author: null,
    thumbnailUrl: null,
    sourceName: 'G1',
    country: 'BR',
    language: 'pt',
    section: 'cinema' as const,
  };

  assert.ok(scoreRssEntryMatch(entry, ['Hidden Gems / Filmes pouco conhecidos']) > 0);
  assert.equal(scoreRssEntryMatch(entry, ['cinema independente'], ['ceará']), 0);
});

test('buildDiscoveryQueries generates local city newspaper and publisher-targeted queries cleanly', () => {
  const queries = buildDiscoveryQueries(
    [
      {
        id: 1,
        categoryId: 1,
        categoryName: 'Cinema',
        name: 'Cinema',
        priority: 4,
        expandedTerms: ['cinema independente'],
        exclusions: [],
        languages: ['pt'],
        regions: ['BR-FORTALEZA'],
      },
    ],
    ['rss_publishers', 'google_news'],
    20,
    {
      languages: ['pt'],
      regions: ['BR-FORTALEZA'],
      customRegions: [
        {
          code: 'BR-FORTALEZA',
          name: 'Fortaleza',
          countryCode: 'BR',
          defaultLanguage: 'pt',
          queryLocation: 'Fortaleza',
        },
      ],
    }
  );

  assert.ok(queries.some((q) => q.provider === 'rss_publishers' && q.language === 'pt'));
  assert.ok(
    queries.some(
      (q) =>
        q.provider === 'google_news' &&
        q.countryCode === 'BR' &&
        q.queryString.includes('Fortaleza')
    )
  );
  assert.ok(
    queries.some(
      (q) =>
        q.provider === 'google_news' &&
        q.queryString.includes('O Povo') &&
        q.queryString.includes('Estadão')
    )
  );
});
