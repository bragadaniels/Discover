import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test('Archive system satisfies end-to-end persistence, offline replay, PDF, export/restore, and isolation guarantees', async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'discover-archive-e2e-'));
  const dbPath = path.join(tempRoot, 'test-discover.db');
  const archivesDir = path.join(tempRoot, 'archives');

  process.env.DISCOVER_DB_PATH = dbPath;
  process.env.DISCOVER_ARCHIVES_DIR = archivesDir;

  const {APP_CONFIG} = await import('../config');
  APP_CONFIG.dbPath = dbPath;
  APP_CONFIG.archivesDir = archivesDir;

  const {closeDb, getDb} = await import('../db/database');
  const archiveService = await import('../services/archive_service');
  const {buildArchiveCspHeader, buildWarcReplayCspHeader, sanitizeArchivedHtml} = await import(
    './archive_security'
  );

  // Spin up local HTTP fixture server serving static, styled/imaged, JS-rendered, and blocked pages
  let serverClosed = false;
  const server = http.createServer((req, res) => {
    const reqUrl = req.url || '/';
    if (reqUrl === '/static') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(`<!doctype html><html lang="en"><head><title>Static Editorial Page</title><meta name="author" content="Jane Doe"></head><body><h1>Static Editorial Headline</h1><p>Preserved offline content.</p><script>window.__evil = true;</script></body></html>`);
      return;
    }
    if (reqUrl === '/rich') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(`<!doctype html><html lang="en"><head><title>Rich Styled Page</title><link rel="stylesheet" href="/style.css"></head><body><h1 class="headline">Rich Styled Article</h1><img src="/pic.png" alt="Fixture"><div id="js-mount">Loading…</div><script>document.getElementById('js-mount').textContent = 'Injected Dynamic DOM Content';</script></body></html>`);
      return;
    }
    if (reqUrl === '/style.css') {
      res.writeHead(200, {'Content-Type': 'text/css; charset=utf-8'});
      res.end(`.headline { color: #1E3A5F; font-family: Georgia, serif; }`);
      return;
    }
    if (reqUrl === '/pic.png') {
      res.writeHead(200, {'Content-Type': 'image/png'});
      res.end(ONE_PIXEL_PNG);
      return;
    }
    if (reqUrl === '/partial-missing-asset') {
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(`<!doctype html><html><head><title>Partial Page</title><link rel="stylesheet" href="/not-found.css"></head><body><p>Body with missing stylesheet.</p><img src="/not-found.png"></body></html>`);
      return;
    }
    if (reqUrl === '/forbidden') {
      res.writeHead(403, {'Content-Type': 'text/html; charset=utf-8'});
      res.end(`<!doctype html><html><head><title>403 Forbidden</title></head><body><p>Access Denied</p></body></html>`);
      return;
    }
    res.writeHead(404, {'Content-Type': 'text/plain'});
    res.end('Not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    if (!serverClosed) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    closeDb();
    await fs.rm(tempRoot, {recursive: true, force: true});
  });

  // Seed a feed category + tag + content_item to verify feed linkage & feed deletion independence
  const db = getDb();
  const catId = Number(
    db
      .prepare(`INSERT INTO categories (name, slug, icon, sort_order) VALUES ('Science', 'science', 'atom', 0)`)
      .run().lastInsertRowid
  );
  const tagId = Number(
    db.prepare(`INSERT INTO tags (category_id, name, priority) VALUES (?, 'Optics', 4)`).run(catId).lastInsertRowid
  );
  const contentItemId = Number(
    db
      .prepare(
        `INSERT INTO content_items (title, description, content_type, original_url, canonical_url, source_name, source_domain, provider_name)
         VALUES ('Rich Styled Article', 'Test desc', 'article', ?, ?, 'Fixture Press', '127.0.0.1', 'crossref')`
      )
      .run(`${baseUrl}/rich`, `${baseUrl}/rich`).lastInsertRowid
  );
  db.prepare(`INSERT INTO content_tags (content_id, tag_id, match_type, matched_term) VALUES (?, ?, 'direct', 'Optics')`).run(
    contentItemId,
    tagId
  );

  // Acceptance 1-4: Archive page with CSS, images, dynamic JS content in all 3 formats (HTML, WARC, PDF)
  const fullRecord = await archiveService.executeArchiveCapture(
    {
      contentItemId,
      url: `${baseUrl}/rich`,
      formats: ['html', 'warc', 'pdf'],
    },
    {allowLoopbackForTest: true, archivesDir}
  );

  assert.equal(fullRecord.status, 'complete');
  assert.equal(fullRecord.completeness, 100);
  assert.deepEqual(fullRecord.availableFormats.sort(), ['html', 'pdf', 'warc']);
  assert.equal(fullRecord.contentItemId, contentItemId);

  // Verify self-contained HTML captured dynamic JS DOM output AND embedded CSS/PNG AND stripped <script>
  const htmlRead = await archiveService.readArchiveFileBuffer(fullRecord.archiveUid, 'html', archivesDir);
  assert.ok(htmlRead);
  const htmlText = sanitizeArchivedHtml(htmlRead.buffer.toString('utf8'));
  assert.ok(htmlText.includes('Injected Dynamic DOM Content'), 'Dynamic JS-rendered content must be captured');
  assert.ok(htmlText.includes('#1E3A5F'), 'External CSS must be embedded');
  assert.ok(htmlText.includes('data:image/png;base64,'), 'External PNG must be embedded');
  assert.ok(!/<script/i.test(htmlText), 'Executable script tags must be stripped');

  // Verify PDF starts with %PDF-
  const pdfRead = await archiveService.readArchiveFileBuffer(fullRecord.archiveUid, 'pdf', archivesDir);
  assert.ok(pdfRead);
  assert.ok(pdfRead.buffer.subarray(0, 5).toString('ascii') === '%PDF-', 'Generated PDF must be valid %PDF- binary');
  assert.ok(pdfRead.buffer.length > 1000, 'PDF must be non-empty');

  // Verify SHA-256 integrity passes
  const integrity = await archiveService.checkArchiveIntegrity(fullRecord.archiveUid, archivesDir);
  assert.equal(integrity.valid, true);

  // Acceptance 13: Incomplete / 403 captures are honestly marked partial or text_only (never complete)
  const partialMissing = await archiveService.executeArchiveCapture(
    {url: `${baseUrl}/partial-missing-asset`, formats: ['html']},
    {allowLoopbackForTest: true, archivesDir}
  );
  assert.ok(partialMissing.status === 'partial' || partialMissing.status === 'text_only');
  assert.ok(partialMissing.completeness < 100);

  const forbiddenCapture = await archiveService.executeArchiveCapture(
    {url: `${baseUrl}/forbidden`, formats: ['html']},
    {allowLoopbackForTest: true, archivesDir}
  );
  assert.equal(forbiddenCapture.status, 'partial');
  assert.equal(forbiddenCapture.captureDetails.httpStatus, 403);

  // Re-archiving same URL creates v2 instead of overwriting v1
  const v2 = await archiveService.executeArchiveCapture(
    {url: `${baseUrl}/static`, formats: ['html']},
    {allowLoopbackForTest: true, archivesDir}
  );
  const v3 = await archiveService.executeArchiveCapture(
    {url: `${baseUrl}/static`, formats: ['html'], parentArchiveUid: v2.archiveUid},
    {allowLoopbackForTest: true, archivesDir}
  );
  assert.equal(v2.versionNumber, 1);
  assert.equal(v3.versionNumber, 2);
  assert.equal(v3.parentArchiveUid, v2.archiveUid);

  // Acceptance 11 & 12: Shut down origin server completely AND delete the original feed item!
  await new Promise<void>((resolve) => server.close(() => resolve()));
  serverClosed = true;

  db.prepare('DELETE FROM content_items WHERE id = ?').run(contentItemId);

  // Acceptance 8: Close and reopen SQLite DB to verify persistence across restarts
  closeDb();
  APP_CONFIG.dbPath = dbPath;
  const reopenedDb = getDb();
  const itemRow = reopenedDb.prepare('SELECT id FROM content_items WHERE id = ?').get(contentItemId);
  assert.equal(itemRow, undefined, 'Original feed item was deleted');

  // Reload archive after DB restart & origin shutdown
  const persisted = archiveService.getArchiveByUid(fullRecord.archiveUid);
  assert.ok(persisted, 'Archive must persist after restart and feed item deletion');
  assert.equal(persisted.contentItemId, null, 'ON DELETE SET NULL must preserve archive with null feed reference');

  // Acceptance 5 & 6: Serve HTML offline and inspect & replay WARC offline with origin dead
  const warcInspect = await archiveService.inspectArchiveWarc(fullRecord.archiveUid, archivesDir);
  assert.ok(warcInspect.records.length >= 3);
  assert.ok(warcInspect.limitations.length >= 3);

  const replayedHtml = await archiveService.replayArchiveWarcResource(fullRecord.archiveUid, null, archivesDir);
  assert.ok(replayedHtml);
  const replayedStr = replayedHtml.body.toString('utf8');
  assert.ok(!/<script/i.test(replayedStr));
  assert.ok(replayedStr.includes('warc-replay?url='));

  const replayedCss = await archiveService.replayArchiveWarcResource(
    fullRecord.archiveUid,
    `${baseUrl}/style.css`,
    archivesDir
  );
  assert.ok(replayedCss);
  assert.ok(replayedCss.body.toString('utf8').includes('#1E3A5F'));

  // Acceptance 14: Verify strict CSP strings
  assert.ok(buildArchiveCspHeader().includes("default-src 'none'"));
  assert.ok(buildWarcReplayCspHeader('http://localhost:3000', fullRecord.archiveUid).includes("default-src 'none'"));

  // Acceptance 9 & 10: Export All ZIP, verify conflict check before overwrite, restore into clean DB/dir
  const exportedAll = await archiveService.exportAllArchivesZip(archivesDir);
  assert.ok(exportedAll.count >= 4);
  assert.ok(exportedAll.buffer.length > 500);

  // Attempting restore into existing archive library without confirmation MUST return requiresConfirmation=true
  const conflictCheck = await archiveService.restoreArchivesFromZip(exportedAll.buffer, {
    overwriteConfirmed: false,
    archivesDir,
  });
  assert.equal(conflictCheck.requiresConfirmation, true);
  assert.ok(conflictCheck.conflicts.length >= 4);

  // Restore into a completely fresh empty DB & empty directory
  const restoreRoot = path.join(tempRoot, 'restored');
  const restoreDbPath = path.join(restoreRoot, 'restored.db');
  const restoreArchivesDir = path.join(restoreRoot, 'archives');
  closeDb();
  APP_CONFIG.dbPath = restoreDbPath;
  APP_CONFIG.archivesDir = restoreArchivesDir;
  getDb();

  const restored = await archiveService.restoreArchivesFromZip(exportedAll.buffer, {
    overwriteConfirmed: false,
    archivesDir: restoreArchivesDir,
  });
  assert.equal(restored.requiresConfirmation, false);
  assert.ok(restored.restored >= 4);

  const restoredIntegrity = await archiveService.checkArchiveIntegrity(
    fullRecord.archiveUid,
    restoreArchivesDir
  );
  assert.equal(restoredIntegrity.valid, true, 'Restored archive files must match original SHA-256 checksums');
});
