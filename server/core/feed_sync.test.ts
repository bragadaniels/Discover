import assert from 'node:assert/strict';
import test from 'node:test';
import {
  doesItemMatchActivePreferences,
  selectOutdatedNonSavedItemIds,
  type SyncPreferenceContext,
} from './feed_sync';

const basePrefs: SyncPreferenceContext = {
  languages: ['en'],
  regions: ['US'],
  customRegions: [],
  enabledProviders: new Set(['google_news', 'rss_publishers', 'arxiv', 'crossref']),
};

test('matches items aligned with active tag, language, region, and provider', () => {
  const ok = doesItemMatchActivePreferences(
    {
      id: 1,
      contentType: 'news',
      language: 'en',
      publicationRegion: 'US',
      publisherCountry: 'US',
      providerName: 'google_news',
      isSaved: false,
    },
    [
      {
        categoryId: 1,
        categoryIsEnabled: true,
        tagIsEnabled: true,
        categoryLanguages: null,
        categoryRegions: null,
      },
    ],
    basePrefs
  );
  assert.equal(ok, true);
});

test('selectOutdatedNonSavedItemIds removes stale items when language or region changes but preserves saved items', () => {
  const updatedPrefs: SyncPreferenceContext = {
    languages: ['pt'],
    regions: ['BR'],
    customRegions: [],
    enabledProviders: new Set(['google_news', 'rss_publishers', 'arxiv', 'crossref']),
  };

  const candidates = [
    {
      item: {
        id: 10,
        contentType: 'news' as const,
        language: 'en',
        publicationRegion: 'US',
        publisherCountry: 'US',
        providerName: 'google_news',
        isSaved: false,
      },
      links: [
        {
          categoryId: 1,
          categoryIsEnabled: true,
          tagIsEnabled: true,
          categoryLanguages: null,
          categoryRegions: null,
        },
      ],
    },
    {
      item: {
        id: 11,
        contentType: 'news' as const,
        language: 'en',
        publicationRegion: 'US',
        publisherCountry: 'US',
        providerName: 'google_news',
        isSaved: true, // Saved item MUST survive preference changes!
      },
      links: [
        {
          categoryId: 1,
          categoryIsEnabled: true,
          tagIsEnabled: true,
          categoryLanguages: null,
          categoryRegions: null,
        },
      ],
    },
    {
      item: {
        id: 12,
        contentType: 'news' as const,
        language: 'pt',
        publicationRegion: 'BR',
        publisherCountry: 'BR',
        providerName: 'rss_publishers',
        isSaved: false,
      },
      links: [
        {
          categoryId: 1,
          categoryIsEnabled: true,
          tagIsEnabled: true,
          categoryLanguages: null,
          categoryRegions: null,
        },
      ],
    },
  ];

  const outdated = selectOutdatedNonSavedItemIds(candidates, updatedPrefs);
  assert.deepEqual(outdated, [10]);
});

test('removes non-saved items whose tags are disabled or deleted while keeping saved items', () => {
  const candidates = [
    {
      item: {
        id: 20,
        contentType: 'article' as const,
        language: 'en',
        publicationRegion: null,
        publisherCountry: null,
        providerName: 'arxiv',
        isSaved: false,
      },
      links: [
        {
          categoryId: 1,
          categoryIsEnabled: true,
          tagIsEnabled: false,
          categoryLanguages: null,
          categoryRegions: null,
        },
      ],
    },
    {
      item: {
        id: 21,
        contentType: 'article' as const,
        language: 'en',
        publicationRegion: null,
        publisherCountry: null,
        providerName: 'arxiv',
        isSaved: true,
      },
      links: [],
    },
  ];

  const outdated = selectOutdatedNonSavedItemIds(candidates, basePrefs);
  assert.deepEqual(outdated, [20]);
});

test('city custom region matches both direct local queries and national press feeds from parent country', () => {
  const cityPrefs: SyncPreferenceContext = {
    languages: ['pt'],
    regions: ['BR-FORTALEZA'],
    customRegions: [
      {
        code: 'BR-FORTALEZA',
        name: 'Fortaleza, Ceará',
        countryCode: 'BR',
        defaultLanguage: 'pt',
        queryLocation: 'Fortaleza',
      },
    ],
    enabledProviders: new Set(['google_news', 'rss_publishers']),
  };

  const localNewsOk = doesItemMatchActivePreferences(
    {
      id: 30,
      contentType: 'news',
      language: 'pt',
      publicationRegion: 'BR-FORTALEZA',
      publisherCountry: 'BR',
      providerName: 'google_news',
      isSaved: false,
    },
    [
      {
        categoryId: 2,
        categoryIsEnabled: true,
        tagIsEnabled: true,
        categoryLanguages: null,
        categoryRegions: null,
      },
    ],
    cityPrefs
  );
  assert.equal(localNewsOk, true);

  const usNewsBlocked = doesItemMatchActivePreferences(
    {
      id: 31,
      contentType: 'news',
      language: 'pt',
      publicationRegion: 'US',
      publisherCountry: 'US',
      providerName: 'google_news',
      isSaved: false,
    },
    [
      {
        categoryId: 2,
        categoryIsEnabled: true,
        tagIsEnabled: true,
        categoryLanguages: null,
        categoryRegions: null,
      },
    ],
    cityPrefs
  );
  assert.equal(usNewsBlocked, false);
});
