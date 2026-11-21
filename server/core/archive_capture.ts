import fs from 'node:fs';
import path from 'node:path';
import {chromium, type Browser} from 'playwright-core';
import {APP_CONFIG} from '../config';
import type {CapturedResource} from './archive_html';
import {
  assertSafeExternalUrl,
  isDangerousExecutable,
  type UrlValidationOptions,
} from './archive_security';
import type {WarcHttpExchange} from './archive_warc';

export interface PageCaptureResult {
  finalUrl: string;
  httpStatus: number | null;
  mimeType: string | null;
  rawHtml: string;
  extraCssText: string[];
  capturedResources: Map<string, CapturedResource>;
  exchanges: WarcHttpExchange[];
  thumbnailBuffer: Buffer | null;
  captureMethod: 'playwright' | 'fetch_fallback';
  warnings: string[];
  limitations: string[];
}

function findChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH && fs.existsSync(process.env.PLAYWRIGHT_EXECUTABLE_PATH)) {
    return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  }
  const msPlaywrightDir = '/ms-playwright';
  if (fs.existsSync(msPlaywrightDir)) {
    const dirs = fs.readdirSync(msPlaywrightDir);
    for (const d of dirs) {
      if (d.startsWith('chromium_headless_shell')) {
        const candidate = path.join(msPlaywrightDir, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
        if (fs.existsSync(candidate)) return candidate;
      }
      if (d.startsWith('chromium-')) {
        const candidate = path.join(msPlaywrightDir, d, 'chrome-linux', 'chrome');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

export async function safeFetchResource(
  targetUrl: string,
  options?: UrlValidationOptions & {maxBytes?: number; timeoutMs?: number}
): Promise<CapturedResource | null> {
  try {
    await assertSafeExternalUrl(targetUrl, options);
  } catch {
    return null;
  }
  if (isDangerousExecutable(targetUrl)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? APP_CONFIG.requestTimeoutMs);
  try {
    const res = await fetch(targetUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'DiscoverArchiveBot/1.0 (+personal-preservation)',
        Accept: '*/*',
      },
    });
    if (!res.ok) return null;

    // Validate redirected destination for SSRF
    if (res.url && res.url !== targetUrl) {
      await assertSafeExternalUrl(res.url, options);
    }

    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    if (isDangerousExecutable(res.url || targetUrl, contentType)) {
      return null;
    }

    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);
    const maxBytes = options?.maxBytes ?? APP_CONFIG.maxArchiveResourceBytes;
    if (buf.length > maxBytes) {
      return null;
    }

    return {
      url: targetUrl,
      contentType,
      body: buf,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function detectPaywallOrAuthLimitation(status: number | null, html: string): string | null {
  if (status === 401 || status === 403 || status === 402 || status === 429) {
    return `Origin returned HTTP ${status} (access restricted, paywalled, or rate-limited; Discover does not bypass authentication or paywalls).`;
  }
  const lower = html.toLowerCase();
  if (
    (lower.includes('subscribe to read') ||
      lower.includes('sign in to continue') ||
      lower.includes('create a free account to continue')) &&
    html.length < 35000
  ) {
    return 'Page appears to display a sign-in or subscription gate; captured content reflects publicly accessible markup only.';
  }
  return null;
}

export async function captureWebPage(
  targetUrl: string,
  options?: UrlValidationOptions & {
    onProgress?: (stage: 'fetching_page' | 'capturing_resources', message: string) => void;
  }
): Promise<PageCaptureResult> {
  await assertSafeExternalUrl(targetUrl, options);
  options?.onProgress?.('fetching_page', 'Validating URL and retrieving original page…');

  const capturedResources = new Map<string, CapturedResource>();
  const exchanges: WarcHttpExchange[] = [];
  const warnings: string[] = [];
  const limitations: string[] = [];
  let totalCapturedBytes = 0;

  const executablePath = findChromiumExecutable();
  let browser: Browser | null = null;

  if (executablePath) {
    try {
      browser = await chromium.launch({
        executablePath,
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      const context = await browser.newContext({
        viewport: {width: 1280, height: 800},
        userAgent:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 DiscoverArchiver/1.0',
      });
      const page = await context.newPage();

      await page.route('**/*', async (route) => {
        const reqUrl = route.request().url();
        if (reqUrl.startsWith('data:') || reqUrl.startsWith('blob:') || reqUrl === 'about:blank') {
          await route.continue();
          return;
        }
        try {
          await assertSafeExternalUrl(reqUrl, options);
          if (isDangerousExecutable(reqUrl)) {
            warnings.push(`Blocked executable resource request: ${reqUrl}`);
            await route.abort('blockedbyclient');
            return;
          }
          await route.continue();
        } catch (err) {
          warnings.push(
            `Blocked unsafe subresource (${reqUrl}): ${err instanceof Error ? err.message : 'SSRF rule'}`
          );
          await route.abort('accessdenied');
        }
      });

      page.on('response', async (response) => {
        try {
          const url = response.url();
          if (!url.startsWith('http://') && !url.startsWith('https://')) return;
          const headers = response.headers();
          const contentType = headers['content-type'] || 'application/octet-stream';
          if (isDangerousExecutable(url, contentType)) return;

          const body = await response.body().catch(() => null);
          if (!body) return;
          if (body.length > APP_CONFIG.maxArchiveResourceBytes) {
            warnings.push(`Omitted oversized resource (${Math.round(body.length / 1024)} KB): ${url}`);
            return;
          }
          if (totalCapturedBytes + body.length > APP_CONFIG.maxArchiveTotalBytes) {
            return;
          }
          totalCapturedBytes += body.length;

          const buf = Buffer.from(body);
          const status = response.status();
          const req = response.request();

          if (status >= 200 && status < 400) {
            capturedResources.set(url, {url, contentType, body: buf});
          } else if (req.resourceType() !== 'document') {
            warnings.push(`Subresource returned HTTP ${status}: ${url}`);
          }

          exchanges.push({
            url,
            method: req.method(),
            requestHeaders: req.headers(),
            status,
            statusText: response.statusText() || 'OK',
            responseHeaders: headers,
            body: buf,
            timestamp: new Date().toISOString(),
          });
        } catch {
          // Ignore individual response capture errors (e.g. redirects with empty body)
        }
      });

      const mainResponse = await page.goto(targetUrl, {
        waitUntil: 'networkidle',
        timeout: APP_CONFIG.archiveTimeoutMs,
      }).catch(async () => {
        // Retry once waiting only for domcontentloaded if heavy trackers prevent networkidle
        return page.goto(targetUrl, {
          waitUntil: 'domcontentloaded',
          timeout: APP_CONFIG.archiveTimeoutMs,
        });
      });

      options?.onProgress?.('capturing_resources', 'Waiting for dynamic page content and media…');

      // Allow short settle + gentle scroll to trigger lazy-loaded content
      await page.waitForTimeout(800);
      await page.evaluate(async () => {
        window.scrollTo(0, Math.min(document.body.scrollHeight, 1200));
        await new Promise((r) => setTimeout(r, 250));
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(400);

      const finalUrl = page.url() || targetUrl;
      const httpStatus = mainResponse ? mainResponse.status() : 200;
      const mainHeaders = mainResponse ? mainResponse.headers() : {};
      const mimeType = mainHeaders['content-type'] || 'text/html';

      const rawHtml = await page.content();

      // Capture CSSOM / dynamically injected stylesheets (SPA CSS-in-JS / adoptedStyleSheets)
      const extraCssText = await page.evaluate(() => {
        const cssBlocks: string[] = [];
        for (const sheet of Array.from(document.styleSheets)) {
          try {
            // Only collect CSS from style tags without href or inaccessible CSSOM
            if (!sheet.href && sheet.cssRules) {
              const rules = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
              if (rules.trim()) cssBlocks.push(rules);
            }
          } catch {
            // Cross-origin CSS rules are captured from network response directly
          }
        }
        return cssBlocks;
      });

      const thumbnailBuffer = await page
        .screenshot({type: 'jpeg', quality: 75})
        .then((b) => Buffer.from(b))
        .catch(() => null);

      const authLimitation = detectPaywallOrAuthLimitation(httpStatus, rawHtml);
      if (authLimitation) {
        limitations.push(authLimitation);
        warnings.push(authLimitation);
      }

      // Ensure final rendered HTML is present as primary resource if page was JS-hydrated
      if (!exchanges.some((e) => e.url === finalUrl)) {
        const htmlBuf = Buffer.from(rawHtml, 'utf8');
        exchanges.unshift({
          url: finalUrl,
          method: 'GET',
          requestHeaders: {Accept: 'text/html'},
          status: httpStatus || 200,
          statusText: 'OK',
          responseHeaders: {'content-type': 'text/html; charset=utf-8'},
          body: htmlBuf,
          timestamp: new Date().toISOString(),
        });
      }

      return {
        finalUrl,
        httpStatus,
        mimeType,
        rawHtml,
        extraCssText,
        capturedResources,
        exchanges,
        thumbnailBuffer,
        captureMethod: 'playwright',
        warnings,
        limitations,
      };
    } catch (err) {
      warnings.push(
        `Browser render fallback activated: ${err instanceof Error ? err.message : 'Browser capture failed'}`
      );
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  }

  // Safe HTTP fetch fallback if headless browser is unavailable or blocked
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), APP_CONFIG.archiveTimeoutMs);
  try {
    const response = await fetch(targetUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'DiscoverArchiveBot/1.0 (+personal-preservation)',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    const finalUrl = response.url || targetUrl;
    await assertSafeExternalUrl(finalUrl, options);

    const contentType = response.headers.get('content-type') || 'text/html';
    if (isDangerousExecutable(finalUrl, contentType)) {
      throw new Error('Blocked executable content type');
    }

    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.length > APP_CONFIG.maxArchiveTotalBytes) {
      throw new Error('Page exceeds maximum archival size limit');
    }

    const rawHtml = buf.toString('utf8');
    const headerRecord: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headerRecord[k] = v;
    });

    exchanges.push({
      url: finalUrl,
      method: 'GET',
      requestHeaders: {Accept: 'text/html'},
      status: response.status,
      statusText: response.statusText || 'OK',
      responseHeaders: headerRecord,
      body: buf,
      timestamp: new Date().toISOString(),
    });
    capturedResources.set(finalUrl, {url: finalUrl, contentType, body: buf});

    const authLimitation = detectPaywallOrAuthLimitation(response.status, rawHtml);
    if (authLimitation) {
      limitations.push(authLimitation);
      warnings.push(authLimitation);
    }
    limitations.push('Captured via direct HTTP fetch without dynamic JavaScript execution.');

    return {
      finalUrl,
      httpStatus: response.status,
      mimeType: contentType,
      rawHtml,
      extraCssText: [],
      capturedResources,
      exchanges,
      thumbnailBuffer: null,
      captureMethod: 'fetch_fallback',
      warnings,
      limitations,
    };
  } finally {
    clearTimeout(timeout);
  }
}
