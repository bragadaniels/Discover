import assert from 'node:assert/strict';
import test from 'node:test';
import {buildSelfContainedHtml} from './archive_html';
import {
  buildWarc11Archive,
  extractWarcResource,
  inspectWarcBuffer,
  rewriteCssForWarcReplay,
  rewriteHtmlForWarcReplay,
} from './archive_warc';

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

test('buildSelfContainedHtml embeds external CSS, @import, images, and favicon as data URIs without scripts', async () => {
  const pageUrl = 'https://example.org/articles/quantum-optics';
  const rawHtml = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <title>Quantum Optics Review</title>
        <meta name="author" content="Dr. Ada Lovelace">
        <link rel="icon" href="/favicon.png">
        <link rel="stylesheet" href="/styles/main.css">
      </head>
      <body>
        <article>
          <h1>Quantum Optics Review</h1>
          <img src="/images/diagram.png" alt="Optics Diagram" />
          <script>console.log('should be stripped');</script>
        </article>
      </body>
    </html>
  `;

  const capturedResources = new Map<string, {url: string; contentType: string; body: Buffer}>([
    [
      'https://example.org/styles/main.css',
      {
        url: 'https://example.org/styles/main.css',
        contentType: 'text/css; charset=utf-8',
        body: Buffer.from(`@import "/styles/theme.css"; body { font-family: Georgia, serif; }`),
      },
    ],
    [
      'https://example.org/styles/theme.css',
      {
        url: 'https://example.org/styles/theme.css',
        contentType: 'text/css; charset=utf-8',
        body: Buffer.from(`.hero { background-image: url("/images/diagram.png"); color: #1B1B19; }`),
      },
    ],
    [
      'https://example.org/images/diagram.png',
      {
        url: 'https://example.org/images/diagram.png',
        contentType: 'image/png',
        body: ONE_PIXEL_PNG,
      },
    ],
    [
      'https://example.org/favicon.png',
      {
        url: 'https://example.org/favicon.png',
        contentType: 'image/png',
        body: ONE_PIXEL_PNG,
      },
    ],
  ]);

  const res = await buildSelfContainedHtml({
    rawHtml,
    pageUrl,
    metadata: {
      archiveUid: 'arc_test_001',
      title: 'Quantum Optics Review',
      originalUrl: pageUrl,
      canonicalUrl: pageUrl,
      archivedAt: '2026-01-15T12:00:00.000Z',
      publishedAt: '2026-01-14T08:00:00.000Z',
      author: 'Dr. Ada Lovelace',
      publisher: 'Example Science',
      doi: '10.1000/test',
      language: 'en',
    },
    capturedResources,
    fetchResource: async () => null,
    maxResourceBytes: 5 * 1024 * 1024,
    maxTotalBytes: 45 * 1024 * 1024,
  });

  assert.equal(res.statusSuggestion, 'complete');
  assert.equal(res.completeness, 100);
  assert.equal(res.resourcesFailed, 0);
  assert.ok(res.resourcesCaptured >= 3);
  assert.ok(!/<script/i.test(res.html), 'Scripts must be stripped from self-contained HTML');
  assert.ok(!/<link[^>]+rel="stylesheet"/i.test(res.html), 'External stylesheet link must be replaced');
  assert.ok(res.html.includes('<style data-discover-archived-css='), 'Inlined style block must be present');
  assert.ok(res.html.includes('data:image/png;base64,'), 'Image must be embedded as data URI');
  assert.ok(res.html.includes('color: #1B1B19'), 'Recursive @import CSS must be inlined');
  assert.ok(res.html.includes('Discover Personal Web Archive'), 'Provenance metadata must be included');
});

test('buildSelfContainedHtml marks missing subresources honestly as partial instead of complete', async () => {
  const res = await buildSelfContainedHtml({
    rawHtml: `<html><body><link rel="stylesheet" href="https://example.org/missing.css"><img src="https://example.org/missing.png"><p>Body text</p></body></html>`,
    pageUrl: 'https://example.org/partial',
    metadata: {
      archiveUid: 'arc_partial_001',
      title: 'Partial Page',
      originalUrl: 'https://example.org/partial',
      canonicalUrl: 'https://example.org/partial',
      archivedAt: '2026-01-15T12:00:00.000Z',
      publishedAt: null,
      author: null,
      publisher: 'Example',
      doi: null,
      language: 'en',
    },
    capturedResources: new Map(),
    fetchResource: async () => null,
    maxResourceBytes: 1024 * 1024,
    maxTotalBytes: 5 * 1024 * 1024,
  });

  assert.ok(
    res.statusSuggestion === 'partial' || res.statusSuggestion === 'text_only',
    `Expected partial or text_only, got ${res.statusSuggestion}`
  );
  assert.ok(res.completeness < 100);
  assert.equal(res.resourcesFailed, 2);
});

test('WARC 1.1 creation, inspection, resource extraction, and replay rewriting round-trip cleanly', async () => {
  const htmlBody = Buffer.from(
    `<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><h1>Archived</h1><img src="/logo.png"><script>alert(1)</script></body></html>`,
    'utf8'
  );
  const cssBody = Buffer.from(`body { background: url("/bg.png"); color: #111; }`, 'utf8');

  const {buffer, recordCount} = await buildWarc11Archive({
    archiveUid: 'arc_warc_test',
    targetUrl: 'https://example.org/post',
    title: 'Archived Post',
    archivedAt: '2026-01-15T12:00:00.000Z',
    exchanges: [
      {
        url: 'https://example.org/post',
        method: 'GET',
        requestHeaders: {'user-agent': 'DiscoverArchiver/1.0'},
        status: 200,
        statusText: 'OK',
        responseHeaders: {'content-type': 'text/html; charset=utf-8'},
        body: htmlBody,
        timestamp: '2026-01-15T12:00:00.000Z',
      },
      {
        url: 'https://example.org/app.css',
        method: 'GET',
        requestHeaders: {'user-agent': 'DiscoverArchiver/1.0'},
        status: 200,
        statusText: 'OK',
        responseHeaders: {'content-type': 'text/css; charset=utf-8'},
        body: cssBody,
        timestamp: '2026-01-15T12:00:01.000Z',
      },
      {
        url: 'https://example.org/logo.png',
        method: 'GET',
        requestHeaders: {},
        status: 200,
        statusText: 'OK',
        responseHeaders: {'content-type': 'image/png'},
        body: ONE_PIXEL_PNG,
        timestamp: '2026-01-15T12:00:02.000Z',
      },
    ],
  });

  assert.equal(recordCount, 7); // 1 warcinfo + 3 * (request + response)
  const records = await inspectWarcBuffer(buffer);
  assert.equal(records.length, 7);
  assert.equal(records[0].warcType, 'warcinfo');
  assert.ok(records.some((r) => r.warcType === 'request' && r.targetUri === 'https://example.org/post'));
  assert.ok(records.some((r) => r.warcType === 'response' && r.httpStatus === 200));

  const mainHtml = await extractWarcResource(buffer);
  assert.ok(mainHtml);
  assert.equal(mainHtml.targetUri, 'https://example.org/post');

  const logo = await extractWarcResource(buffer, 'https://example.org/logo.png');
  assert.ok(logo);
  assert.equal(logo.contentType, 'image/png');
  assert.deepEqual(logo.body, ONE_PIXEL_PNG);

  const replayedHtml = rewriteHtmlForWarcReplay(
    mainHtml.body.toString('utf8'),
    mainHtml.targetUri,
    'arc_warc_test'
  );
  assert.ok(!/<script/i.test(replayedHtml), 'WARC replay HTML must strip scripts');
  assert.ok(
    replayedHtml.includes('/api/archives/arc_warc_test/warc-replay?url=https%3A%2F%2Fexample.org%2Fapp.css')
  );
  assert.ok(
    replayedHtml.includes('/api/archives/arc_warc_test/warc-replay?url=https%3A%2F%2Fexample.org%2Flogo.png')
  );

  const replayedCss = rewriteCssForWarcReplay(cssBody.toString('utf8'), 'https://example.org/app.css', 'arc_warc_test');
  assert.ok(replayedCss.includes('/api/archives/arc_warc_test/warc-replay?url=https%3A%2F%2Fexample.org%2Fbg.png'));
});
