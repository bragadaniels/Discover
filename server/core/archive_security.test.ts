import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  assertSafeExternalUrl,
  buildArchiveCspHeader,
  buildWarcReplayCspHeader,
  computeSha256,
  isDangerousExecutable,
  isPrivateOrReservedIp,
  resolveSafeArchiveFilePath,
  sanitizeArchivedHtml,
  validateExternalArchiveUrl,
} from './archive_security';

test('SSRF protection blocks private/loopback/metadata IPs and internal hostnames', async () => {
  const blockedUrls = [
    'http://127.0.0.1/admin',
    'http://10.0.0.1/internal',
    'http://172.16.5.10/secret',
    'http://192.168.1.1/router',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/test',
    'http://[fc00::1]/ula',
    'http://[fe80::1]/linklocal',
    'http://localhost:3000/api/health',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://printer.local/status',
    'file:///etc/passwd',
    'ftp://example.com/archive.tar',
    'javascript:alert(1)',
    'https://user:pass@example.com/private',
  ];

  for (const url of blockedUrls) {
    const res = validateExternalArchiveUrl(url);
    assert.equal(res.valid, false, `Expected URL to be blocked: ${url}`);
    await assert.rejects(() => assertSafeExternalUrl(url));
  }
});

test('SSRF protection permits valid public HTTP/HTTPS URLs and public IPs', () => {
  assert.equal(isPrivateOrReservedIp('8.8.8.8'), false);
  assert.equal(isPrivateOrReservedIp('1.1.1.1'), false);
  assert.equal(isPrivateOrReservedIp('::ffff:127.0.0.1'), true);
  assert.equal(isPrivateOrReservedIp('100.64.0.1'), true);

  const valid = validateExternalArchiveUrl('https://en.wikipedia.org/wiki/Web_archiving');
  assert.equal(valid.valid, true);
});

test('Executable blocking detects dangerous extensions and MIME types', () => {
  assert.equal(isDangerousExecutable('https://example.org/payload.exe'), true);
  assert.equal(isDangerousExecutable('https://example.org/install.sh?v=1'), true);
  assert.equal(isDangerousExecutable('https://example.org/app.dmg'), true);
  assert.equal(isDangerousExecutable('https://example.org/file', 'application/x-msdownload'), true);
  assert.equal(isDangerousExecutable('https://example.org/style.css', 'text/css'), false);
  assert.equal(isDangerousExecutable('https://example.org/photo.png', 'image/png'), false);
});

test('resolveSafeArchiveFilePath rejects path traversal and absolute paths', () => {
  const root = path.resolve('/tmp/discover-archive-root-test');
  const ok = resolveSafeArchiveFilePath(root, 'html/arc_123.html');
  assert.ok(ok.startsWith(root + path.sep));

  assert.throws(() => resolveSafeArchiveFilePath(root, '../etc/passwd'));
  assert.throws(() => resolveSafeArchiveFilePath(root, 'html/../../secret.txt'));
  assert.throws(() => resolveSafeArchiveFilePath(root, '/etc/passwd'));
  assert.throws(() => resolveSafeArchiveFilePath(root, 'bad\0path.html'));
});

test('sanitizeArchivedHtml strips scripts, event handlers, javascript: URIs, and meta refresh', () => {
  const dirty = `
    <!doctype html>
    <html>
      <head>
        <meta http-equiv="refresh" content="0;url=https://evil.test">
        <script>window.parent.postMessage('steal', '*');</script>
      </head>
      <body onload="alert(1)">
        <a href="javascript:fetch('/api/archives')">Click</a>
        <img src="data:image/png;base64,iVBORw0KGgo=" onerror="evil()" />
        <iframe src="https://evil.test/frame"></iframe>
      </body>
    </html>
  `;
  const clean = sanitizeArchivedHtml(dirty);
  assert.ok(!/<script/i.test(clean), 'script tag must be removed');
  assert.ok(!/onload=/i.test(clean), 'onload attribute must be removed');
  assert.ok(!/onerror=/i.test(clean), 'onerror attribute must be removed');
  assert.ok(!/javascript:/i.test(clean), 'javascript: URI must be neutralized');
  assert.ok(!/http-equiv="refresh"/i.test(clean), 'meta refresh must be removed');
  assert.ok(clean.includes('sandbox=""'), 'nested iframe must be sandboxed');
});

test('Strict CSP headers enforce default-src none and disallow inline/external scripts', () => {
  const htmlCsp = buildArchiveCspHeader();
  assert.ok(htmlCsp.includes("default-src 'none'"));
  assert.ok(!htmlCsp.includes('script-src'));

  const warcCsp = buildWarcReplayCspHeader('http://localhost:3000', 'arc_01');
  assert.ok(warcCsp.includes("default-src 'none'"));
  assert.ok(warcCsp.includes('http://localhost:3000/api/archives/arc_01/warc-replay'));
  assert.ok(!warcCsp.includes('script-src'));

  const hash = computeSha256('discover-integrity-check');
  assert.equal(hash.length, 64);
});
