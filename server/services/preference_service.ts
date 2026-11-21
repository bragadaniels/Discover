import {
  normalizeCustomLanguages,
  normalizeCustomRegions,
  normalizeLanguageList,
  normalizeRegionList,
  validateCustomLanguage,
  validateCustomRegion,
} from '../../shared/locale';
import type {
  CustomLanguage,
  CustomRegion,
  DiscoveryIntervals,
  ScoringWeights,
  UserPreferences,
} from '../../shared/types';
import {APP_CONFIG} from '../config';
import {getDb} from '../db/database';

export function getPreferences(): UserPreferences {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM user_preferences').all() as Array<{
    key: string;
    value: string;
  }>;

  const map = new Map<string, unknown>();
  for (const r of rows) {
    try {
      map.set(r.key, JSON.parse(r.value));
    } catch {
      map.set(r.key, r.value);
    }
  }

  const customLanguages = normalizeCustomLanguages(map.get('customLanguages'));
  const customRegions = normalizeCustomRegions(map.get('customRegions'));

  const legacyLang =
    typeof map.get('language') === 'string'
      ? (map.get('language') as string)
      : APP_CONFIG.defaultLanguage;
  const legacyRegion =
    typeof map.get('region') === 'string'
      ? (map.get('region') as string)
      : APP_CONFIG.defaultRegion;

  const languages = normalizeLanguageList(
    map.get('languages'),
    [legacyLang],
    customLanguages.map((l) => l.code)
  );
  const regions = normalizeRegionList(
    map.get('regions'),
    [legacyRegion],
    customRegions.map((r) => r.code)
  );

  return {
    theme: map.get('theme') === 'dark' ? 'dark' : 'light',
    language: languages[0],
    region: regions[0],
    languages,
    regions,
    customLanguages,
    customRegions,
    activeCategoryId:
      typeof map.get('activeCategoryId') === 'number' ? (map.get('activeCategoryId') as number) : 'all',
    onboardingCompleted: Boolean(map.get('onboardingCompleted')),
    intervals: (map.get('intervals') as DiscoveryIntervals) || APP_CONFIG.defaultIntervals,
    scoringWeights: (map.get('scoringWeights') as ScoringWeights) || APP_CONFIG.defaultScoringWeights,
  };
}

function cleanupRemovedCategoryLocales(
  allowedLanguages: string[],
  allowedRegions: string[]
): void {
  const db = getDb();
  const rows = db.prepare('SELECT id, languages, regions FROM categories').all() as Array<{
    id: number;
    languages: string | null;
    regions: string | null;
  }>;
  const update = db.prepare('UPDATE categories SET languages = ?, regions = ? WHERE id = ?');
  for (const row of rows) {
    let nextLangs = row.languages;
    let nextRegs = row.regions;
    let changed = false;

    if (row.languages) {
      try {
        const parsed = JSON.parse(row.languages);
        if (Array.isArray(parsed)) {
          const normalized = normalizeLanguageList(parsed, [], allowedLanguages);
          const encoded = normalized.length > 0 ? JSON.stringify(normalized) : null;
          if (encoded !== row.languages) {
            nextLangs = encoded;
            changed = true;
          }
        }
      } catch {
        // Ignore malformed
      }
    }

    if (row.regions) {
      try {
        const parsed = JSON.parse(row.regions);
        if (Array.isArray(parsed)) {
          const normalized = normalizeRegionList(parsed, [], allowedRegions);
          const encoded = normalized.length > 0 ? JSON.stringify(normalized) : null;
          if (encoded !== row.regions) {
            nextRegs = encoded;
            changed = true;
          }
        }
      } catch {
        // Ignore malformed
      }
    }

    if (changed) {
      update.run(nextLangs, nextRegs, row.id);
    }
  }
}

export function updatePreferences(partial: Partial<UserPreferences>): UserPreferences {
  const db = getDb();
  const current = getPreferences();

  const nextCustomLanguages: CustomLanguage[] =
    partial.customLanguages !== undefined
      ? normalizeCustomLanguages(partial.customLanguages)
      : current.customLanguages;
  const nextCustomRegions: CustomRegion[] =
    partial.customRegions !== undefined
      ? normalizeCustomRegions(partial.customRegions)
      : current.customRegions;

  const customLangCodes = nextCustomLanguages.map((l) => l.code);
  const customRegCodes = nextCustomRegions.map((r) => r.code);

  let nextLanguages = normalizeLanguageList(current.languages, ['en'], customLangCodes);
  if (Array.isArray(partial.languages)) {
    nextLanguages = normalizeLanguageList(partial.languages, nextLanguages, customLangCodes);
  } else if (typeof partial.language === 'string' && partial.language.trim()) {
    nextLanguages = normalizeLanguageList([partial.language], nextLanguages, customLangCodes);
  }

  let nextRegions = normalizeRegionList(current.regions, ['US'], customRegCodes);
  if (Array.isArray(partial.regions)) {
    nextRegions = normalizeRegionList(partial.regions, nextRegions, customRegCodes);
  } else if (typeof partial.region === 'string' && partial.region.trim()) {
    nextRegions = normalizeRegionList([partial.region], nextRegions, customRegCodes);
  }

  const next: UserPreferences = {
    theme: partial.theme === 'dark' ? 'dark' : partial.theme === 'light' ? 'light' : current.theme,
    language: nextLanguages[0],
    region: nextRegions[0],
    languages: nextLanguages,
    regions: nextRegions,
    customLanguages: nextCustomLanguages,
    customRegions: nextCustomRegions,
    activeCategoryId:
      partial.activeCategoryId === 'all' || typeof partial.activeCategoryId === 'number'
        ? partial.activeCategoryId
        : current.activeCategoryId,
    onboardingCompleted:
      typeof partial.onboardingCompleted === 'boolean'
        ? partial.onboardingCompleted
        : current.onboardingCompleted,
    intervals: partial.intervals
      ? {
          newsMinutes: Math.max(
            15,
            Math.min(1440, Number(partial.intervals.newsMinutes) || current.intervals.newsMinutes)
          ),
          articlesHours: Math.max(
            1,
            Math.min(168, Number(partial.intervals.articlesHours) || current.intervals.articlesHours)
          ),
          videosHours: Math.max(
            1,
            Math.min(168, Number(partial.intervals.videosHours) || current.intervals.videosHours)
          ),
        }
      : current.intervals,
    scoringWeights: partial.scoringWeights
      ? {
          directMatchWeight:
            Number(partial.scoringWeights.directMatchWeight) || current.scoringWeights.directMatchWeight,
          expandedMatchWeight:
            Number(partial.scoringWeights.expandedMatchWeight) ||
            current.scoringWeights.expandedMatchWeight,
          freshnessWeight:
            Number(partial.scoringWeights.freshnessWeight) || current.scoringWeights.freshnessWeight,
          qualityWeight:
            Number(partial.scoringWeights.qualityWeight) || current.scoringWeights.qualityWeight,
          feedbackWeight:
            Number(partial.scoringWeights.feedbackWeight) || current.scoringWeights.feedbackWeight,
        }
      : current.scoringWeights,
  };

  const stmt = db.prepare('INSERT OR REPLACE INTO user_preferences (key, value) VALUES (?, ?)');
  for (const [key, val] of Object.entries(next)) {
    stmt.run(key, JSON.stringify(val));
  }

  if (partial.customLanguages !== undefined || partial.customRegions !== undefined) {
    cleanupRemovedCategoryLocales(customLangCodes, customRegCodes);
  }

  return next;
}

export function addCustomLanguage(input: {code: string; name?: string}): UserPreferences {
  const current = getPreferences();
  const validation = validateCustomLanguage(input, current.customLanguages);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const nextCustom = [...current.customLanguages, validation.language];
  const nextLanguages = Array.from(new Set([...current.languages, validation.language.code]));
  return updatePreferences({
    customLanguages: nextCustom,
    languages: nextLanguages,
  });
}

export function removeCustomLanguage(code: string): UserPreferences {
  const clean = code.trim().toLowerCase();
  const current = getPreferences();
  const exists = current.customLanguages.some((l) => l.code.toLowerCase() === clean);
  if (!exists) {
    throw new Error(`Custom language "${code}" was not found.`);
  }
  const nextCustom = current.customLanguages.filter((l) => l.code.toLowerCase() !== clean);
  const nextLangs = current.languages.filter((l) => l.toLowerCase() !== clean);
  return updatePreferences({
    customLanguages: nextCustom,
    languages: nextLangs.length > 0 ? nextLangs : ['en'],
  });
}

export function addCustomRegion(input: {
  code?: string;
  name?: string;
  countryCode?: string;
  defaultLanguage?: string;
  queryLocation?: string;
}): UserPreferences {
  const current = getPreferences();
  const validation = validateCustomRegion(input, current.customRegions);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  const nextCustom = [...current.customRegions, validation.region];
  const nextRegions = Array.from(new Set([...current.regions, validation.region.code]));
  return updatePreferences({
    customRegions: nextCustom,
    regions: nextRegions,
  });
}

export function removeCustomRegion(code: string): UserPreferences {
  const clean = code.trim().toUpperCase();
  const current = getPreferences();
  const exists = current.customRegions.some((r) => r.code.toUpperCase() === clean);
  if (!exists) {
    throw new Error(`Custom region "${code}" was not found.`);
  }
  const nextCustom = current.customRegions.filter((r) => r.code.toUpperCase() !== clean);
  const nextRegs = current.regions.filter((r) => r.toUpperCase() !== clean);
  return updatePreferences({
    customRegions: nextCustom,
    regions: nextRegs.length > 0 ? nextRegs : ['US'],
  });
}
