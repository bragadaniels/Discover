import {resolveRegionMeta} from '../../shared/locale';
import type {ContentType, CustomRegion} from '../../shared/types';

export interface SyncItemInput {
  id: number;
  contentType: ContentType;
  language: string;
  publicationRegion: string | null;
  publisherCountry: string | null;
  providerName: string;
  isSaved: boolean;
}

export interface SyncTagLink {
  categoryId: number;
  categoryIsEnabled: boolean;
  tagIsEnabled: boolean;
  categoryLanguages: string[] | null;
  categoryRegions: string[] | null;
}

export interface SyncPreferenceContext {
  languages: string[];
  regions: string[];
  customRegions: CustomRegion[];
  enabledProviders: Set<string>;
}

export function doesItemMatchActivePreferences(
  item: SyncItemInput,
  links: SyncTagLink[],
  prefs: SyncPreferenceContext,
  scopedCategoryId?: number | 'all'
): boolean {
  if (!prefs.enabledProviders.has(item.providerName)) {
    return false;
  }

  const activeLinks = links.filter((l) => {
    if (!l.categoryIsEnabled || !l.tagIsEnabled) return false;
    if (typeof scopedCategoryId === 'number' && l.categoryId !== scopedCategoryId) {
      return false;
    }
    return true;
  });

  if (activeLinks.length === 0) {
    return false;
  }

  const itemLang = (item.language || 'en').toLowerCase();
  const itemReg = item.publicationRegion ? item.publicationRegion.toUpperCase() : null;
  const itemCountry = item.publisherCountry ? item.publisherCountry.toUpperCase() : null;

  for (const link of activeLinks) {
    const effLangs = (
      link.categoryLanguages && link.categoryLanguages.length > 0
        ? link.categoryLanguages
        : prefs.languages
    ).map((l) => l.toLowerCase());

    if (!effLangs.includes(itemLang)) {
      continue;
    }

    // Providers without region filtering (arXiv, Crossref) emit publicationRegion = null
    if (!itemReg) {
      return true;
    }

    const effRegs = (
      link.categoryRegions && link.categoryRegions.length > 0
        ? link.categoryRegions
        : prefs.regions
    ).map((r) => r.toUpperCase());

    if (effRegs.includes(itemReg)) {
      return true;
    }

    // Allow national press from a country when a city/sub-regional entry of that country is active
    const matchedByCityParentCountry = effRegs.some((regCode) => {
      const meta = resolveRegionMeta(regCode, prefs.customRegions);
      return Boolean(
        meta.queryLocation &&
          ((item.providerName === 'rss_publishers' && itemCountry === meta.countryCode) ||
            itemReg === regCode)
      );
    });
    if (matchedByCityParentCountry) {
      return true;
    }
  }

  return false;
}

export function selectOutdatedNonSavedItemIds(
  items: Array<{item: SyncItemInput; links: SyncTagLink[]}>,
  prefs: SyncPreferenceContext,
  scopedCategoryId?: number | 'all'
): number[] {
  const outdatedIds: number[] = [];
  for (const entry of items) {
    if (entry.item.isSaved) {
      // Never delete saved/favorited items even if preferences change
      continue;
    }
    if (!doesItemMatchActivePreferences(entry.item, entry.links, prefs, scopedCategoryId)) {
      outdatedIds.push(entry.item.id);
    }
  }
  return outdatedIds;
}
