import type {ItemNote} from '../../shared/types';
import {
  syncArchiveFtsIndex,
  syncContentFtsIndex,
  syncFtsByCanonicalUrl,
} from '../core/fts_search';
import {canonicalizeUrl} from '../core/normalizer';
import {getDb} from '../db/database';

interface NoteRow {
  id: number;
  canonical_url: string;
  content_item_id: number | null;
  archive_uid: string | null;
  note_text: string;
  created_at: string;
  updated_at: string;
}

function rowToItemNote(row: NoteRow): ItemNote {
  return {
    id: row.id,
    canonicalUrl: row.canonical_url,
    contentItemId: row.content_item_id,
    archiveUid: row.archive_uid,
    noteText: row.note_text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function resolveCanonicalContext(input: {
  canonicalUrl?: string | null;
  contentItemId?: number | null;
  archiveUid?: string | null;
}): {
  canonicalUrl: string;
  contentItemId: number | null;
  archiveUid: string | null;
} {
  const db = getDb();
  let canonicalUrl = input.canonicalUrl?.trim() || '';
  let contentItemId =
    typeof input.contentItemId === 'number' && Number.isFinite(input.contentItemId)
      ? input.contentItemId
      : null;
  let archiveUid = input.archiveUid?.trim() || null;

  if (contentItemId && !canonicalUrl) {
    const row = db
      .prepare('SELECT canonical_url FROM content_items WHERE id = ?')
      .get(contentItemId) as {canonical_url: string} | undefined;
    if (row) canonicalUrl = row.canonical_url;
  }

  if (archiveUid && !canonicalUrl) {
    const row = db
      .prepare('SELECT canonical_url, content_item_id FROM archives WHERE archive_uid = ?')
      .get(archiveUid) as {canonical_url: string; content_item_id: number | null} | undefined;
    if (row) {
      canonicalUrl = row.canonical_url;
      if (!contentItemId && row.content_item_id) {
        contentItemId = row.content_item_id;
      }
    }
  }

  if (!canonicalUrl) {
    throw new Error('A valid contentItemId, archiveUid, or canonicalUrl is required');
  }

  try {
    canonicalUrl = canonicalizeUrl(canonicalUrl);
  } catch {
    // Keep as provided if non-standard URL string
  }

  if (!contentItemId) {
    const row = db
      .prepare('SELECT id FROM content_items WHERE canonical_url = ? LIMIT 1')
      .get(canonicalUrl) as {id: number} | undefined;
    if (row) contentItemId = row.id;
  }

  if (!archiveUid) {
    const row = db
      .prepare(
        'SELECT archive_uid FROM archives WHERE canonical_url = ? ORDER BY version_number DESC LIMIT 1'
      )
      .get(canonicalUrl) as {archive_uid: string} | undefined;
    if (row) archiveUid = row.archive_uid;
  }

  return {canonicalUrl, contentItemId, archiveUid};
}

export function upsertItemNote(input: {
  canonicalUrl?: string | null;
  contentItemId?: number | null;
  archiveUid?: string | null;
  noteText: string;
}): ItemNote | null {
  const db = getDb();
  const ctx = resolveCanonicalContext(input);
  const trimmed = input.noteText.trim();

  if (!trimmed) {
    db.prepare('DELETE FROM item_notes WHERE canonical_url = ?').run(ctx.canonicalUrl);
    syncFtsByCanonicalUrl(db, ctx.canonicalUrl);
    if (ctx.contentItemId) syncContentFtsIndex(db, ctx.contentItemId);
    if (ctx.archiveUid) syncArchiveFtsIndex(db, ctx.archiveUid);
    return null;
  }

  const clipped = trimmed.slice(0, 8000);
  const nowIso = new Date().toISOString();

  db.prepare(
    `INSERT INTO item_notes (canonical_url, content_item_id, archive_uid, note_text, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(canonical_url) DO UPDATE SET
       content_item_id = COALESCE(excluded.content_item_id, item_notes.content_item_id),
       archive_uid = COALESCE(excluded.archive_uid, item_notes.archive_uid),
       note_text = excluded.note_text,
       updated_at = excluded.updated_at`
  ).run(ctx.canonicalUrl, ctx.contentItemId, ctx.archiveUid, clipped, nowIso, nowIso);

  syncFtsByCanonicalUrl(db, ctx.canonicalUrl);
  if (ctx.contentItemId) syncContentFtsIndex(db, ctx.contentItemId);
  if (ctx.archiveUid) syncArchiveFtsIndex(db, ctx.archiveUid);

  const saved = db
    .prepare('SELECT * FROM item_notes WHERE canonical_url = ?')
    .get(ctx.canonicalUrl) as unknown as NoteRow | undefined;
  return saved ? rowToItemNote(saved) : null;
}

export function deleteItemNote(input: {
  canonicalUrl?: string | null;
  contentItemId?: number | null;
  archiveUid?: string | null;
}): boolean {
  const db = getDb();
  const ctx = resolveCanonicalContext(input);
  const res = db
    .prepare('DELETE FROM item_notes WHERE canonical_url = ?')
    .run(ctx.canonicalUrl);
  syncFtsByCanonicalUrl(db, ctx.canonicalUrl);
  if (ctx.contentItemId) syncContentFtsIndex(db, ctx.contentItemId);
  if (ctx.archiveUid) syncArchiveFtsIndex(db, ctx.archiveUid);
  return res.changes > 0;
}

export function getNotesMapForUrls(
  canonicalUrls: string[]
): Map<string, {noteText: string; updatedAt: string}> {
  const map = new Map<string, {noteText: string; updatedAt: string}>();
  const unique = Array.from(new Set(canonicalUrls.filter(Boolean)));
  if (unique.length === 0) return map;

  const db = getDb();
  const placeholders = unique.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT canonical_url, note_text, updated_at
       FROM item_notes
       WHERE canonical_url IN (${placeholders})`
    )
    .all(...unique) as Array<{
    canonical_url: string;
    note_text: string;
    updated_at: string;
  }>;

  for (const row of rows) {
    map.set(row.canonical_url, {
      noteText: row.note_text,
      updatedAt: row.updated_at,
    });
  }
  return map;
}
