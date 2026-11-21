import * as cheerio from 'cheerio';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import path from 'node:path';

export interface UrlValidationOptions {
  allowLoopbackForTest?: boolean;
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.msi',
  '.msp',
  '.com',
  '.scr',
  '.pif',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.vbs',
  '.dmg',
  '.pkg',
  '.deb',
  '.rpm',
  '.appimage',
  '.iso',
  '.img',
  '.bin',
  '.elf',
  '.jar',
  '.apk',
]);

const DANGEROUS_MIME_PREFIXES = [
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-dosexec',
  'application/x-executable',
  'application/x-mach-binary',
  'application/x-elf',
  'application/x-sh',
  'application/x-shellscript',
  'application/x-bat',
  'application/vnd.microsoft.portable-executable',
  'application/java-archive',
  'application/x-apple-diskimage',
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return -1;
  }
  return (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0);
}

function inIpv4Range(ipInt: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base);
  if (baseInt < 0 || ipInt < 0) return false;
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function isPrivateOrReservedIp(rawIp: string, options?: UrlValidationOptions): boolean {
  const ip = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '').split('%')[0];
  if (!ip) return true;

  // Handle IPv4-mapped IPv6 such as ::ffff:127.0.0.1
  if (ip.startsWith('::ffff:')) {
    const mapped = ip.slice(7);
    if (net.isIPv4(mapped)) {
      return isPrivateOrReservedIp(mapped, options);
    }
  }

  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    if (n < 0) return true;
    if (options?.allowLoopbackForTest && inIpv4Range(n, '127.0.0.0', 8)) {
      return false;
    }
    return (
      inIpv4Range(n, '0.0.0.0', 8) ||
      inIpv4Range(n, '10.0.0.0', 8) ||
      inIpv4Range(n, '100.64.0.0', 10) ||
      inIpv4Range(n, '127.0.0.0', 8) ||
      inIpv4Range(n, '169.254.0.0', 16) ||
      inIpv4Range(n, '172.16.0.0', 12) ||
      inIpv4Range(n, '192.0.0.0', 24) ||
      inIpv4Range(n, '192.0.2.0', 24) ||
      inIpv4Range(n, '192.168.0.0', 16) ||
      inIpv4Range(n, '198.18.0.0', 15) ||
      inIpv4Range(n, '198.51.100.0', 24) ||
      inIpv4Range(n, '203.0.113.0', 24) ||
      inIpv4Range(n, '224.0.0.0', 4) ||
      inIpv4Range(n, '240.0.0.0', 4)
    );
  }

  if (net.isIPv6(ip)) {
    if (options?.allowLoopbackForTest && ip === '::1') {
      return false;
    }
    if (ip === '::' || ip === '::1') return true;
    // Unique local address fc00::/7 (fc.. or fd..)
    if (ip.startsWith('fc') || ip.startsWith('fd')) return true;
    // Link-local fe80::/10 (fe80..febf)
    if (/^fe[89ab][0-9a-f]/i.test(ip)) return true;
    // Multicast ff00::/8
    if (ip.startsWith('ff')) return true;
    return false;
  }

  return true;
}

export function validateExternalArchiveUrl(
  rawUrl: string,
  options?: UrlValidationOptions
): {valid: true; parsed: URL} | {valid: false; reason: string} {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {valid: false, reason: 'URL is required'};
  }
  const trimmed = rawUrl.trim();
  if (trimmed.length > 2048) {
    return {valid: false, reason: 'URL exceeds maximum length'};
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {valid: false, reason: 'Invalid URL format'};
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {valid: false, reason: `Disallowed URL protocol: ${parsed.protocol}`};
  }

  if (parsed.username || parsed.password) {
    return {valid: false, reason: 'URLs with embedded credentials are not allowed'};
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    return {valid: false, reason: 'Missing hostname'};
  }

  if (
    !options?.allowLoopbackForTest &&
    (BLOCKED_HOSTNAMES.has(hostname) ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.lan'))
  ) {
    return {valid: false, reason: `Access to local or internal host "${hostname}" is blocked`};
  }

  if (net.isIP(hostname) && isPrivateOrReservedIp(hostname, options)) {
    return {valid: false, reason: `Access to private or reserved IP "${hostname}" is blocked`};
  }

  return {valid: true, parsed};
}

export async function assertSafeExternalUrl(
  rawUrl: string,
  options?: UrlValidationOptions
): Promise<URL> {
  const check = validateExternalArchiveUrl(rawUrl, options);
  if (!check.valid) {
    throw new Error(check.reason);
  }

  const hostname = check.parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIP(hostname)) {
    return check.parsed;
  }

  if (options?.allowLoopbackForTest && hostname === 'localhost') {
    return check.parsed;
  }

  let resolved: Array<{address: string; family: number}>;
  try {
    resolved = await dns.lookup(hostname, {all: true, verbatim: true});
  } catch {
    throw new Error(`DNS resolution failed for host "${hostname}"`);
  }

  if (!resolved || resolved.length === 0) {
    throw new Error(`Host "${hostname}" resolved to no addresses`);
  }

  for (const record of resolved) {
    if (isPrivateOrReservedIp(record.address, options)) {
      throw new Error(
        `SSRF protection blocked "${hostname}" because it resolves to private/reserved address ${record.address}`
      );
    }
  }

  return check.parsed;
}

export function isDangerousExecutable(urlOrPath: string, contentType?: string | null): boolean {
  const mime = (contentType || '').split(';')[0].trim().toLowerCase();
  if (mime && DANGEROUS_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix))) {
    return true;
  }
  try {
    const pathname = new URL(urlOrPath).pathname.toLowerCase();
    const ext = path.extname(pathname);
    if (ext && DANGEROUS_EXTENSIONS.has(ext)) {
      return true;
    }
  } catch {
    const ext = path.extname(urlOrPath.split('?')[0].toLowerCase());
    if (ext && DANGEROUS_EXTENSIONS.has(ext)) {
      return true;
    }
  }
  return false;
}

export function resolveSafeArchiveFilePath(archivesRoot: string, relativePath: string): string {
  if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
    throw new Error('Invalid archive file path');
  }
  const normalizedRoot = path.resolve(archivesRoot);
  const candidate = path.resolve(normalizedRoot, relativePath);
  if (candidate !== normalizedRoot && !candidate.startsWith(normalizedRoot + path.sep)) {
    throw new Error('Archive file path escapes archive root directory');
  }
  return candidate;
}

export function computeSha256(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

export function isAllowedDangerousAttrUrl(val: string): boolean {
  const trimmed = val.trim().toLowerCase();
  return (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('vbscript:') ||
    trimmed.startsWith('data:text/html') ||
    trimmed.startsWith('data:application/xhtml+xml')
  );
}

export function sanitizeArchivedHtml(html: string): string {
  const $ = cheerio.load(html);

  // Strip executable script blocks and active vectors
  $('script, object, embed, applet, base').remove();
  $('link[rel="preload"][as="script"], link[rel="modulepreload"]').remove();
  $('meta[http-equiv="refresh" i], meta[http-equiv="Content-Security-Policy" i]').remove();

  $('*').each((_, el) => {
    const elem = $(el);
    const attribs = (el as {attribs?: Record<string, string>}).attribs;
    if (!attribs) return;

    for (const attrName of Object.keys(attribs)) {
      const lower = attrName.toLowerCase();
      if (lower.startsWith('on')) {
        elem.removeAttr(attrName);
        continue;
      }
      const val = attribs[attrName] || '';
      if (
        (lower === 'href' || lower === 'src' || lower === 'xlink:href' || lower === 'action' || lower === 'formaction') &&
        isAllowedDangerousAttrUrl(val)
      ) {
        elem.attr(attrName, '#blocked-unsafe-uri');
      }
    }

    if ('tagName' in el && el.tagName?.toLowerCase() === 'iframe') {
      elem.attr('sandbox', '');
      const src = elem.attr('src') || '';
      if (src && !src.startsWith('data:')) {
        elem.removeAttr('src');
      }
    }
  });

  return $.html();
}

export function buildArchiveCspHeader(): string {
  return [
    "default-src 'none'",
    "img-src data: blob:",
    "style-src 'unsafe-inline' data:",
    "font-src data:",
    "media-src data: blob:",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

export function buildWarcReplayCspHeader(origin?: string, archiveUid?: string): string {
  const replaySource =
    origin && archiveUid
      ? `${origin}/api/archives/${encodeURIComponent(archiveUid)}/warc-replay`
      : origin
        ? `${origin}/api/archives/`
        : "'self'";
  return [
    "default-src 'none'",
    `img-src ${replaySource} data: blob:`,
    `style-src ${replaySource} 'unsafe-inline' data:`,
    `font-src ${replaySource} data:`,
    `media-src ${replaySource} data: blob:`,
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}
