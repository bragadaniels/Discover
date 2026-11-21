import {Router} from 'express';
import {deleteItemNote, upsertItemNote} from '../services/note_service';

export const notesRouter = Router();

notesRouter.put('/notes', (req, res) => {
  try {
    const body = (req.body || {}) as {
      canonicalUrl?: string;
      contentItemId?: number | null;
      archiveUid?: string | null;
      noteText?: string;
    };

    if (typeof body.noteText !== 'string') {
      return res.status(400).json({error: 'noteText string is required'});
    }

    const note = upsertItemNote({
      canonicalUrl: body.canonicalUrl,
      contentItemId: typeof body.contentItemId === 'number' ? body.contentItemId : null,
      archiveUid: typeof body.archiveUid === 'string' ? body.archiveUid : null,
      noteText: body.noteText,
    });

    return res.json({note});
  } catch (err) {
    return res.status(400).json({error: err instanceof Error ? err.message : 'Failed to save note'});
  }
});

notesRouter.delete('/notes', (req, res) => {
  try {
    const canonicalUrl =
      typeof req.query.canonicalUrl === 'string'
        ? req.query.canonicalUrl
        : typeof req.body?.canonicalUrl === 'string'
          ? req.body.canonicalUrl
          : undefined;
    const rawId = req.query.contentItemId ?? req.body?.contentItemId;
    const contentItemId = rawId && Number.isFinite(Number(rawId)) ? Number(rawId) : null;
    const archiveUid =
      typeof req.query.archiveUid === 'string'
        ? req.query.archiveUid
        : typeof req.body?.archiveUid === 'string'
          ? req.body.archiveUid
          : undefined;

    const deleted = deleteItemNote({canonicalUrl, contentItemId, archiveUid});
    return res.json({ok: true, deleted});
  } catch (err) {
    return res.status(400).json({error: err instanceof Error ? err.message : 'Failed to delete note'});
  }
});
