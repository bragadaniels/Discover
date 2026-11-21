import type {ContentType} from '../../shared/types';
import {normalizeDoi, type NormalizedContentItem} from './normalizer';

export interface ExistingDedupeCandidate {
  id: number;
  title: string;
  contentType: ContentType;
  canonicalUrl: string;
  doi: string | null;
  externalId: string | null;
  publishedAt: string | null;
}

const STOPWORDS = new Set([
  // English
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'for', 'to', 'with', 'by', 'from', 'is', 'are', 'at', 'as', 'new', 'study',
  // Portuguese
  'o', 'os', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos', 'para', 'por', 'com', 'que', 'sobre',
  // Spanish
  'el', 'la', 'los', 'las', 'un', 'una', 'del', 'en', 'con', 'por', 'para', 'sobre', 'como',
  // French
  'le', 'les', 'un', 'une', 'des', 'du', 'de', 'dans', 'pour', 'par', 'avec', 'sur', 'est',
  // German
  'der', 'die', 'das', 'ein', 'eine', 'und', 'oder', 'von', 'mit', 'für', 'auf', 'über', 'ist',
]);

function stripDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function tokenizeTitle(title: string): string[] {
  return stripDiacritics(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

export function computeTitleSimilarity(titleA: string, titleB: string): number {
  const normA = stripDiacritics(titleA).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const normB = stripDiacritics(titleB).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const tokensA = new Set(tokenizeTitle(titleA));
  const tokensB = new Set(tokenizeTitle(titleB));
  if (tokensA.size < 3 || tokensB.size < 3) {
    return 0;
  }

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function areDatesClose(dateA: string | null, dateB: string | null, maxDays = 14): boolean {
  if (!dateA || !dateB) return true;
  const msA = Date.parse(dateA);
  const msB = Date.parse(dateB);
  if (Number.isNaN(msA) || Number.isNaN(msB)) return true;
  const diffDays = Math.abs(msA - msB) / (1000 * 60 * 60 * 24);
  return diffDays <= maxDays;
}

function extractCanonicalArxivKey(externalId: string | null, canonicalUrl: string): string | null {
  if (externalId && externalId.toLowerCase().startsWith('arxiv:')) {
    return externalId.slice(6).replace(/v\d+$/i, '').toLowerCase();
  }
  const urlMatch = canonicalUrl.match(
    /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}|[a-z-]+\/[0-9]{7})(?:v\d+)?/i
  );
  return urlMatch ? urlMatch[1].toLowerCase() : null;
}

export function findDuplicateCandidate(
  incoming: Pick<
    NormalizedContentItem,
    'title' | 'contentType' | 'canonicalUrl' | 'doi' | 'externalId' | 'publishedAt'
  >,
  existingList: ExistingDedupeCandidate[]
): ExistingDedupeCandidate | null {
  const incomingDoi = normalizeDoi(incoming.doi);
  const incomingArxiv = extractCanonicalArxivKey(incoming.externalId, incoming.canonicalUrl);

  for (const existing of existingList) {
    // 1 & 2. Canonical / Normalized URL match
    if (existing.canonicalUrl === incoming.canonicalUrl) {
      return existing;
    }

    // 3. DOI exact match for academic publications
    if (incomingDoi && existing.doi && normalizeDoi(existing.doi) === incomingDoi) {
      return existing;
    }

    // 4a. arXiv ID cross-provider match (arXiv / OpenAlex / Semantic Scholar)
    if (incomingArxiv) {
      const existingArxiv = extractCanonicalArxivKey(existing.externalId, existing.canonicalUrl);
      if (existingArxiv && existingArxiv === incomingArxiv) {
        return existing;
      }
    }

    // 4b. External ID match (YouTube videoId, HN objectID, etc.)
    if (
      incoming.externalId &&
      existing.externalId &&
      incoming.externalId === existing.externalId &&
      incoming.contentType === existing.contentType
    ) {
      return existing;
    }

    // 5. Conservative title similarity fallback within same content type & close dates
    if (
      incoming.contentType === existing.contentType &&
      areDatesClose(incoming.publishedAt, existing.publishedAt, 14)
    ) {
      const sim = computeTitleSimilarity(incoming.title, existing.title);
      if (sim >= 0.88) {
        return existing;
      }
    }
  }

  return null;
}
