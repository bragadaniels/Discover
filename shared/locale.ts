import type {CustomLanguage, CustomRegion} from './types';

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName: string;
}

export interface SupportedRegion {
  code: string;
  name: string;
  defaultLanguage: string;
}

export interface ResolvedRegionMeta {
  code: string;
  name: string;
  countryCode: string;
  defaultLanguage: string;
  queryLocation: string | null;
  isCustom: boolean;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  {code: 'en', name: 'English', nativeName: 'English'},
  {code: 'pt', name: 'Portuguese', nativeName: 'Português'},
  {code: 'es', name: 'Spanish', nativeName: 'Español'},
  {code: 'fr', name: 'French', nativeName: 'Français'},
  {code: 'de', name: 'German', nativeName: 'Deutsch'},
  {code: 'it', name: 'Italian', nativeName: 'Italiano'},
  {code: 'ja', name: 'Japanese', nativeName: '日本語'},
  {code: 'ko', name: 'Korean', nativeName: '한국어'},
];

export const SUPPORTED_REGIONS: SupportedRegion[] = [
  {code: 'US', name: 'United States', defaultLanguage: 'en'},
  {code: 'GB', name: 'United Kingdom', defaultLanguage: 'en'},
  {code: 'BR', name: 'Brazil', defaultLanguage: 'pt'},
  {code: 'PT', name: 'Portugal', defaultLanguage: 'pt'},
  {code: 'ES', name: 'Spain', defaultLanguage: 'es'},
  {code: 'MX', name: 'Mexico', defaultLanguage: 'es'},
  {code: 'FR', name: 'France', defaultLanguage: 'fr'},
  {code: 'DE', name: 'Germany', defaultLanguage: 'de'},
  {code: 'IT', name: 'Italy', defaultLanguage: 'it'},
  {code: 'JP', name: 'Japan', defaultLanguage: 'ja'},
  {code: 'KR', name: 'South Korea', defaultLanguage: 'ko'},
  {code: 'CA', name: 'Canada', defaultLanguage: 'en'},
  {code: 'AU', name: 'Australia', defaultLanguage: 'en'},
];

export const SUPPORTED_LANGUAGE_CODES = SUPPORTED_LANGUAGES.map((l) => l.code);
export const SUPPORTED_REGION_CODES = SUPPORTED_REGIONS.map((r) => r.code);

// Major country defaults for custom ISO country codes when user doesn't specify defaultLanguage
const COUNTRY_DEFAULT_LANGUAGE: Record<string, string> = {
  AR: 'es',
  CL: 'es',
  CO: 'es',
  PE: 'es',
  UY: 'es',
  NL: 'nl',
  BE: 'nl',
  CH: 'de',
  AT: 'de',
  PL: 'pl',
  SE: 'sv',
  NO: 'no',
  DK: 'da',
  FI: 'fi',
  RU: 'ru',
  TR: 'tr',
  IN: 'en',
  IE: 'en',
  NZ: 'en',
  ZA: 'en',
  CN: 'zh',
  TW: 'zh',
  HK: 'zh',
  AE: 'ar',
  SA: 'ar',
  EG: 'ar',
  IL: 'he',
  GR: 'el',
  CZ: 'cs',
  RO: 'ro',
  HU: 'hu',
  ID: 'id',
  VN: 'vi',
  TH: 'th',
  PH: 'en',
  AO: 'pt',
  MZ: 'pt',
};

const LANG_NAME_FALLBACK: Record<string, string> = {
  nl: 'Dutch',
  ru: 'Russian',
  zh: 'Chinese',
  ar: 'Arabic',
  hi: 'Hindi',
  sv: 'Swedish',
  pl: 'Polish',
  tr: 'Turkish',
  no: 'Norwegian',
  da: 'Danish',
  fi: 'Finnish',
  el: 'Greek',
  he: 'Hebrew',
  cs: 'Czech',
  ro: 'Romanian',
  hu: 'Hungarian',
  uk: 'Ukrainian',
  id: 'Indonesian',
  vi: 'Vietnamese',
  th: 'Thai',
  ca: 'Catalan',
  gl: 'Galician',
};

function resolveIntlLanguageName(code: string): string | null {
  try {
    const dn = new Intl.DisplayNames(['en'], {type: 'language'});
    const label = dn.of(code);
    if (label && label.toLowerCase() !== code.toLowerCase()) {
      return label;
    }
  } catch {
    // Fallback below
  }
  return LANG_NAME_FALLBACK[code.toLowerCase()] || null;
}

function resolveIntlRegionName(countryCode: string): string | null {
  try {
    const dn = new Intl.DisplayNames(['en'], {type: 'region'});
    const label = dn.of(countryCode.toUpperCase());
    if (label && label.toUpperCase() !== countryCode.toUpperCase() && label !== 'Unknown Region') {
      return label;
    }
  } catch {
    // Ignore unsupported region code
  }
  return null;
}

export function validateCustomLanguage(
  input: {code: string; name?: string},
  existingCustom: CustomLanguage[] = []
): {ok: true; language: CustomLanguage} | {ok: false; error: string} {
  const rawCode = (input.code || '').trim().toLowerCase().replace(/_/g, '-');
  if (!rawCode) {
    return {ok: false, error: 'Enter an ISO language code (e.g. nl, zh, ar, ru, sv).'};
  }
  if (!/^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(rawCode)) {
    return {
      ok: false,
      error: 'Language code must be a 2–3 letter ISO code (e.g. nl, sv, zh or zh-hans).',
    };
  }

  if (
    SUPPORTED_LANGUAGE_CODES.includes(rawCode) ||
    existingCustom.some((c) => c.code.toLowerCase() === rawCode)
  ) {
    return {ok: false, error: `Language "${rawCode.toUpperCase()}" is already in your list.`};
  }

  const trimmedName = (input.name || '').trim();
  const inferredName = resolveIntlLanguageName(rawCode);
  const resolvedName = trimmedName || inferredName;

  if (!resolvedName || resolvedName.length < 2) {
    return {
      ok: false,
      error: `Provide a display name for custom language "${rawCode}".`,
    };
  }

  return {
    ok: true,
    language: {
      code: rawCode,
      name: resolvedName.slice(0, 60),
    },
  };
}

function buildRegionSlugCode(name: string, countryCode: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 14);
  return cleaned ? `${countryCode}-${cleaned}` : countryCode;
}

export function validateCustomRegion(
  input: {
    code?: string;
    name?: string;
    countryCode?: string;
    defaultLanguage?: string;
    queryLocation?: string;
  },
  existingCustom: CustomRegion[] = []
): {ok: true; region: CustomRegion} | {ok: false; error: string} {
  const rawCode = (input.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '-');
  const rawName = (input.name || '').trim();
  const rawCountry = (input.countryCode || '').trim().toUpperCase();
  const rawQueryLoc = (input.queryLocation || '').trim();

  if (!rawCode && !rawName) {
    return {
      ok: false,
      error: 'Enter a country code (e.g. AR, NL) or a city/region name (e.g. Fortaleza).',
    };
  }

  // Case 1: 2-letter country code provided (or name omitted)
  const inferredCountryFromCode = /^[A-Z]{2}$/.test(rawCode) ? rawCode : '';
  const countryCode = rawCountry || inferredCountryFromCode;

  if (!countryCode || !/^[A-Z]{2}$/.test(countryCode)) {
    return {
      ok: false,
      error: 'Provide a 2-letter ISO country code (e.g. BR, AR, US, NL, IN) for this region.',
    };
  }

  const intlCountryName = resolveIntlRegionName(countryCode);
  const isPureCountry =
    (!rawQueryLoc && /^[A-Z]{2}$/.test(rawCode) && !rawName) ||
    (rawCode === countryCode && (!rawName || rawName.toLowerCase() === intlCountryName?.toLowerCase()));

  const finalName =
    rawName ||
    intlCountryName ||
    (rawQueryLoc ? `${rawQueryLoc} (${countryCode})` : '');

  if (!finalName || finalName.length < 2) {
    return {
      ok: false,
      error: `Provide a recognizable name for region code "${rawCode || countryCode}".`,
    };
  }

  const finalCode =
    rawCode && /^[A-Z0-9][A-Z0-9-]{1,23}$/.test(rawCode)
      ? rawCode
      : isPureCountry
        ? countryCode
        : buildRegionSlugCode(rawQueryLoc || finalName, countryCode);

  if (
    SUPPORTED_REGION_CODES.includes(finalCode) ||
    existingCustom.some((r) => r.code.toUpperCase() === finalCode)
  ) {
    return {ok: false, error: `Region "${finalCode}" is already in your list.`};
  }

  const defaultLangInput = (input.defaultLanguage || '').trim().toLowerCase();
  const matchedPredefined = SUPPORTED_REGIONS.find((r) => r.code === countryCode);
  const defaultLanguage =
    (/^[a-z]{2,3}$/.test(defaultLangInput) ? defaultLangInput : '') ||
    matchedPredefined?.defaultLanguage ||
    COUNTRY_DEFAULT_LANGUAGE[countryCode] ||
    'en';

  const queryLocation = rawQueryLoc
    ? rawQueryLoc.slice(0, 60)
    : !isPureCountry && finalCode !== countryCode
      ? finalName.split(',')[0].trim().slice(0, 60)
      : null;

  return {
    ok: true,
    region: {
      code: finalCode,
      name: finalName.slice(0, 60),
      countryCode,
      defaultLanguage,
      queryLocation,
    },
  };
}

export function normalizeCustomLanguages(input: unknown): CustomLanguage[] {
  if (!Array.isArray(input)) return [];
  const out: CustomLanguage[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as {code?: unknown; name?: unknown};
    const code = typeof obj.code === 'string' ? obj.code.trim().toLowerCase() : '';
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    const res = validateCustomLanguage({code, name}, out);
    if (res.ok) out.push(res.language);
  }
  return out;
}

export function normalizeCustomRegions(input: unknown): CustomRegion[] {
  if (!Array.isArray(input)) return [];
  const out: CustomRegion[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as {
      code?: unknown;
      name?: unknown;
      countryCode?: unknown;
      defaultLanguage?: unknown;
      queryLocation?: unknown;
    };
    const res = validateCustomRegion(
      {
        code: typeof obj.code === 'string' ? obj.code : undefined,
        name: typeof obj.name === 'string' ? obj.name : undefined,
        countryCode: typeof obj.countryCode === 'string' ? obj.countryCode : undefined,
        defaultLanguage: typeof obj.defaultLanguage === 'string' ? obj.defaultLanguage : undefined,
        queryLocation: typeof obj.queryLocation === 'string' ? obj.queryLocation : undefined,
      },
      out
    );
    if (res.ok) out.push(res.region);
  }
  return out;
}

export function normalizeLanguageList(
  input: unknown,
  fallback: string[] = ['en'],
  allowedCustomCodes: string[] = []
): string[] {
  const valid = new Set([
    ...SUPPORTED_LANGUAGE_CODES,
    ...allowedCustomCodes.map((c) => c.trim().toLowerCase()).filter(Boolean),
  ]);
  const isValidToken = (v: string) =>
    valid.has(v) || (allowedCustomCodes.length === 0 && /^[a-z]{2,3}(?:-[a-z]{2,4})?$/.test(v));

  if (!Array.isArray(input)) {
    if (typeof input === 'string') {
      const clean = input.trim().toLowerCase();
      if (isValidToken(clean)) return [clean];
    }
    return [...fallback];
  }
  const deduped = Array.from(
    new Set(
      input
        .map((v) => String(v || '').trim().toLowerCase())
        .filter((v) => valid.has(v))
    )
  );
  return deduped.length > 0 ? deduped : [...fallback];
}

export function normalizeRegionList(
  input: unknown,
  fallback: string[] = ['US'],
  allowedCustomCodes: string[] = []
): string[] {
  const valid = new Set([
    ...SUPPORTED_REGION_CODES,
    ...allowedCustomCodes.map((c) => c.trim().toUpperCase()).filter(Boolean),
  ]);

  if (!Array.isArray(input)) {
    if (typeof input === 'string') {
      const clean = input.trim().toUpperCase();
      if (valid.has(clean)) return [clean];
    }
    return [...fallback];
  }
  const deduped = Array.from(
    new Set(
      input
        .map((v) => String(v || '').trim().toUpperCase())
        .filter((v) => valid.has(v))
    )
  );
  return deduped.length > 0 ? deduped : [...fallback];
}

export function getLanguageLabel(code: string, customLanguages: CustomLanguage[] = []): string {
  const clean = code.toLowerCase();
  const found = SUPPORTED_LANGUAGES.find((l) => l.code === clean);
  if (found) return found.name;
  const custom = customLanguages.find((l) => l.code.toLowerCase() === clean);
  if (custom) return custom.name;
  return resolveIntlLanguageName(clean) || code.toUpperCase();
}

export function getRegionLabel(code: string, customRegions: CustomRegion[] = []): string {
  const clean = code.toUpperCase();
  const found = SUPPORTED_REGIONS.find((r) => r.code === clean);
  if (found) return found.name;
  const custom = customRegions.find((r) => r.code.toUpperCase() === clean);
  if (custom) return custom.name;
  return resolveIntlRegionName(clean) || clean;
}

export function resolveRegionMeta(
  code: string,
  customRegions: CustomRegion[] = []
): ResolvedRegionMeta {
  const clean = code.toUpperCase();
  const predefined = SUPPORTED_REGIONS.find((r) => r.code === clean);
  if (predefined) {
    return {
      code: predefined.code,
      name: predefined.name,
      countryCode: predefined.code,
      defaultLanguage: predefined.defaultLanguage,
      queryLocation: null,
      isCustom: false,
    };
  }
  const custom = customRegions.find((r) => r.code.toUpperCase() === clean);
  if (custom) {
    return {
      code: custom.code,
      name: custom.name,
      countryCode: custom.countryCode,
      defaultLanguage: custom.defaultLanguage,
      queryLocation: custom.queryLocation || null,
      isCustom: true,
    };
  }
  const fallbackCountry = /^[A-Z]{2}$/.test(clean) ? clean : 'US';
  return {
    code: clean,
    name: resolveIntlRegionName(fallbackCountry) || clean,
    countryCode: fallbackCountry,
    defaultLanguage: COUNTRY_DEFAULT_LANGUAGE[fallbackCountry] || 'en',
    queryLocation: null,
    isCustom: true,
  };
}

export function getLocaleProviderLimitations(
  languages: string[],
  regions: string[],
  customLanguages: CustomLanguage[] = [],
  customRegions: CustomRegion[] = []
): string[] {
  const notes: string[] = [];
  const customLangSet = new Set(customLanguages.map((l) => l.code.toLowerCase()));
  const activeCustomLangs = languages.filter((l) => customLangSet.has(l.toLowerCase()));
  const activeCityRegions = regions
    .map((r) => resolveRegionMeta(r, customRegions))
    .filter((r) => r.queryLocation);

  if (languages.some((l) => l !== 'en')) {
    notes.push(
      'arXiv searches English preprints only; Crossref queries multilingual terms globally without geographic filtering.'
    );
  }
  if (activeCustomLangs.length > 0) {
    notes.push(
      `Custom languages (${activeCustomLangs.map((l) => getLanguageLabel(l, customLanguages)).join(', ')}): News and YouTube providers accept ISO language codes directly, though regional edition depth varies outside major news markets.`
    );
  }
  if (activeCityRegions.length > 0) {
    notes.push(
      `Local city/regional entries (${activeCityRegions.map((r) => r.name).join(', ')}) use their parent country edition (${Array.from(new Set(activeCityRegions.map((r) => r.countryCode))).join(', ')}) combined with local publication and city-name discovery queries.`
    );
  }
  return notes;
}
