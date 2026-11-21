import * as cheerio from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import {chromium, type Browser} from 'playwright-core';

export interface PdfGenerationInput {
  selfContainedHtml: string;
  title: string;
  originalUrl: string;
  publishedAt?: string | null;
  archivedAt: string;
  author?: string | null;
  publisher?: string | null;
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

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatHumanDate(iso: string | null | undefined): string {
  if (!iso) return 'Not specified';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function prepareHtmlForArchivalPdf(input: PdfGenerationInput): string {
  const $ = cheerio.load(input.selfContainedHtml);
  $('script').remove();

  const coverBanner = `
    <div id="discover-pdf-provenance-banner" style="
      font-family: Georgia, 'Times New Roman', serif;
      background: #F6F4EF;
      color: #1B1B19;
      border-bottom: 2px solid #1E3A5F;
      padding: 14px 18px;
      margin: 0 0 20px 0;
      font-size: 12px;
      line-height: 1.45;
    ">
      <div style="font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #57554E; margin-bottom: 4px;">
        Discover Personal Web Archive — Document Preservation Copy
      </div>
      <div style="font-size: 17px; font-weight: 700; color: #1B1B19; margin-bottom: 6px;">
        ${escapeHtml(input.title)}
      </div>
      <div style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; color: #3D3B36; word-break: break-all;">
        <div><strong>Original URL:</strong> ${escapeHtml(input.originalUrl)}</div>
        ${input.publisher ? `<div><strong>Publisher:</strong> ${escapeHtml(input.publisher)}</div>` : ''}
        ${input.author ? `<div><strong>Author:</strong> ${escapeHtml(input.author)}</div>` : ''}
        <div><strong>Publication Date:</strong> ${escapeHtml(formatHumanDate(input.publishedAt))} &nbsp;·&nbsp; <strong>Archived Date:</strong> ${escapeHtml(formatHumanDate(input.archivedAt))}</div>
      </div>
    </div>
  `;

  if ($('body').length > 0) {
    $('body').prepend(coverBanner);
  } else {
    $.root().prepend(coverBanner);
  }

  return $.html();
}

export async function generateArchivalPdf(input: PdfGenerationInput): Promise<Buffer> {
  const executablePath = findChromiumExecutable();
  if (!executablePath) {
    throw new Error('Chromium PDF renderer is unavailable in this environment');
  }

  const printableHtml = prepareHtmlForArchivalPdf(input);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      viewport: {width: 1024, height: 1280},
      offline: true, // Strictly offline: all images/styles already embedded in selfContainedHtml
    });
    const page = await context.newPage();

    // Block any external network calls inside PDF render as defense-in-depth
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') {
        await route.continue();
      } else {
        await route.abort();
      }
    });

    await page.setContent(printableHtml, {waitUntil: 'load', timeout: 15000});

    const headerTemplate = `
      <div style="width:100%; font-size:8px; font-family: sans-serif; color:#57554E; padding:0 28px; display:flex; justify-content:space-between;">
        <span style="max-width:65%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(input.title)}</span>
        <span>Archived: ${escapeHtml(formatHumanDate(input.archivedAt))}</span>
      </div>
    `;

    const footerTemplate = `
      <div style="width:100%; font-size:8px; font-family: monospace; color:#57554E; padding:0 28px; display:flex; justify-content:space-between;">
        <span style="max-width:78%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(input.originalUrl)}</span>
        <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    `;

    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: {
        top: '52px',
        bottom: '48px',
        left: '32px',
        right: '32px',
      },
    });

    return Buffer.from(pdfBytes);
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}
