import express, {Router, type Request} from 'express';
import type {ArchiveFormat, ArchiveStatus} from '../../shared/types';
import {
  buildArchiveCspHeader,
  buildWarcReplayCspHeader,
  sanitizeArchivedHtml,
  validateExternalArchiveUrl,
} from '../core/archive_security';
import {
  checkArchiveIntegrity,
  deleteArchiveByUid,
  exportAllArchivesZip,
  exportSingleArchiveZip,
  getArchiveByUid,
  getArchiveJob,
  getArchivedItemMap,
  inspectArchiveWarc,
  listArchives,
  readArchiveFileBuffer,
  replayArchiveWarcResource,
  restoreArchivesFromZip,
  startArchiveJob,
  type ArchiveListQuery,
} from '../services/archive_service';

export const archivesRouter = Router();

function getRequestOrigin(req: Request): string {
  const host = req.get('host');
  if (!host) return '';
  const proto = req.protocol || 'http';
  return `${proto}://${host}`;
}

function parseFormats(raw: unknown): ArchiveFormat[] {
  if (!Array.isArray(raw)) return ['html'];
  const valid = raw.filter((f): f is ArchiveFormat => f === 'html' || f === 'warc' || f === 'pdf');
  return valid.length > 0 ? Array.from(new Set(valid)) : ['html'];
}

function validateSafeUid(uid: string): boolean {
  return /^[a-zA-Z0-9_-]{4,80}$/.test(uid);
}

// List archives with search, filters, sorting, and facets
archivesRouter.get('/archives', (req, res) => {
  try {
    const q = req.query;
    const query: ArchiveListQuery = {
      search: typeof q.search === 'string' ? q.search : undefined,
      category: typeof q.category === 'string' ? q.category : undefined,
      tag: typeof q.tag === 'string' ? q.tag : undefined,
      format:
        typeof q.format === 'string' && ['all', 'html', 'warc', 'pdf'].includes(q.format)
          ? (q.format as ArchiveFormat | 'all')
          : 'all',
      status:
        typeof q.status === 'string' &&
        ['all', 'complete', 'partial', 'text_only', 'failed'].includes(q.status)
          ? (q.status as ArchiveStatus | 'all')
          : 'all',
      dateRange:
        typeof q.dateRange === 'string' && ['all', 'today', '7d', '30d'].includes(q.dateRange)
          ? (q.dateRange as ArchiveListQuery['dateRange'])
          : 'all',
      dateFrom: typeof q.dateFrom === 'string' && q.dateFrom ? q.dateFrom : undefined,
      dateTo: typeof q.dateTo === 'string' && q.dateTo ? q.dateTo : undefined,
      hasNotes: q.hasNotes === '1' || q.hasNotes === 'true',
      sort:
        typeof q.sort === 'string' &&
        ['archived_desc', 'archived_asc', 'published_desc', 'published_asc'].includes(q.sort)
          ? (q.sort as ArchiveListQuery['sort'])
          : 'archived_desc',
    };
    const result = listArchives(query);
    res.json(result);
  } catch (err) {
    res.status(500).json({error: err instanceof Error ? err.message : 'Failed to list archives'});
  }
});

// Map of feed contentItemId -> latest archive badge info
archivesRouter.get('/archives/item-map', (_req, res) => {
  try {
    const map = getArchivedItemMap();
    res.json({map});
  } catch (err) {
    res.status(500).json({error: err instanceof Error ? err.message : 'Failed to load archive map'});
  }
});

// Poll background archive capture job progress
archivesRouter.get('/archives/jobs/:jobId', (req, res) => {
  const job = getArchiveJob(req.params.jobId);
  if (!job) {
    return res.status(404).json({error: 'Archive job not found'});
  }
  return res.json({job});
});

// Export entire archive library as a portable ZIP bundle
archivesRouter.get('/archives/export-all', async (_req, res) => {
  try {
    const {filename, buffer} = await exportAllArchivesZip();
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) {
    res.status(500).json({error: err instanceof Error ? err.message : 'Failed to export archives'});
  }
});

// Restore archives from ZIP backup (supports raw ZIP binary or JSON { zipBase64, overwriteConfirmed })
archivesRouter.post(
  '/archives/restore',
  express.raw({type: ['application/zip', 'application/octet-stream'], limit: '100mb'}),
  express.json({limit: '100mb'}),
  async (req, res) => {
    try {
      let zipBuffer: Buffer | null = null;
      let overwriteConfirmed = req.query.overwriteConfirmed === 'true';

      if (Buffer.isBuffer(req.body)) {
        zipBuffer = req.body;
      } else if (req.body && typeof req.body === 'object') {
        const bodyObj = req.body as {zipBase64?: string; overwriteConfirmed?: boolean};
        if (typeof bodyObj.overwriteConfirmed === 'boolean') {
          overwriteConfirmed = bodyObj.overwriteConfirmed;
        }
        if (typeof bodyObj.zipBase64 === 'string' && bodyObj.zipBase64.trim()) {
          const clean = bodyObj.zipBase64.replace(/^data:[^;]+;base64,/, '').trim();
          zipBuffer = Buffer.from(clean, 'base64');
        }
      }

      if (!zipBuffer || zipBuffer.length === 0) {
        return res.status(400).json({error: 'A valid ZIP archive payload is required'});
      }

      const result = await restoreArchivesFromZip(zipBuffer, {overwriteConfirmed});
      if (result.requiresConfirmation) {
        return res.status(409).json(result);
      }
      return res.json(result);
    } catch (err) {
      return res
        .status(400)
        .json({error: err instanceof Error ? err.message : 'Failed to restore ZIP backup'});
    }
  }
);

// Start a new archive job for a feed item or custom URL
archivesRouter.post('/archives', (req, res) => {
  try {
    const body = (req.body || {}) as {
      contentItemId?: number | null;
      url?: string;
      title?: string;
      author?: string | null;
      publisher?: string | null;
      publishedAt?: string | null;
      contentType?: 'news' | 'article' | 'video';
      categoryName?: string | null;
      tagNames?: string[];
      doi?: string | null;
      language?: string | null;
      formats?: unknown;
    };

    if (body.url && typeof body.url === 'string') {
      const check = validateExternalArchiveUrl(body.url);
      if (!check.valid) {
        return res.status(400).json({error: check.reason});
      }
    }

    const job = startArchiveJob({
      contentItemId: typeof body.contentItemId === 'number' ? body.contentItemId : null,
      url: typeof body.url === 'string' ? body.url.trim() : undefined,
      title: typeof body.title === 'string' ? body.title.trim() : undefined,
      author: typeof body.author === 'string' ? body.author : null,
      publisher: typeof body.publisher === 'string' ? body.publisher : null,
      publishedAt: typeof body.publishedAt === 'string' ? body.publishedAt : null,
      contentType: body.contentType,
      categoryName: typeof body.categoryName === 'string' ? body.categoryName : null,
      tagNames: Array.isArray(body.tagNames) ? body.tagNames.filter((t): t is string => typeof t === 'string') : undefined,
      doi: typeof body.doi === 'string' ? body.doi : null,
      language: typeof body.language === 'string' ? body.language : null,
      formats: parseFormats(body.formats),
    });

    return res.status(202).json({job});
  } catch (err) {
    return res.status(400).json({error: err instanceof Error ? err.message : 'Failed to start archive'});
  }
});

// Get single archive metadata
archivesRouter.get('/archives/:uid', (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  const archive = getArchiveByUid(req.params.uid);
  if (!archive) {
    return res.status(404).json({error: 'Archive not found'});
  }
  return res.json({archive});
});

// Create a new archived version (retry / re-capture without overwriting prior version)
archivesRouter.post('/archives/:uid/retry', (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  const existing = getArchiveByUid(req.params.uid);
  if (!existing) {
    return res.status(404).json({error: 'Archive not found'});
  }

  const check = validateExternalArchiveUrl(existing.originalUrl);
  if (!check.valid) {
    return res.status(400).json({error: check.reason});
  }

  const requestedFormats = parseFormats(
    (req.body as {formats?: unknown} | undefined)?.formats || existing.captureDetails.requestedFormats
  );

  const job = startArchiveJob({
    contentItemId: existing.contentItemId,
    url: existing.originalUrl,
    title: existing.title,
    author: existing.author,
    publisher: existing.publisher,
    publishedAt: existing.publishedAt,
    contentType: existing.contentType,
    categoryName: existing.categoryName,
    tagNames: existing.tagNames,
    doi: existing.doi,
    language: existing.language,
    formats: requestedFormats,
    parentArchiveUid: existing.archiveUid,
  });

  return res.status(202).json({job});
});

// Verify SHA-256 checksums on disk
archivesRouter.post('/archives/:uid/verify', async (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  try {
    const result = await checkArchiveIntegrity(req.params.uid);
    return res.json({integrity: result});
  } catch (err) {
    return res.status(404).json({error: err instanceof Error ? err.message : 'Archive not found'});
  }
});

// Export single archive as ZIP
archivesRouter.get('/archives/:uid/export', async (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  try {
    const {filename, buffer} = await exportSingleArchiveZip(req.params.uid);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(buffer);
  } catch (err) {
    return res.status(404).json({error: err instanceof Error ? err.message : 'Archive not found'});
  }
});

// Serve offline self-contained HTML with strict CSP & script sanitization
archivesRouter.get('/archives/:uid/view', async (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  try {
    const found = await readArchiveFileBuffer(req.params.uid, 'html');
    if (!found) {
      return res.status(404).json({error: 'Offline HTML copy not found for this archive'});
    }
    const sanitized = sanitizeArchivedHtml(found.buffer.toString('utf8'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', buildArchiveCspHeader());
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    if (req.query.download === '1') {
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.uid}.html"`);
    }
    return res.send(sanitized);
  } catch (err) {
    return res.status(500).json({error: err instanceof Error ? err.message : 'Unable to read archived HTML'});
  }
});

// Serve archival PDF inline or as download
archivesRouter.get('/archives/:uid/pdf', async (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  try {
    const found = await readArchiveFileBuffer(req.params.uid, 'pdf');
    if (!found) {
      return res.status(404).json({error: 'PDF copy not found for this archive'});
    }
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${disposition}; filename="${req.params.uid}.pdf"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(found.buffer);
  } catch (err) {
    return res.status(500).json({error: err instanceof Error ? err.message : 'Unable to read archived PDF'});
  }
});

// Serve thumbnail JPEG
archivesRouter.get('/archives/:uid/thumbnail', async (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  try {
    const found = await readArchiveFileBuffer(req.params.uid, 'thumbnail');
    if (!found) {
      return res.status(404).json({error: 'Thumbnail not found'});
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.send(found.buffer);
  } catch (err) {
    return res.status(500).json({error: err instanceof Error ? err.message : 'Unable to read thumbnail'});
  }
});

// Download raw WARC 1.1 (.warc.gz)
archivesRouter.get('/archives/:uid/warc', async (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  try {
    const found = await readArchiveFileBuffer(req.params.uid, 'warc');
    if (!found) {
      return res.status(404).json({error: 'WARC archive not found'});
    }
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.uid}.warc.gz"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(found.buffer);
  } catch (err) {
    return res.status(500).json({error: err instanceof Error ? err.message : 'Unable to read WARC file'});
  }
});

// Inspect WARC 1.1 records & documented limitations
archivesRouter.get('/archives/:uid/warc-inspect', async (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  try {
    const inspection = await inspectArchiveWarc(req.params.uid);
    return res.json(inspection);
  } catch (err) {
    return res.status(404).json({error: err instanceof Error ? err.message : 'Unable to inspect WARC'});
  }
});

// Local offline WARC resource replay endpoint (strictly isolated with CSP and sanitized HTML)
archivesRouter.get('/archives/:uid/warc-replay', async (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  try {
    const targetUrl = typeof req.query.url === 'string' ? req.query.url : undefined;
    const replayed = await replayArchiveWarcResource(req.params.uid, targetUrl);
    if (!replayed) {
      return res.status(404).send('Resource not captured inside this WARC archive');
    }

    const origin = getRequestOrigin(req);
    const mime = replayed.contentType.split(';')[0].trim().toLowerCase();

    res.setHeader('Content-Type', replayed.contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (mime === 'text/html' || mime === 'application/xhtml+xml') {
      res.setHeader('Content-Security-Policy', buildWarcReplayCspHeader(origin, req.params.uid));
    }

    return res.status(replayed.status >= 200 && replayed.status < 600 ? replayed.status : 200).send(replayed.body);
  } catch (err) {
    return res.status(500).send(err instanceof Error ? err.message : 'WARC replay failed');
  }
});

// Delete an archive record and its disk files
archivesRouter.delete('/archives/:uid', async (req, res) => {
  if (!validateSafeUid(req.params.uid)) {
    return res.status(400).json({error: 'Invalid archive UID'});
  }
  try {
    const deleted = await deleteArchiveByUid(req.params.uid);
    if (!deleted) {
      return res.status(404).json({error: 'Archive not found'});
    }
    return res.json({ok: true});
  } catch (err) {
    return res.status(500).json({error: err instanceof Error ? err.message : 'Failed to delete archive'});
  }
});
