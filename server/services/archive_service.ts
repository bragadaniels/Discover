import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ArchiveCaptureDetails,
  ArchiveChecksums,
  ArchiveFilePaths,
  ArchiveFileSizes,
  ArchiveFormat,
  ArchiveIntegrityResult,
  ArchiveJobStatus,
  ArchiveRecord,
  ArchiveRestoreConflict,
  ArchiveRestoreResponse,
  ArchiveStatus,
  ContentType,
  WarcRecordSummary,
} from '../../shared/types';
import {APP_CONFIG} from '../config';
import {captureWebPage, safeFetchResource} from '../core/archive_capture';
import {
  buildArchivesZipPackage,
  parseArchiveZipBundle,
  verifyArchiveIntegrity,
} from '../core/archive_export';
import {buildSelfContainedHtml} from '../core/archive_html';
import {generateArchivalPdf} from '../core/archive_pdf';
import {
  assertSafeExternalUrl,
  computeSha256,
  resolveSafeArchiveFilePath,
  type UrlValidationOptions,
} from '../core/archive_security';
import {
  buildWarc11Archive,
  extractWarcResource,
  inspectWarcFile,
  rewriteCssForWarcReplay,
  rewriteHtmlForWarcReplay,
  WARC_DOCUMENTED_LIMITATIONS,
} from '../core/archive_warc';
import {
  buildSearchMatchSegments,
  extractReadableTextFromHtml,
  removeArchiveFtsIndex,
  searchArchivesFts,
  syncArchiveFtsIndex,
  upsertArchiveExtractedText,
  type ArchiveFtsMatch,
} from '../core/fts_search';
import {canonicalizeUrl, extractDomain, sanitizePlainText} from '../core/normalizer';
import {getDb} from '../db/database';
import {getNotesMapForUrls} from './note_service';

interface ArchiveRow {
  id: number;
  archive_uid: string;
  version_number: number;
  parent_archive_uid: string | null;
  content_item_id: number | null;
  original_url: string;
  canonical_url: string;
  title: string;
  author: string | null;
  publisher: string | null;
  published_at: string | null;
  archived_at: string;
  content_type: ContentType;
  category_name: string | null;
  tag_names_json: string;
  doi: string | null;
  language: string | null;
  html_path: string | null;
  warc_path: string | null;
  pdf_path: string | null;
  metadata_path: string | null;
  thumbnail_path: string | null;
  file_sizes_json: string;
  checksums_json: string;
  status: ArchiveStatus;
  completeness: number;
  available_formats_json: string;
  capture_details_json: string;
}

export interface CreateArchiveRequest {
  contentItemId?: number | null;
  url?: string;
  title?: string;
  author?: string | null;
  publisher?: string | null;
  publishedAt?: string | null;
  contentType?: ContentType;
  categoryName?: string | null;
  tagNames?: string[];
  doi?: string | null;
  language?: string | null;
  formats?: ArchiveFormat[];
  parentArchiveUid?: string | null;
}

export interface ArchiveListQuery {
  search?: string;
  category?: string;
  tag?: string;
  format?: ArchiveFormat | 'all';
  status?: ArchiveStatus | 'all';
  dateRange?: 'all' | 'today' | '7d' | '30d';
  dateFrom?: string;
  dateTo?: string;
  hasNotes?: boolean;
  sort?: 'archived_desc' | 'archived_asc' | 'published_desc' | 'published_asc';
}

const activeJobs = new Map<string, ArchiveJobStatus>();

function getArchivesRoot(customRoot?: string): string {
  return path.resolve(customRoot || APP_CONFIG.archivesDir);
}

async function ensureArchiveDirectories(root: string): Promise<void> {
  await Promise.all([
    fs.mkdir(path.join(root, 'html'), {recursive: true}),
    fs.mkdir(path.join(root, 'warc'), {recursive: true}),
    fs.mkdir(path.join(root, 'pdf'), {recursive: true}),
    fs.mkdir(path.join(root, 'metadata'), {recursive: true}),
    fs.mkdir(path.join(root, 'thumbnails'), {recursive: true}),
  ]);
}

function generateArchiveUid(): string {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const rand = crypto.randomBytes(4).toString('hex');
  return `arc_${stamp}_${rand}`;
}

function safeParseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToArchiveRecord(row: ArchiveRow): ArchiveRecord {
  const filePaths: ArchiveFilePaths = {
    html: row.html_path,
    warc: row.warc_path,
    pdf: row.pdf_path,
    metadata: row.metadata_path,
    thumbnail: row.thumbnail_path,
  };
  return {
    id: row.id,
    archiveUid: row.archive_uid,
    versionNumber: row.version_number,
    parentArchiveUid: row.parent_archive_uid,
    contentItemId: row.content_item_id,
    originalUrl: row.original_url,
    canonicalUrl: row.canonical_url,
    title: row.title,
    author: row.author,
    publisher: row.publisher,
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    contentType: row.content_type,
    categoryName: row.category_name,
    tagNames: safeParseJson<string[]>(row.tag_names_json, []),
    doi: row.doi,
    language: row.language,
    filePaths,
    fileSizes: safeParseJson<ArchiveFileSizes>(row.file_sizes_json, {}),
    checksums: safeParseJson<ArchiveChecksums>(row.checksums_json, {}),
    status: row.status,
    completeness: row.completeness,
    availableFormats: safeParseJson<ArchiveFormat[]>(row.available_formats_json, []),
    thumbnailPath: row.thumbnail_path,
    captureDetails: safeParseJson<ArchiveCaptureDetails>(row.capture_details_json, {
      requestedFormats: [],
      generatedFormats: [],
      failedFormats: [],
      resourcesCaptured: 0,
      resourcesFailed: 0,
      warnings: [],
      limitations: [],
      captureMethod: 'none',
      httpStatus: null,
      mimeType: null,
      durationMs: 0,
    }),
  };
}

function resolveMetadataFromFeedItem(contentItemId: number): Partial<CreateArchiveRequest> | null {
  const db = getDb();
  const item = db
    .prepare(
      `SELECT id, title, content_type, original_url, canonical_url, doi, source_name,
              author, published_at, language
       FROM content_items WHERE id = ?`
    )
    .get(contentItemId) as
    | {
        id: number;
        title: string;
        content_type: ContentType;
        original_url: string;
        canonical_url: string;
        doi: string | null;
        source_name: string;
        author: string | null;
        published_at: string | null;
        language: string;
      }
    | undefined;

  if (!item) return null;

  const tagRows = db
    .prepare(
      `SELECT t.name AS tag_name, c.name AS category_name
       FROM content_tags ct
       JOIN tags t ON t.id = ct.tag_id
       JOIN categories c ON c.id = t.category_id
       WHERE ct.content_id = ?
       ORDER BY t.priority DESC`
    )
    .all(contentItemId) as Array<{tag_name: string; category_name: string}>;

  return {
    contentItemId: item.id,
    url: item.original_url,
    title: item.title,
    author: item.author,
    publisher: item.source_name,
    publishedAt: item.published_at,
    contentType: item.content_type,
    categoryName: tagRows[0]?.category_name || null,
    tagNames: Array.from(new Set(tagRows.map((r) => r.tag_name))),
    doi: item.doi,
    language: item.language,
  };
}

function normalizeRequestedFormats(raw?: ArchiveFormat[]): ArchiveFormat[] {
  const valid = (raw || []).filter((f): f is ArchiveFormat => f === 'html' || f === 'warc' || f === 'pdf');
  if (valid.length === 0) return ['html'];
  return Array.from(new Set(valid));
}

export function getArchiveJob(jobId: string): ArchiveJobStatus | null {
  return activeJobs.get(jobId) || null;
}

export function startArchiveJob(
  req: CreateArchiveRequest,
  options?: UrlValidationOptions & {archivesDir?: string}
): ArchiveJobStatus {
  const feedSeed = req.contentItemId ? resolveMetadataFromFeedItem(req.contentItemId) : null;
  if (req.contentItemId && !feedSeed && !req.url) {
    throw new Error('Referenced feed item not found');
  }

  const merged: CreateArchiveRequest = {
    ...feedSeed,
    ...req,
    url: req.url || feedSeed?.url,
    title: req.title || feedSeed?.title || req.url || 'Archived Web Page',
    formats: normalizeRequestedFormats(req.formats),
  };

  if (!merged.url) {
    throw new Error('A valid target URL is required for archiving');
  }

  const jobId = `job_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const job: ArchiveJobStatus = {
    jobId,
    url: merged.url,
    title: merged.title || merged.url,
    requestedFormats: merged.formats || ['html'],
    stage: 'queued',
    progress: 5,
    message: 'Queued archival capture…',
    archive: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
  activeJobs.set(jobId, job);

  // Prune old completed jobs above 50 entries
  if (activeJobs.size > 50) {
    const oldestKey = activeJobs.keys().next().value;
    if (oldestKey && oldestKey !== jobId) activeJobs.delete(oldestKey);
  }

  void executeArchiveCapture(merged, {
    ...options,
    onStage: (stage, progress, message) => {
      const current = activeJobs.get(jobId);
      if (current) {
        current.stage = stage;
        current.progress = progress;
        current.message = message;
      }
    },
  })
    .then((archive) => {
      const current = activeJobs.get(jobId);
      if (current) {
        current.stage = archive.status === 'failed' ? 'failed' : 'completed';
        current.progress = 100;
        current.archive = archive;
        current.error = archive.captureDetails.error || null;
        current.finishedAt = new Date().toISOString();
        current.message =
          archive.status === 'complete'
            ? 'Archived successfully.'
            : archive.status === 'failed'
              ? archive.captureDetails.error || 'Archival failed.'
              : `Archived (${archive.status.replace('_', '-')}, ${archive.completeness}% completeness).`;
      }
    })
    .catch((err) => {
      const current = activeJobs.get(jobId);
      if (current) {
        current.stage = 'failed';
        current.progress = 100;
        current.error = err instanceof Error ? err.message : 'Archival failed';
        current.message = current.error;
        current.finishedAt = new Date().toISOString();
      }
    });

  return job;
}

export async function executeArchiveCapture(
  req: CreateArchiveRequest,
  options?: UrlValidationOptions & {
    archivesDir?: string;
    onStage?: (stage: ArchiveJobStatus['stage'], progress: number, message: string) => void;
  }
): Promise<ArchiveRecord> {
  const startedMs = Date.now();
  const db = getDb();
  const root = getArchivesRoot(options?.archivesDir);
  await ensureArchiveDirectories(root);

  const feedSeed = req.contentItemId ? resolveMetadataFromFeedItem(req.contentItemId) : null;
  const originalUrl = (req.url || feedSeed?.url || '').trim();
  const requestedFormats = normalizeRequestedFormats(req.formats);

  options?.onStage?.('validating', 12, 'Validating URL and security policy…');
  await assertSafeExternalUrl(originalUrl, options);

  const canonical = canonicalizeUrl(originalUrl);
  const archiveUid = generateArchiveUid();
  const archivedAt = new Date().toISOString();

  // Compute version number cleanly (never overwrite previous archives for the same URL)
  const existingMax = db
    .prepare(
      `SELECT MAX(version_number) AS max_ver,
              (SELECT archive_uid FROM archives WHERE canonical_url = ? ORDER BY version_number DESC LIMIT 1) AS latest_uid
       FROM archives WHERE canonical_url = ?`
    )
    .get(canonical, canonical) as {max_ver: number | null; latest_uid: string | null} | undefined;

  const versionNumber = (existingMax?.max_ver || 0) + 1;
  const parentArchiveUid = req.parentArchiveUid ?? existingMax?.latest_uid ?? null;

  const initialTitle = sanitizePlainText(req.title || feedSeed?.title || originalUrl, 280) || originalUrl;
  const contentType: ContentType = req.contentType || feedSeed?.contentType || 'news';
  const publisher = sanitizePlainText(req.publisher || feedSeed?.publisher || extractDomain(canonical), 120) || extractDomain(canonical);
  let author = req.author ?? feedSeed?.author ?? null;
  let publishedAt = req.publishedAt ?? feedSeed?.publishedAt ?? null;
  let language = req.language ?? feedSeed?.language ?? 'en';
  const doi = req.doi ?? feedSeed?.doi ?? null;
  const categoryName = req.categoryName ?? feedSeed?.categoryName ?? null;
  const tagNames = Array.from(
    new Set([...(feedSeed?.tagNames || []), ...(req.tagNames || [])].map((t) => t.trim()).filter(Boolean))
  );

  const filePaths: ArchiveFilePaths = {};
  const fileSizes: ArchiveFileSizes = {};
  const checksums: ArchiveChecksums = {};
  const generatedFormats: ArchiveFormat[] = [];
  const failedFormats: Array<{format: ArchiveFormat; reason: string}> = [];
  const warnings: string[] = [];
  const limitations: string[] = [];

  try {
    const capture = await captureWebPage(originalUrl, {
      allowLoopbackForTest: options?.allowLoopbackForTest,
      onProgress: (stage, message) => {
        options?.onStage?.(stage, stage === 'fetching_page' ? 28 : 46, message);
      },
    });

    warnings.push(...capture.warnings);
    limitations.push(...capture.limitations);

    // Save thumbnail if available
    if (capture.thumbnailBuffer && capture.thumbnailBuffer.length > 0) {
      const thumbRel = path.posix.join('thumbnails', `${archiveUid}.jpg`);
      const thumbAbs = resolveSafeArchiveFilePath(root, thumbRel);
      await fs.writeFile(thumbAbs, capture.thumbnailBuffer);
      filePaths.thumbnail = thumbRel;
      fileSizes.thumbnail = capture.thumbnailBuffer.length;
      checksums.thumbnail = computeSha256(capture.thumbnailBuffer);
    }

    // Build self-contained HTML (also used as clean offline source for PDF if HTML or PDF requested)
    let htmlContentForPdf: string | null = null;
    let htmlResourcesCaptured = 0;
    let htmlResourcesFailed = 0;
    let htmlStatusSuggestion: Exclude<ArchiveStatus, 'failed'> = 'complete';
    let htmlCompleteness = 100;
    let resolvedTitle = initialTitle;

    if (requestedFormats.includes('html') || requestedFormats.includes('pdf')) {
      options?.onStage?.('generating_html', 62, 'Inlining CSS, fonts, and images into self-contained HTML…');
      try {
        const htmlResult = await buildSelfContainedHtml({
          rawHtml: capture.rawHtml,
          pageUrl: capture.finalUrl,
          metadata: {
            archiveUid,
            title: initialTitle,
            originalUrl,
            canonicalUrl: canonical,
            archivedAt,
            publishedAt,
            author,
            publisher,
            doi,
            language,
          },
          capturedResources: capture.capturedResources,
          extraCapturedCssText: capture.extraCssText,
          fetchResource: (resUrl) =>
            safeFetchResource(resUrl, {allowLoopbackForTest: options?.allowLoopbackForTest}),
          maxResourceBytes: APP_CONFIG.maxArchiveResourceBytes,
          maxTotalBytes: APP_CONFIG.maxArchiveTotalBytes,
        });

        htmlContentForPdf = htmlResult.html;
        htmlResourcesCaptured = htmlResult.resourcesCaptured;
        htmlResourcesFailed = htmlResult.resourcesFailed;
        htmlStatusSuggestion = htmlResult.statusSuggestion;
        htmlCompleteness = htmlResult.completeness;
        warnings.push(...htmlResult.warnings);

        if ((!req.title || req.title === originalUrl) && htmlResult.extractedMeta.title) {
          resolvedTitle = sanitizePlainText(htmlResult.extractedMeta.title, 280) || initialTitle;
        }
        if (!author && htmlResult.extractedMeta.author) {
          author = sanitizePlainText(htmlResult.extractedMeta.author, 160);
        }
        if (!publishedAt && htmlResult.extractedMeta.publishedAt) {
          publishedAt = htmlResult.extractedMeta.publishedAt;
        }
        if (!req.language && htmlResult.extractedMeta.language) {
          language = htmlResult.extractedMeta.language;
        }

        if (requestedFormats.includes('html')) {
          const htmlRel = path.posix.join('html', `${archiveUid}.html`);
          const htmlAbs = resolveSafeArchiveFilePath(root, htmlRel);
          const buf = Buffer.from(htmlResult.html, 'utf8');
          await fs.writeFile(htmlAbs, buf);
          filePaths.html = htmlRel;
          fileSizes.html = buf.length;
          checksums.html = computeSha256(buf);
          generatedFormats.push('html');
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'HTML packaging failed';
        if (requestedFormats.includes('html')) {
          failedFormats.push({format: 'html', reason});
        }
        warnings.push(`HTML generation warning: ${reason}`);
      }
    }

    // Generate WARC 1.1
    if (requestedFormats.includes('warc')) {
      options?.onStage?.('generating_warc', 76, 'Writing WARC 1.1 (.warc.gz) HTTP archive…');
      try {
        const warcResult = await buildWarc11Archive({
          archiveUid,
          targetUrl: capture.finalUrl,
          title: resolvedTitle,
          archivedAt,
          exchanges: capture.exchanges,
          limitations: [...WARC_DOCUMENTED_LIMITATIONS, ...limitations],
        });
        const warcRel = path.posix.join('warc', `${archiveUid}.warc.gz`);
        const warcAbs = resolveSafeArchiveFilePath(root, warcRel);
        await fs.writeFile(warcAbs, warcResult.buffer);
        filePaths.warc = warcRel;
        fileSizes.warc = warcResult.buffer.length;
        checksums.warc = computeSha256(warcResult.buffer);
        generatedFormats.push('warc');
        if (!limitations.some((l) => l.includes('WARC'))) {
          limitations.push(...WARC_DOCUMENTED_LIMITATIONS);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'WARC generation failed';
        failedFormats.push({format: 'warc', reason});
        warnings.push(`WARC generation failed: ${reason}`);
      }
    }

    // Generate PDF
    if (requestedFormats.includes('pdf')) {
      options?.onStage?.('generating_pdf', 88, 'Rendering multi-page archival PDF document…');
      try {
        const pdfBytes = await generateArchivalPdf({
          selfContainedHtml: htmlContentForPdf || capture.rawHtml,
          title: resolvedTitle,
          originalUrl,
          publishedAt,
          archivedAt,
          author,
          publisher,
        });
        const pdfRel = path.posix.join('pdf', `${archiveUid}.pdf`);
        const pdfAbs = resolveSafeArchiveFilePath(root, pdfRel);
        await fs.writeFile(pdfAbs, pdfBytes);
        filePaths.pdf = pdfRel;
        fileSizes.pdf = pdfBytes.length;
        checksums.pdf = computeSha256(pdfBytes);
        generatedFormats.push('pdf');
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'PDF generation failed';
        failedFormats.push({format: 'pdf', reason});
        warnings.push(`PDF generation failed: ${reason}`);
      }
    }

    // Determine honest capture status & completeness
    let finalStatus: ArchiveStatus = 'complete';
    let finalCompleteness = htmlCompleteness;

    if (generatedFormats.length === 0) {
      finalStatus = 'failed';
      finalCompleteness = 0;
    } else if (
      failedFormats.length > 0 ||
      (capture.httpStatus !== null && capture.httpStatus >= 400) ||
      capture.captureMethod === 'fetch_fallback' ||
      limitations.some((l) => l.includes('HTTP 40') || l.includes('sign-in'))
    ) {
      if (htmlStatusSuggestion === 'text_only' && !generatedFormats.includes('warc')) {
        finalStatus = 'text_only';
      } else {
        finalStatus = 'partial';
      }
      const formatFactor = generatedFormats.length / requestedFormats.length;
      finalCompleteness = Math.max(20, Math.min(89, Math.round(htmlCompleteness * formatFactor)));
    } else if (htmlStatusSuggestion !== 'complete') {
      finalStatus = htmlStatusSuggestion;
      finalCompleteness = Math.min(89, htmlCompleteness);
    }

    options?.onStage?.('saving_metadata', 95, 'Writing metadata manifest and SHA-256 checksums…');

    const captureDetails: ArchiveCaptureDetails = {
      requestedFormats,
      generatedFormats,
      failedFormats,
      resourcesCaptured: htmlResourcesCaptured || capture.capturedResources.size,
      resourcesFailed: htmlResourcesFailed,
      warnings: Array.from(new Set(warnings)),
      limitations: Array.from(new Set(limitations)),
      captureMethod: capture.captureMethod,
      httpStatus: capture.httpStatus,
      mimeType: capture.mimeType,
      durationMs: Date.now() - startedMs,
      error: finalStatus === 'failed' ? failedFormats[0]?.reason || 'All requested formats failed' : null,
    };

    const metaRel = path.posix.join('metadata', `${archiveUid}.json`);
    filePaths.metadata = metaRel;

    // Insert row first to obtain integer id, then write metadata/<uid>.json with full record & checksum
    const insertRes = db
      .prepare(
        `INSERT INTO archives (
          archive_uid, version_number, parent_archive_uid, content_item_id,
          original_url, canonical_url, title, author, publisher, published_at, archived_at,
          content_type, category_name, tag_names_json, doi, language,
          html_path, warc_path, pdf_path, metadata_path, thumbnail_path,
          file_sizes_json, checksums_json, status, completeness,
          available_formats_json, capture_details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        archiveUid,
        versionNumber,
        parentArchiveUid,
        req.contentItemId ?? null,
        originalUrl,
        canonical,
        resolvedTitle,
        author,
        publisher,
        publishedAt,
        archivedAt,
        contentType,
        categoryName,
        JSON.stringify(tagNames),
        doi,
        language,
        filePaths.html || null,
        filePaths.warc || null,
        filePaths.pdf || null,
        metaRel,
        filePaths.thumbnail || null,
        JSON.stringify(fileSizes),
        JSON.stringify(checksums),
        finalStatus,
        finalCompleteness,
        JSON.stringify(generatedFormats),
        JSON.stringify(captureDetails)
      );

    const recordId = Number(insertRes.lastInsertRowid);
    const createdRow = db.prepare('SELECT * FROM archives WHERE id = ?').get(recordId) as unknown as ArchiveRow;
    const record = rowToArchiveRecord(createdRow);

    const metaBuf = Buffer.from(JSON.stringify(record, null, 2), 'utf8');
    await fs.writeFile(resolveSafeArchiveFilePath(root, metaRel), metaBuf);
    fileSizes.metadata = metaBuf.length;
    checksums.metadata = computeSha256(metaBuf);

    db.prepare('UPDATE archives SET file_sizes_json = ?, checksums_json = ? WHERE id = ?').run(
      JSON.stringify(fileSizes),
      JSON.stringify(checksums),
      recordId
    );
    record.fileSizes = fileSizes;
    record.checksums = checksums;

    const textSourceHtml = htmlContentForPdf || capture.rawHtml || '';
    if (textSourceHtml) {
      const extractedText = extractReadableTextFromHtml(textSourceHtml);
      upsertArchiveExtractedText(db, archiveUid, extractedText);
    }
    syncArchiveFtsIndex(db, archiveUid);

    return record;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Archival failed';
    const captureDetails: ArchiveCaptureDetails = {
      requestedFormats,
      generatedFormats: [],
      failedFormats: requestedFormats.map((f) => ({format: f, reason: errMsg})),
      resourcesCaptured: 0,
      resourcesFailed: 0,
      warnings: Array.from(new Set(warnings)),
      limitations: Array.from(new Set(limitations)),
      captureMethod: 'none',
      httpStatus: null,
      mimeType: null,
      durationMs: Date.now() - startedMs,
      error: errMsg,
    };

    const metaRel = path.posix.join('metadata', `${archiveUid}.json`);
    const insertRes = db
      .prepare(
        `INSERT INTO archives (
          archive_uid, version_number, parent_archive_uid, content_item_id,
          original_url, canonical_url, title, author, publisher, published_at, archived_at,
          content_type, category_name, tag_names_json, doi, language,
          html_path, warc_path, pdf_path, metadata_path, thumbnail_path,
          file_sizes_json, checksums_json, status, completeness,
          available_formats_json, capture_details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, '{}', '{}', 'failed', 0, '[]', ?)`
      )
      .run(
        archiveUid,
        versionNumber,
        parentArchiveUid,
        req.contentItemId ?? null,
        originalUrl,
        canonical,
        initialTitle,
        author,
        publisher,
        publishedAt,
        archivedAt,
        contentType,
        categoryName,
        JSON.stringify(tagNames),
        doi,
        language,
        metaRel,
        JSON.stringify(captureDetails)
      );

    const recordId = Number(insertRes.lastInsertRowid);
    const failedRow = db.prepare('SELECT * FROM archives WHERE id = ?').get(recordId) as unknown as ArchiveRow;
    const failedRecord = rowToArchiveRecord(failedRow);
    const metaBuf = Buffer.from(JSON.stringify(failedRecord, null, 2), 'utf8');
    await fs.writeFile(resolveSafeArchiveFilePath(root, metaRel), metaBuf);
    return failedRecord;
  }
}

export function listArchives(query: ArchiveListQuery = {}): {
  archives: ArchiveRecord[];
  total: number;
  categories: string[];
  tags: string[];
  totalDiskBytes: number;
} {
  const db = getDb();
  const where: string[] = [];
  const args: Array<string | number> = [];

  const rawSearch = query.search ? query.search.trim() : '';
  const searchLower = rawSearch.toLowerCase();
  const ftsMatches = rawSearch
    ? searchArchivesFts(db, rawSearch, 600)
    : new Map<string, ArchiveFtsMatch>();

  if (rawSearch) {
    const like = `%${searchLower}%`;
    const ftsUids = Array.from(ftsMatches.keys());
    const ftsOr =
      ftsUids.length > 0 ? `archive_uid IN (${ftsUids.map(() => '?').join(',')}) OR ` : '';
    where.push(`(${ftsOr}
      LOWER(title) LIKE ? OR
      LOWER(COALESCE(author, '')) LIKE ? OR
      LOWER(COALESCE(publisher, '')) LIKE ? OR
      LOWER(original_url) LIKE ? OR
      LOWER(canonical_url) LIKE ? OR
      LOWER(tag_names_json) LIKE ? OR
      EXISTS (
        SELECT 1 FROM item_notes n
        WHERE (n.canonical_url = archives.canonical_url OR n.archive_uid = archives.archive_uid)
          AND LOWER(n.note_text) LIKE ?
      ) OR
      EXISTS (
        SELECT 1 FROM archive_fulltext af
        WHERE af.archive_uid = archives.archive_uid AND LOWER(af.extracted_text) LIKE ?
      )
    )`);
    if (ftsUids.length > 0) {
      args.push(...ftsUids);
    }
    args.push(like, like, like, like, like, like, like, like);
  }

  if (query.category && query.category !== 'all') {
    where.push('LOWER(COALESCE(category_name, "")) = ?');
    args.push(query.category.toLowerCase());
  }

  if (query.tag && query.tag !== 'all') {
    where.push('LOWER(tag_names_json) LIKE ?');
    args.push(`%"${query.tag.toLowerCase()}"%`);
  }

  if (query.format && query.format !== 'all') {
    where.push('available_formats_json LIKE ?');
    args.push(`%"${query.format}"%`);
  }

  if (query.status && query.status !== 'all') {
    where.push('status = ?');
    args.push(query.status);
  }

  if (query.hasNotes) {
    where.push(`EXISTS (
      SELECT 1 FROM item_notes n
      WHERE n.canonical_url = archives.canonical_url OR n.archive_uid = archives.archive_uid
    )`);
  }

  if (query.dateRange && query.dateRange !== 'all') {
    const now = new Date();
    let cutoff: Date;
    if (query.dateRange === 'today') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    } else if (query.dateRange === '7d') {
      cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
    where.push('archived_at >= ?');
    args.push(cutoff.toISOString());
  }

  if (query.dateFrom) {
    where.push('archived_at >= ?');
    args.push(query.dateFrom);
  }
  if (query.dateTo) {
    where.push('archived_at <= ?');
    args.push(`${query.dateTo}T23:59:59.999Z`);
  }

  const orderBy =
    query.sort === 'archived_asc'
      ? 'archived_at ASC, id ASC'
      : query.sort === 'published_desc'
        ? 'COALESCE(published_at, archived_at) DESC, id DESC'
        : query.sort === 'published_asc'
          ? 'COALESCE(published_at, archived_at) ASC, id ASC'
          : 'archived_at DESC, id DESC';

  const sql = `SELECT * FROM archives ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${orderBy}`;
  const rows = db.prepare(sql).all(...args) as unknown as ArchiveRow[];
  const archives = rows.map(rowToArchiveRecord);

  const notesMap = getNotesMapForUrls(archives.map((a) => a.canonicalUrl));
  for (const arc of archives) {
    const noteEntry = notesMap.get(arc.canonicalUrl);
    arc.note = noteEntry?.noteText ?? null;
    arc.noteUpdatedAt = noteEntry?.updatedAt ?? null;

    if (rawSearch) {
      const ftsPreview = ftsMatches.get(arc.archiveUid)?.preview;
      if (ftsPreview && ftsPreview.segments.some((s) => s.match)) {
        arc.searchMatch = ftsPreview;
      } else if (noteEntry && noteEntry.noteText.toLowerCase().includes(searchLower)) {
        arc.searchMatch = {
          source: 'note',
          segments: buildSearchMatchSegments(noteEntry.noteText, rawSearch),
        };
      } else {
        const metaText = [arc.title, arc.author, arc.publisher, arc.originalUrl]
          .filter(Boolean)
          .join(' — ');
        arc.searchMatch = {
          source: 'metadata',
          segments: buildSearchMatchSegments(metaText, rawSearch),
        };
      }
    }
  }

  if (rawSearch && !query.sort) {
    archives.sort((a, b) => {
      const rankA = ftsMatches.get(a.archiveUid)?.rank ?? 999;
      const rankB = ftsMatches.get(b.archiveUid)?.rank ?? 999;
      return rankA - rankB;
    });
  }

  // Facets & disk size across all stored archives
  const allRows = db
    .prepare('SELECT category_name, tag_names_json, file_sizes_json FROM archives')
    .all() as Array<{category_name: string | null; tag_names_json: string; file_sizes_json: string}>;

  const catSet = new Set<string>();
  const tagSet = new Set<string>();
  let totalDiskBytes = 0;

  for (const r of allRows) {
    if (r.category_name) catSet.add(r.category_name);
    for (const t of safeParseJson<string[]>(r.tag_names_json, [])) {
      if (t) tagSet.add(t);
    }
    const sizes = safeParseJson<ArchiveFileSizes>(r.file_sizes_json, {});
    for (const val of Object.values(sizes)) {
      if (typeof val === 'number') totalDiskBytes += val;
    }
  }

  return {
    archives,
    total: archives.length,
    categories: Array.from(catSet).sort(),
    tags: Array.from(tagSet).sort(),
    totalDiskBytes,
  };
}

export function getArchiveByUid(archiveUid: string): ArchiveRecord | null {
  const db = getDb();
  const row = db
    .prepare('SELECT * FROM archives WHERE archive_uid = ?')
    .get(archiveUid) as unknown as ArchiveRow | undefined;
  if (!row) return null;
  const record = rowToArchiveRecord(row);
  const notesMap = getNotesMapForUrls([record.canonicalUrl]);
  const noteEntry = notesMap.get(record.canonicalUrl);
  record.note = noteEntry?.noteText ?? null;
  record.noteUpdatedAt = noteEntry?.updatedAt ?? null;
  return record;
}

export function getArchivedItemMap(): Record<number, {archiveUid: string; formats: ArchiveFormat[]; status: ArchiveStatus}> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT content_item_id, archive_uid, available_formats_json, status
       FROM archives
       WHERE content_item_id IS NOT NULL
       ORDER BY version_number ASC, archived_at ASC`
    )
    .all() as Array<{
    content_item_id: number;
    archive_uid: string;
    available_formats_json: string;
    status: ArchiveStatus;
  }>;
  const map: Record<number, {archiveUid: string; formats: ArchiveFormat[]; status: ArchiveStatus}> = {};
  for (const r of rows) {
    map[r.content_item_id] = {
      archiveUid: r.archive_uid,
      formats: safeParseJson<ArchiveFormat[]>(r.available_formats_json, []),
      status: r.status,
    };
  }
  return map;
}

export async function readArchiveFileBuffer(
  archiveUid: string,
  kind: 'html' | 'warc' | 'pdf' | 'thumbnail' | 'metadata',
  archivesDir?: string
): Promise<{archive: ArchiveRecord; buffer: Buffer; fullPath: string} | null> {
  const archive = getArchiveByUid(archiveUid);
  if (!archive) return null;
  const relPath = archive.filePaths[kind];
  if (!relPath) return null;
  const root = getArchivesRoot(archivesDir);
  const fullPath = resolveSafeArchiveFilePath(root, relPath);
  const buffer = await fs.readFile(fullPath);
  return {archive, buffer, fullPath};
}

export async function inspectArchiveWarc(
  archiveUid: string,
  archivesDir?: string
): Promise<{
  archive: ArchiveRecord;
  records: WarcRecordSummary[];
  limitations: string[];
}> {
  const archive = getArchiveByUid(archiveUid);
  if (!archive || !archive.filePaths.warc) {
    throw new Error('WARC archive file not found for this entry');
  }
  const root = getArchivesRoot(archivesDir);
  const fullPath = resolveSafeArchiveFilePath(root, archive.filePaths.warc);
  const records = await inspectWarcFile(fullPath);
  const limitations = Array.from(
    new Set([...WARC_DOCUMENTED_LIMITATIONS, ...(archive.captureDetails.limitations || [])])
  );
  return {archive, records, limitations};
}

export async function replayArchiveWarcResource(
  archiveUid: string,
  requestedUrl?: string | null,
  archivesDir?: string
): Promise<{
  targetUri: string;
  status: number;
  contentType: string;
  body: Buffer;
} | null> {
  const found = await readArchiveFileBuffer(archiveUid, 'warc', archivesDir);
  if (!found) return null;
  const resource = await extractWarcResource(found.buffer, requestedUrl);
  if (!resource) return null;

  const mime = resource.contentType.split(';')[0].trim().toLowerCase();
  if (mime === 'text/html' || mime === 'application/xhtml+xml') {
    const rewritten = rewriteHtmlForWarcReplay(
      resource.body.toString('utf8'),
      resource.targetUri || found.archive.originalUrl,
      archiveUid
    );
    return {
      targetUri: resource.targetUri,
      status: resource.status,
      contentType: 'text/html; charset=utf-8',
      body: Buffer.from(rewritten, 'utf8'),
    };
  }
  if (mime === 'text/css') {
    const rewrittenCss = rewriteCssForWarcReplay(
      resource.body.toString('utf8'),
      resource.targetUri || found.archive.originalUrl,
      archiveUid
    );
    return {
      targetUri: resource.targetUri,
      status: resource.status,
      contentType: 'text/css; charset=utf-8',
      body: Buffer.from(rewrittenCss, 'utf8'),
    };
  }
  return {
    targetUri: resource.targetUri,
    status: resource.status,
    contentType: resource.contentType,
    body: resource.body,
  };
}

export async function checkArchiveIntegrity(
  archiveUid: string,
  archivesDir?: string
): Promise<ArchiveIntegrityResult> {
  const archive = getArchiveByUid(archiveUid);
  if (!archive) {
    throw new Error('Archive not found');
  }
  return verifyArchiveIntegrity(archive, getArchivesRoot(archivesDir));
}

export async function exportSingleArchiveZip(
  archiveUid: string,
  archivesDir?: string
): Promise<{filename: string; buffer: Buffer}> {
  const archive = getArchiveByUid(archiveUid);
  if (!archive) {
    throw new Error('Archive not found');
  }
  const {zipBuffer} = await buildArchivesZipPackage([archive], getArchivesRoot(archivesDir));
  return {
    filename: `${archive.archiveUid}.zip`,
    buffer: zipBuffer,
  };
}

export async function exportAllArchivesZip(archivesDir?: string): Promise<{
  filename: string;
  buffer: Buffer;
  count: number;
}> {
  const {archives} = listArchives();
  const {zipBuffer} = await buildArchivesZipPackage(archives, getArchivesRoot(archivesDir));
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    filename: `discover-archives-backup-${stamp}.zip`,
    buffer: zipBuffer,
    count: archives.length,
  };
}

export async function restoreArchivesFromZip(
  zipBuffer: Buffer,
  options?: {overwriteConfirmed?: boolean; archivesDir?: string}
): Promise<ArchiveRestoreResponse> {
  const db = getDb();
  const root = getArchivesRoot(options?.archivesDir);
  await ensureArchiveDirectories(root);

  const bundle = await parseArchiveZipBundle(zipBuffer);

  // Check for existing archives with matching archiveUid — NEVER overwrite silently
  const conflicts: ArchiveRestoreConflict[] = [];
  for (const candidate of bundle.archives) {
    const existing = getArchiveByUid(candidate.archiveUid);
    if (existing) {
      conflicts.push({
        archiveUid: existing.archiveUid,
        title: existing.title,
        archivedAt: existing.archivedAt,
      });
    }
  }

  if (conflicts.length > 0 && !options?.overwriteConfirmed) {
    return {
      restored: 0,
      skipped: conflicts.length,
      overwritten: 0,
      conflicts,
      requiresConfirmation: true,
      warnings: bundle.warnings,
    };
  }

  let restored = 0;
  let overwritten = 0;

  for (const a of bundle.archives) {
    const existed = Boolean(getArchiveByUid(a.archiveUid));

    const writeRelIfPresent = async (rel: string | null | undefined): Promise<string | null> => {
      if (!rel) return null;
      const normalized = rel.replace(/\\/g, '/').replace(/^\/+/, '');
      const buf = bundle.filesByRelPath.get(normalized);
      if (!buf) return null;
      const abs = resolveSafeArchiveFilePath(root, normalized);
      await fs.mkdir(path.dirname(abs), {recursive: true});
      await fs.writeFile(abs, buf);
      return normalized;
    };

    const htmlPath = await writeRelIfPresent(a.filePaths.html);
    const warcPath = await writeRelIfPresent(a.filePaths.warc);
    const pdfPath = await writeRelIfPresent(a.filePaths.pdf);
    const thumbPath = await writeRelIfPresent(a.filePaths.thumbnail);
    const restoredMetaPath = await writeRelIfPresent(a.filePaths.metadata);
    const metaRel = restoredMetaPath || a.filePaths.metadata || path.posix.join('metadata', `${a.archiveUid}.json`);
    if (!restoredMetaPath) {
      const metaAbs = resolveSafeArchiveFilePath(root, metaRel);
      await fs.writeFile(metaAbs, JSON.stringify(a, null, 2), 'utf8');
    }

    // Keep content_item_id only if that content_item still exists in DB; otherwise NULL
    const validContentItemId =
      a.contentItemId &&
      db.prepare('SELECT id FROM content_items WHERE id = ?').get(a.contentItemId)
        ? a.contentItemId
        : null;

    if (existed) {
      db.prepare(
        `UPDATE archives SET
          version_number = ?, parent_archive_uid = ?, content_item_id = ?,
          original_url = ?, canonical_url = ?, title = ?, author = ?, publisher = ?,
          published_at = ?, archived_at = ?, content_type = ?, category_name = ?,
          tag_names_json = ?, doi = ?, language = ?, html_path = ?, warc_path = ?,
          pdf_path = ?, metadata_path = ?, thumbnail_path = ?, file_sizes_json = ?,
          checksums_json = ?, status = ?, completeness = ?, available_formats_json = ?,
          capture_details_json = ?
         WHERE archive_uid = ?`
      ).run(
        a.versionNumber || 1,
        a.parentArchiveUid || null,
        validContentItemId,
        a.originalUrl,
        a.canonicalUrl || canonicalizeUrl(a.originalUrl),
        a.title,
        a.author || null,
        a.publisher || null,
        a.publishedAt || null,
        a.archivedAt || new Date().toISOString(),
        a.contentType || 'news',
        a.categoryName || null,
        JSON.stringify(a.tagNames || []),
        a.doi || null,
        a.language || 'en',
        htmlPath,
        warcPath,
        pdfPath,
        metaRel,
        thumbPath,
        JSON.stringify(a.fileSizes || {}),
        JSON.stringify(a.checksums || {}),
        a.status || 'complete',
        a.completeness ?? 100,
        JSON.stringify(a.availableFormats || []),
        JSON.stringify(a.captureDetails || {}),
        a.archiveUid
      );
      overwritten++;
    } else {
      db.prepare(
        `INSERT INTO archives (
          archive_uid, version_number, parent_archive_uid, content_item_id,
          original_url, canonical_url, title, author, publisher, published_at, archived_at,
          content_type, category_name, tag_names_json, doi, language,
          html_path, warc_path, pdf_path, metadata_path, thumbnail_path,
          file_sizes_json, checksums_json, status, completeness,
          available_formats_json, capture_details_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        a.archiveUid,
        a.versionNumber || 1,
        a.parentArchiveUid || null,
        validContentItemId,
        a.originalUrl,
        a.canonicalUrl || canonicalizeUrl(a.originalUrl),
        a.title,
        a.author || null,
        a.publisher || null,
        a.publishedAt || null,
        a.archivedAt || new Date().toISOString(),
        a.contentType || 'news',
        a.categoryName || null,
        JSON.stringify(a.tagNames || []),
        a.doi || null,
        a.language || 'en',
        htmlPath,
        warcPath,
        pdfPath,
        metaRel,
        thumbPath,
        JSON.stringify(a.fileSizes || {}),
        JSON.stringify(a.checksums || {}),
        a.status || 'complete',
        a.completeness ?? 100,
        JSON.stringify(a.availableFormats || []),
        JSON.stringify(a.captureDetails || {})
      );
      restored++;
    }

    if (htmlPath) {
      const htmlBuf = bundle.filesByRelPath.get(htmlPath);
      if (htmlBuf) {
        upsertArchiveExtractedText(db, a.archiveUid, extractReadableTextFromHtml(htmlBuf.toString('utf8')));
      }
    }
    syncArchiveFtsIndex(db, a.archiveUid);
  }

  return {
    restored,
    skipped: 0,
    overwritten,
    conflicts: [],
    requiresConfirmation: false,
    warnings: bundle.warnings,
  };
}

export async function deleteArchiveByUid(archiveUid: string, archivesDir?: string): Promise<boolean> {
  const archive = getArchiveByUid(archiveUid);
  if (!archive) return false;
  const root = getArchivesRoot(archivesDir);

  const filePaths = [
    archive.filePaths.html,
    archive.filePaths.warc,
    archive.filePaths.pdf,
    archive.filePaths.metadata,
    archive.filePaths.thumbnail,
  ];
  for (const rel of filePaths) {
    if (!rel) continue;
    try {
      const abs = resolveSafeArchiveFilePath(root, rel);
      await fs.rm(abs, {force: true});
    } catch {
      // Ignore already missing files
    }
  }

  const db = getDb();
  db.prepare('DELETE FROM archives WHERE archive_uid = ?').run(archiveUid);
  removeArchiveFtsIndex(db, archiveUid);
  return true;
}
