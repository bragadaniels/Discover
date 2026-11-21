import * as cheerio from 'cheerio';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {Readable} from 'node:stream';
import {WARC_1_1, WARCParser, WARCRecord, WARCSerializer} from 'warcio';
import type {WarcRecordSummary} from '../../shared/types';
import {sanitizeArchivedHtml} from './archive_security';

export interface WarcHttpExchange {
  url: string;
  method: string;
  requestHeaders: Record<string, string>;
  status: number;
  statusText: string;
  responseHeaders: Record<string, string>;
  body: Buffer;
  timestamp: string;
}

export interface WarcBuildOptions {
  archiveUid: string;
  targetUrl: string;
  title: string;
  archivedAt: string;
  exchanges: WarcHttpExchange[];
  limitations?: string[];
}

export const WARC_DOCUMENTED_LIMITATIONS: string[] = [
  'Authenticated sessions, cookies, and paywalled resources are not bypassed and cannot be captured without user-authorized public access.',
  'Dynamic client-side API calls triggered only after post-load user interaction or infinite scroll may not appear in static WARC playback.',
  'External media streams (adaptive HLS/DASH video) and third-party DRM-protected assets are omitted or recorded only as metadata.',
  'Local WARC replay runs with scripts disabled in a sandboxed frame for security, reflecting the post-load/captured state rather than live interactive scripts.',
];

function sanitizeHeaderRecord(headers: Record<string, string>, omitBodyEncoding = false): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = k.trim();
    if (!key) continue;
    const lower = key.toLowerCase();
    // Since body bytes captured from network are already decoded buffers, omit transfer-encoding / content-encoding
    if (
      omitBodyEncoding &&
      (lower === 'content-encoding' || lower === 'transfer-encoding' || lower === 'content-length')
    ) {
      continue;
    }
    if (lower.startsWith(':')) continue; // Strip HTTP/2 pseudo-headers
    clean[key] = String(v).replace(/[\r\n]+/g, ' ').trim();
  }
  return clean;
}

function makeUrnUuid(): string {
  return `<urn:uuid:${crypto.randomUUID()}>`;
}

export async function buildWarc11Archive(options: WarcBuildOptions): Promise<{
  buffer: Buffer;
  recordCount: number;
}> {
  const chunks: Buffer[] = [];
  let recordCount = 0;
  const filename = `${options.archiveUid}.warc.gz`;

  const warcInfo = WARCRecord.createWARCInfo(
    {
      filename,
      date: options.archivedAt,
      warcVersion: WARC_1_1,
    },
    {
      software: 'Discover Web Archiving Engine (warcio)',
      format: 'WARC File Format 1.1',
      archiveUid: options.archiveUid,
      targetUrl: options.targetUrl,
      title: options.title,
      limitations: (options.limitations || WARC_DOCUMENTED_LIMITATIONS).join(' | '),
    }
  );
  chunks.push(Buffer.from(await WARCSerializer.serialize(warcInfo, {gzip: true, preferPako: true})));
  recordCount++;

  for (const ex of options.exchanges) {
    if (!ex.url || !ex.url.startsWith('http')) continue;
    let parsed: URL;
    try {
      parsed = new URL(ex.url);
    } catch {
      continue;
    }

    const reqId = makeUrnUuid();
    const resId = makeUrnUuid();
    const dateIso = ex.timestamp || options.archivedAt;
    const reqPath = `${parsed.pathname || '/'}${parsed.search || ''}`;

    const reqHeaders = sanitizeHeaderRecord(ex.requestHeaders);
    if (!reqHeaders.Host && !reqHeaders.host) {
      reqHeaders.Host = parsed.host;
    }

    const reqRecord = WARCRecord.create({
      url: ex.url,
      date: dateIso,
      type: 'request',
      warcVersion: WARC_1_1,
      statusline: `${(ex.method || 'GET').toUpperCase()} ${reqPath} HTTP/1.1`,
      httpHeaders: reqHeaders,
      warcHeaders: {
        'WARC-Record-ID': reqId,
      },
    });
    chunks.push(Buffer.from(await WARCSerializer.serialize(reqRecord, {gzip: true, preferPako: true})));
    recordCount++;

    const resHeaders = sanitizeHeaderRecord(ex.responseHeaders, true);
    resHeaders['Content-Length'] = String(ex.body.length);

    const statusCode = ex.status || 200;
    const statusText = ex.statusText || (statusCode === 200 ? 'OK' : 'Captured');

    const resRecord = WARCRecord.create(
      {
        url: ex.url,
        date: dateIso,
        type: 'response',
        warcVersion: WARC_1_1,
        statusline: `HTTP/1.1 ${statusCode} ${statusText}`,
        httpHeaders: resHeaders,
        warcHeaders: {
          'WARC-Record-ID': resId,
          'WARC-Concurrent-To': reqId,
        },
      },
      [new Uint8Array(ex.body)]
    );
    chunks.push(Buffer.from(await WARCSerializer.serialize(resRecord, {gzip: true, preferPako: true})));
    recordCount++;
  }

  return {
    buffer: Buffer.concat(chunks),
    recordCount,
  };
}

function headersToPlainObject(headersObj: Headers | Map<string, string> | undefined | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!headersObj) return out;
  for (const [k, v] of headersObj.entries()) {
    out[k] = v;
  }
  return out;
}

export async function inspectWarcBuffer(warcBuffer: Buffer): Promise<WarcRecordSummary[]> {
  const summaries: WarcRecordSummary[] = [];
  const stream = Readable.from([warcBuffer]);
  for await (const record of WARCParser.iterRecords(stream, {parseHttp: true})) {
    const payload = await record.readFully(true);
    const respInfo = record.getResponseInfo();
    const httpHeaders = headersToPlainObject(respInfo?.headers || record.httpHeaders?.headers);
    const contentType =
      httpHeaders['content-type'] ||
      httpHeaders['Content-Type'] ||
      record.warcContentType ||
      null;
    const rawStatus = respInfo?.status;
    const httpStatus = rawStatus !== undefined ? Number(rawStatus) : null;

    summaries.push({
      warcType: record.warcType,
      targetUri: record.warcTargetURI || null,
      recordId: record.warcHeader('WARC-Record-ID') || null,
      date: record.warcDate || null,
      contentType,
      httpStatus: Number.isFinite(httpStatus) ? httpStatus : null,
      payloadBytes: payload.length,
      httpHeaders,
    });
  }
  return summaries;
}

export async function inspectWarcFile(filePath: string): Promise<WarcRecordSummary[]> {
  const buf = await fs.readFile(filePath);
  return inspectWarcBuffer(buf);
}

function normalizeLookupUrl(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    return parsed.toString();
  } catch {
    return u.trim();
  }
}

export interface WarcReplayResource {
  targetUri: string;
  status: number;
  contentType: string;
  headers: Record<string, string>;
  body: Buffer;
}

export async function extractWarcResource(
  warcBuffer: Buffer,
  requestedUrl?: string | null
): Promise<WarcReplayResource | null> {
  const stream = Readable.from([warcBuffer]);
  const normalizedTarget = requestedUrl ? normalizeLookupUrl(requestedUrl) : null;
  let firstHtmlCandidate: WarcReplayResource | null = null;
  let firstResponseCandidate: WarcReplayResource | null = null;

  for await (const record of WARCParser.iterRecords(stream, {parseHttp: true})) {
    if (record.warcType !== 'response') {
      await record.skipFully();
      continue;
    }

    const uri = record.warcTargetURI || '';
    const payload = await record.readFully(true);
    const respInfo = record.getResponseInfo();
    const headers = headersToPlainObject(respInfo?.headers);
    const contentType = headers['content-type'] || headers['Content-Type'] || 'application/octet-stream';
    const status = Number(respInfo?.status) || 200;

    const candidate: WarcReplayResource = {
      targetUri: uri,
      status,
      contentType,
      headers,
      body: Buffer.from(payload),
    };

    if (!firstResponseCandidate) firstResponseCandidate = candidate;
    if (!firstHtmlCandidate && contentType.toLowerCase().includes('text/html')) {
      firstHtmlCandidate = candidate;
    }

    if (normalizedTarget) {
      if (uri === requestedUrl || normalizeLookupUrl(uri) === normalizedTarget) {
        return candidate;
      }
    }
  }

  return normalizedTarget ? null : firstHtmlCandidate || firstResponseCandidate;
}

export function rewriteHtmlForWarcReplay(
  html: string,
  baseUrl: string,
  archiveUid: string
): string {
  const sanitized = sanitizeArchivedHtml(html);
  const $ = cheerio.load(sanitized);

  const toReplayUrl = (rawRef: string): string | null => {
    const clean = rawRef.trim();
    if (
      !clean ||
      clean.startsWith('data:') ||
      clean.startsWith('blob:') ||
      clean.startsWith('#') ||
      clean.startsWith('javascript:')
    ) {
      return null;
    }
    try {
      const abs = new URL(clean, baseUrl).toString();
      return `/api/archives/${encodeURIComponent(archiveUid)}/warc-replay?url=${encodeURIComponent(abs)}`;
    } catch {
      return null;
    }
  };

  $('link[href]').each((_, el) => {
    const node = $(el);
    const rel = (node.attr('rel') || '').toLowerCase();
    if (rel.includes('stylesheet') || rel.includes('icon')) {
      const rewritten = toReplayUrl(node.attr('href') || '');
      if (rewritten) node.attr('href', rewritten);
    }
  });

  $('img[src], img[data-src]').each((_, el) => {
    const node = $(el);
    const src = node.attr('src') || node.attr('data-src') || '';
    const rewritten = toReplayUrl(src);
    if (rewritten) {
      node.attr('src', rewritten);
      node.removeAttr('srcset');
      node.removeAttr('loading');
    }
  });

  $('style').each((_, el) => {
    const node = $(el);
    const css = node.text();
    if (css.includes('url(')) {
      node.text(rewriteCssForWarcReplay(css, baseUrl, archiveUid));
    }
  });

  $('[style]').each((_, el) => {
    const node = $(el);
    const inlineStyle = node.attr('style') || '';
    if (inlineStyle.includes('url(')) {
      node.attr('style', rewriteCssForWarcReplay(inlineStyle, baseUrl, archiveUid));
    }
  });

  return $.html();
}

export function rewriteCssForWarcReplay(css: string, baseUrl: string, archiveUid: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (full, _q, ref) => {
    const trimmed = String(ref).trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('#')) {
      return full;
    }
    try {
      const abs = new URL(trimmed, baseUrl).toString();
      return `url("/api/archives/${encodeURIComponent(archiveUid)}/warc-replay?url=${encodeURIComponent(abs)}")`;
    } catch {
      return full;
    }
  });
}
