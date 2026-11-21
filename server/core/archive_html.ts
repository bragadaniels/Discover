import * as cheerio from 'cheerio';
import type {ArchiveStatus} from '../../shared/types';
import {isDangerousExecutable, sanitizeArchivedHtml} from './archive_security';

export interface CapturedResource {
  url: string;
  contentType: string;
  body: Buffer;
}

export interface HtmlArchiveMetadata {
  archiveUid: string;
  title: string;
  originalUrl: string;
  canonicalUrl: string;
  archivedAt: string;
  publishedAt?: string | null;
  author?: string | null;
  publisher?: string | null;
  doi?: string | null;
  language?: string | null;
}

export interface HtmlArchiveBuildResult {
  html: string;
  resourcesCaptured: number;
  resourcesFailed: number;
  warnings: string[];
  statusSuggestion: Exclude<ArchiveStatus, 'failed'>;
  completeness: number;
  extractedMeta: {
    title?: string;
    author?: string;
    publishedAt?: string;
    language?: string;
    description?: string;
  };
}

export type ResourceFetcher = (url: string) => Promise<CapturedResource | null>;

function resolveUrl(ref: string, base: string): string | null {
  const cleaned = ref.trim();
  if (
    !cleaned ||
    cleaned.startsWith('data:') ||
    cleaned.startsWith('blob:') ||
    cleaned.startsWith('javascript:') ||
    cleaned.startsWith('#')
  ) {
    return null;
  }
  try {
    return new URL(cleaned, base).toString();
  } catch {
    return null;
  }
}

function guessMimeFromUrl(url: string, fallback = 'application/octet-stream'): string {
  const clean = url.split('?')[0].split('#')[0].toLowerCase();
  if (clean.endsWith('.css')) return 'text/css';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.gif')) return 'image/gif';
  if (clean.endsWith('.svg')) return 'image/svg+xml';
  if (clean.endsWith('.ico')) return 'image/x-icon';
  if (clean.endsWith('.woff2')) return 'font/woff2';
  if (clean.endsWith('.woff')) return 'font/woff';
  if (clean.endsWith('.ttf')) return 'font/ttf';
  if (clean.endsWith('.otf')) return 'font/otf';
  return fallback;
}

function toDataUri(body: Buffer, contentType: string, url: string): string {
  const mime = (contentType || '').split(';')[0].trim() || guessMimeFromUrl(url);
  return `data:${mime};base64,${body.toString('base64')}`;
}

export function extractHtmlDocumentMetadata(html: string): {
  title?: string;
  author?: string;
  publishedAt?: string;
  language?: string;
  description?: string;
} {
  const $ = cheerio.load(html);
  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('meta[name="citation_title"]').attr('content')?.trim() ||
    $('title').first().text().trim() ||
    $('h1').first().text().trim() ||
    undefined;

  const author =
    $('meta[name="author"]').attr('content')?.trim() ||
    $('meta[name="citation_author"]').attr('content')?.trim() ||
    $('meta[property="article:author"]').attr('content')?.trim() ||
    undefined;

  const publishedAt =
    $('meta[property="article:published_time"]').attr('content')?.trim() ||
    $('meta[name="citation_publication_date"]').attr('content')?.trim() ||
    $('meta[name="pubdate"]').attr('content')?.trim() ||
    $('time[datetime]').first().attr('datetime')?.trim() ||
    undefined;

  const language =
    $('html').attr('lang')?.trim().split(/[-_]/)[0]?.toLowerCase() ||
    $('meta[http-equiv="content-language"]').attr('content')?.trim().split(/[-_]/)[0]?.toLowerCase() ||
    undefined;

  const description =
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[property="og:description"]').attr('content')?.trim() ||
    undefined;

  return {title, author, publishedAt, language, description};
}

export async function buildSelfContainedHtml(options: {
  rawHtml: string;
  pageUrl: string;
  metadata: HtmlArchiveMetadata;
  capturedResources: Map<string, CapturedResource>;
  fetchResource?: ResourceFetcher;
  extraCapturedCssText?: string[];
  maxResourceBytes?: number;
  maxTotalBytes?: number;
}): Promise<HtmlArchiveBuildResult> {
  const maxResourceBytes = options.maxResourceBytes ?? 5 * 1024 * 1024;
  const maxTotalBytes = options.maxTotalBytes ?? 45 * 1024 * 1024;
  let accumulatedBytes = Buffer.byteLength(options.rawHtml, 'utf8');
  let resourcesCaptured = 0;
  let resourcesFailed = 0;
  const warnings: string[] = [];

  const extractedMeta = extractHtmlDocumentMetadata(options.rawHtml);

  const lookupOrFetch = async (targetUrl: string): Promise<CapturedResource | null> => {
    if (isDangerousExecutable(targetUrl)) {
      warnings.push(`Skipped potentially executable resource: ${targetUrl}`);
      return null;
    }
    const existing = options.capturedResources.get(targetUrl);
    if (existing) {
      if (isDangerousExecutable(targetUrl, existing.contentType)) return null;
      if (existing.body.length > maxResourceBytes) {
        warnings.push(`Skipped oversized resource (${Math.round(existing.body.length / 1024)} KB): ${targetUrl}`);
        return null;
      }
      return existing;
    }
    if (!options.fetchResource) return null;
    try {
      const fetched = await options.fetchResource(targetUrl);
      if (!fetched) return null;
      if (isDangerousExecutable(targetUrl, fetched.contentType)) return null;
      if (fetched.body.length > maxResourceBytes) {
        warnings.push(`Skipped oversized resource (${Math.round(fetched.body.length / 1024)} KB): ${targetUrl}`);
        return null;
      }
      if (accumulatedBytes + fetched.body.length > maxTotalBytes) {
        warnings.push('Reached maximum archive bundle size limit; remaining assets skipped.');
        return null;
      }
      accumulatedBytes += fetched.body.length;
      options.capturedResources.set(targetUrl, fetched);
      return fetched;
    } catch {
      return null;
    }
  };

  const inlineCssUrls = async (cssText: string, cssBaseUrl: string, depth = 0): Promise<string> => {
    let output = cssText;

    // Resolve nested @import directives up to depth 2
    if (depth < 2) {
      const importRegex = /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)\s*([^;]*);/gi;
      const matches = Array.from(output.matchAll(importRegex));
      for (const m of matches) {
        const importRef = (m[2] || m[4] || '').trim();
        const media = (m[5] || '').trim();
        const absUrl = resolveUrl(importRef, cssBaseUrl);
        if (!absUrl) continue;
        const res = await lookupOrFetch(absUrl);
        if (res) {
          resourcesCaptured++;
          const nestedCss = await inlineCssUrls(res.body.toString('utf8'), absUrl, depth + 1);
          const wrapped = media ? `@media ${media} {\n${nestedCss}\n}` : nestedCss;
          output = output.replace(m[0], wrapped);
        } else {
          resourcesFailed++;
          output = output.replace(m[0], `/* offline archive: unable to inline @import ${absUrl} */`);
        }
      }
    }

    // Inline url(...) references inside CSS (fonts, background images, icons)
    const urlRegex = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
    const urlMatches = Array.from(output.matchAll(urlRegex));
    const replacements = new Map<string, string>();
    for (const m of urlMatches) {
      const rawRef = m[2].trim();
      if (!rawRef || rawRef.startsWith('data:') || rawRef.startsWith('#') || rawRef.startsWith('blob:')) {
        continue;
      }
      if (replacements.has(m[0])) continue;
      const absUrl = resolveUrl(rawRef, cssBaseUrl);
      if (!absUrl) continue;
      const res = await lookupOrFetch(absUrl);
      if (res) {
        resourcesCaptured++;
        replacements.set(m[0], `url("${toDataUri(res.body, res.contentType, absUrl)}")`);
      } else {
        resourcesFailed++;
      }
    }

    for (const [needle, replacement] of replacements.entries()) {
      output = output.split(needle).join(replacement);
    }
    return output;
  };

  // Sanitize executable vectors first so cheerio parses safely
  const preSanitized = sanitizeArchivedHtml(options.rawHtml);
  const $ = cheerio.load(preSanitized);

  // Ensure charset + responsive viewport
  if ($('head').length === 0) {
    $('html').prepend('<head></head>');
  }
  if ($('head meta[charset]').length === 0) {
    $('head').prepend('<meta charset="utf-8" />');
  }
  if ($('head meta[name="viewport"]').length === 0) {
    $('head').append('<meta name="viewport" content="width=device-width, initial-scale=1.0" />');
  }

  // Inline external stylesheets
  const stylesheetLinks = $('link[rel*="stylesheet" i]').toArray();
  for (const el of stylesheetLinks) {
    const link = $(el);
    const href = link.attr('href');
    if (!href) continue;
    const absUrl = resolveUrl(href, options.pageUrl);
    if (!absUrl) continue;

    const res = await lookupOrFetch(absUrl);
    if (res) {
      resourcesCaptured++;
      const inlinedCss = await inlineCssUrls(res.body.toString('utf8'), absUrl, 0);
      const media = link.attr('media');
      const styleTag = $('<style></style>')
        .attr('data-discover-archived-css', absUrl)
        .text(inlinedCss);
      if (media) styleTag.attr('media', media);
      link.replaceWith(styleTag);
    } else {
      resourcesFailed++;
      warnings.push(`Could not inline stylesheet: ${absUrl}`);
      link.remove();
    }
  }

  // Remove preload/prefetch links that still point externally
  $('link[rel="preload"], link[rel="prefetch"], link[rel="dns-prefetch"], link[rel="preconnect"]').remove();

  // Process inline <style> elements for url(...) fonts & backgrounds
  const inlineStyles = $('style').toArray();
  for (const el of inlineStyles) {
    const styleEl = $(el);
    if (styleEl.attr('data-discover-archived-css')) continue;
    const rawCss = styleEl.text();
    if (rawCss && /url\(|@import/i.test(rawCss)) {
      const processed = await inlineCssUrls(rawCss, options.pageUrl, 0);
      styleEl.text(processed);
    }
  }

  // Append CSSOM / adopted stylesheets extracted directly from Chromium if any
  if (options.extraCapturedCssText && options.extraCapturedCssText.length > 0) {
    const joined = options.extraCapturedCssText.filter(Boolean).join('\n');
    if (joined.trim()) {
      const processed = await inlineCssUrls(joined, options.pageUrl, 0);
      $('head').append(
        $('<style></style>').attr('data-discover-cssom', 'true').text(processed)
      );
    }
  }

  // Inline inline style="..." url(...) attributes
  const styledEls = $('[style]').toArray();
  for (const el of styledEls) {
    const node = $(el);
    const inlineAttr = node.attr('style');
    if (inlineAttr && inlineAttr.includes('url(')) {
      node.attr('style', await inlineCssUrls(inlineAttr, options.pageUrl, 1));
    }
  }

  // Inline images (<img src / data-src>, <picture source>, favicons, SVG <image>)
  const imgEls = $('img').toArray();
  for (const el of imgEls) {
    const img = $(el);
    const rawSrc =
      img.attr('src') ||
      img.attr('data-src') ||
      img.attr('data-lazy-src') ||
      img.attr('data-original') ||
      '';
    img.removeAttr('loading');
    img.removeAttr('decoding');

    if (!rawSrc) continue;
    if (rawSrc.startsWith('data:')) {
      resourcesCaptured++;
      img.removeAttr('srcset');
      continue;
    }
    const absUrl = resolveUrl(rawSrc, options.pageUrl);
    if (!absUrl) continue;

    const res = await lookupOrFetch(absUrl);
    if (res) {
      resourcesCaptured++;
      img.attr('src', toDataUri(res.body, res.contentType, absUrl));
      img.removeAttr('srcset');
    } else {
      resourcesFailed++;
      img.attr('data-discover-missing-src', absUrl);
      img.removeAttr('src');
      img.removeAttr('srcset');
    }
  }

  // Clean <source srcset> inside <picture> when parent img was inlined or unavailable
  $('picture source[srcset]').remove();

  // Inline favicons
  const iconLinks = $('link[rel*="icon" i]').toArray();
  for (const el of iconLinks) {
    const icon = $(el);
    const href = icon.attr('href');
    if (!href || href.startsWith('data:')) continue;
    const absUrl = resolveUrl(href, options.pageUrl);
    if (!absUrl) {
      icon.remove();
      continue;
    }
    const res = await lookupOrFetch(absUrl);
    if (res) {
      resourcesCaptured++;
      icon.attr('href', toDataUri(res.body, res.contentType, absUrl));
    } else {
      icon.remove();
    }
  }

  // Strip lingering external media src attributes so offline view never triggers external requests
  $('video[src], audio[src], source[src]').each((_, el) => {
    const node = $(el);
    const src = node.attr('src') || '';
    if (src && !src.startsWith('data:')) {
      node.attr('data-discover-external-media', src);
      node.removeAttr('src');
    }
  });

  // Neutralize poster external URLs on video tags if not captured
  const posterVideos = $('video[poster]').toArray();
  for (const el of posterVideos) {
    const vid = $(el);
    const poster = vid.attr('poster') || '';
    if (!poster || poster.startsWith('data:')) continue;
    const absUrl = resolveUrl(poster, options.pageUrl);
    const res = absUrl ? await lookupOrFetch(absUrl) : null;
    if (res) {
      resourcesCaptured++;
      vid.attr('poster', toDataUri(res.body, res.contentType, absUrl!));
    } else {
      vid.removeAttr('poster');
    }
  }

  // Final sanitization pass to guarantee zero active scripts remain
  const finalBodyHtml = sanitizeArchivedHtml($.html());
  const provenanceComment = [
    '<!--',
    '  Discover Personal Web Archive (Self-Contained HTML)',
    `  Archive ID: ${options.metadata.archiveUid}`,
    `  Title: ${options.metadata.title.replace(/--/g, '-')}`,
    `  Original URL: ${options.metadata.originalUrl.replace(/--/g, '-')}`,
    `  Archived At: ${options.metadata.archivedAt}`,
    options.metadata.publishedAt ? `  Published At: ${options.metadata.publishedAt}` : null,
    options.metadata.author ? `  Author: ${options.metadata.author.replace(/--/g, '-')}` : null,
    options.metadata.doi ? `  DOI: ${options.metadata.doi}` : null,
    '-->',
  ]
    .filter(Boolean)
    .join('\n');

  const finalHtml = `<!DOCTYPE html>\n${provenanceComment}\n${finalBodyHtml.replace(/^<!doctype html>\s*/i, '')}`;

  const totalAssets = resourcesCaptured + resourcesFailed;
  let completeness = 100;
  let statusSuggestion: Exclude<ArchiveStatus, 'failed'> = 'complete';

  if (totalAssets > 0) {
    const ratio = resourcesCaptured / totalAssets;
    completeness = Math.max(25, Math.min(100, Math.round(ratio * 100)));
    if (resourcesFailed > 0 && resourcesCaptured === 0) {
      statusSuggestion = 'text_only';
      completeness = Math.min(completeness, 45);
    } else if (resourcesFailed > 0 && ratio < 0.85) {
      statusSuggestion = 'partial';
    } else if (resourcesFailed > 0) {
      statusSuggestion = 'partial';
    }
  }

  return {
    html: finalHtml,
    resourcesCaptured,
    resourcesFailed,
    warnings,
    statusSuggestion,
    completeness,
    extractedMeta,
  };
}
