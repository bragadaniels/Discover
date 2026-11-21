import JSZip from 'jszip';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ArchiveChecksums,
  ArchiveIntegrityResult,
  ArchiveRecord,
} from '../../shared/types';
import {computeSha256, resolveSafeArchiveFilePath} from './archive_security';

export interface ArchiveManifestEntry {
  archiveUid: string;
  versionNumber: number;
  title: string;
  originalUrl: string;
  archivedAt: string;
  status: string;
  completeness: number;
  files: Array<{
    format: keyof ArchiveChecksums;
    relativePath: string;
    size: number;
    sha256: string;
  }>;
}

export interface ArchiveExportManifest {
  format: 'discover-archive-bundle';
  formatVersion: '1.0';
  exportedAt: string;
  totalArchives: number;
  archives: ArchiveManifestEntry[];
}

export async function verifyArchiveIntegrity(
  archive: ArchiveRecord,
  archivesRoot: string
): Promise<ArchiveIntegrityResult> {
  const checks: ArchiveIntegrityResult['files'] = [];
  const entries: Array<[keyof ArchiveChecksums, string | null | undefined]> = [
    ['html', archive.filePaths.html],
    ['warc', archive.filePaths.warc],
    ['pdf', archive.filePaths.pdf],
    ['metadata', archive.filePaths.metadata],
    ['thumbnail', archive.filePaths.thumbnail],
  ];

  let allValid = true;
  for (const [format, relPath] of entries) {
    if (!relPath) continue;
    const expectedSha256 = archive.checksums[format] || null;
    try {
      const fullPath = resolveSafeArchiveFilePath(archivesRoot, relPath);
      const data = await fs.readFile(fullPath);
      const actualSha256 = computeSha256(data);
      const valid = expectedSha256 ? actualSha256 === expectedSha256 : true;
      if (!valid) allValid = false;
      checks.push({
        format,
        path: relPath,
        expectedSha256,
        actualSha256,
        exists: true,
        valid,
      });
    } catch {
      allValid = false;
      checks.push({
        format,
        path: relPath,
        expectedSha256,
        actualSha256: null,
        exists: false,
        valid: false,
      });
    }
  }

  return {
    archiveUid: archive.archiveUid,
    valid: allValid && checks.length > 0,
    checkedAt: new Date().toISOString(),
    files: checks,
  };
}

export async function buildArchivesZipPackage(
  archives: ArchiveRecord[],
  archivesRoot: string
): Promise<{zipBuffer: Buffer; manifest: ArchiveExportManifest}> {
  const zip = new JSZip();
  const manifestEntries: ArchiveManifestEntry[] = [];

  for (const archive of archives) {
    const manifestFiles: ArchiveManifestEntry['files'] = [];
    const fileCandidates: Array<[keyof ArchiveChecksums, string | null | undefined]> = [
      ['html', archive.filePaths.html],
      ['warc', archive.filePaths.warc],
      ['pdf', archive.filePaths.pdf],
      ['metadata', archive.filePaths.metadata],
      ['thumbnail', archive.filePaths.thumbnail],
    ];

    for (const [format, relPath] of fileCandidates) {
      if (!relPath) continue;
      try {
        const absPath = resolveSafeArchiveFilePath(archivesRoot, relPath);
        const buf = await fs.readFile(absPath);
        const sha256 = computeSha256(buf);
        zip.file(relPath, buf);
        manifestFiles.push({
          format,
          relativePath: relPath,
          size: buf.length,
          sha256,
        });
      } catch {
        // Skip missing file on disk without crashing entire export
      }
    }

    // Ensure metadata/<uid>.json is always present in package
    if (!manifestFiles.some((f) => f.format === 'metadata')) {
      const metaRel = path.posix.join('metadata', `${archive.archiveUid}.json`);
      const metaBuf = Buffer.from(JSON.stringify(archive, null, 2), 'utf8');
      zip.file(metaRel, metaBuf);
      manifestFiles.push({
        format: 'metadata',
        relativePath: metaRel,
        size: metaBuf.length,
        sha256: computeSha256(metaBuf),
      });
    }

    manifestEntries.push({
      archiveUid: archive.archiveUid,
      versionNumber: archive.versionNumber,
      title: archive.title,
      originalUrl: archive.originalUrl,
      archivedAt: archive.archivedAt,
      status: archive.status,
      completeness: archive.completeness,
      files: manifestFiles,
    });
  }

  const manifest: ArchiveExportManifest = {
    format: 'discover-archive-bundle',
    formatVersion: '1.0',
    exportedAt: new Date().toISOString(),
    totalArchives: manifestEntries.length,
    archives: manifestEntries,
  };

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file(
    'archives_db_backup.json',
    JSON.stringify(
      {
        exportedAt: manifest.exportedAt,
        archives,
      },
      null,
      2
    )
  );

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: {level: 6},
  });

  return {zipBuffer, manifest};
}

export interface ParsedRestoreBundle {
  manifest: ArchiveExportManifest | null;
  archives: ArchiveRecord[];
  filesByRelPath: Map<string, Buffer>;
  warnings: string[];
}

export async function parseArchiveZipBundle(zipBuffer: Buffer): Promise<ParsedRestoreBundle> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const warnings: string[] = [];
  const filesByRelPath = new Map<string, Buffer>();

  let manifest: ArchiveExportManifest | null = null;
  const manifestFile = zip.file('manifest.json');
  if (manifestFile) {
    try {
      const raw = await manifestFile.async('string');
      manifest = JSON.parse(raw) as ArchiveExportManifest;
    } catch {
      warnings.push('manifest.json could not be parsed cleanly; attempting metadata recovery.');
    }
  }

  const checksumMap = new Map<string, string>();
  if (manifest?.archives) {
    for (const entry of manifest.archives) {
      for (const f of entry.files || []) {
        if (f.relativePath && f.sha256) {
          checksumMap.set(f.relativePath.replace(/\\/g, '/'), f.sha256);
        }
      }
    }
  }

  // Extract all non-manifest archive files safely and verify SHA-256 when listed
  for (const [rawEntryPath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;
    const normalized = rawEntryPath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (
      normalized.includes('..') ||
      normalized.includes('\0') ||
      normalized === 'manifest.json' ||
      normalized === 'archives_db_backup.json'
    ) {
      continue;
    }
    const buf = await zipEntry.async('nodebuffer');
    const expectedSha = checksumMap.get(normalized);
    if (expectedSha) {
      const actual = computeSha256(buf);
      if (actual !== expectedSha) {
        throw new Error(
          `SHA-256 checksum mismatch for "${normalized}" (expected ${expectedSha.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`
        );
      }
    }
    filesByRelPath.set(normalized, buf);
  }

  // Collect archive metadata records from archives_db_backup.json or metadata/*.json
  const archiveMap = new Map<string, ArchiveRecord>();
  const dbBackupFile = zip.file('archives_db_backup.json');
  if (dbBackupFile) {
    try {
      const parsed = JSON.parse(await dbBackupFile.async('string')) as {archives?: ArchiveRecord[]};
      if (Array.isArray(parsed.archives)) {
        for (const a of parsed.archives) {
          if (a?.archiveUid) archiveMap.set(a.archiveUid, a);
        }
      }
    } catch {
      warnings.push('archives_db_backup.json invalid; falling back to per-item metadata JSON files.');
    }
  }

  for (const [relPath, buf] of filesByRelPath.entries()) {
    if (relPath.startsWith('metadata/') && relPath.endsWith('.json')) {
      try {
        const parsed = JSON.parse(buf.toString('utf8')) as ArchiveRecord;
        if (parsed?.archiveUid && !archiveMap.has(parsed.archiveUid)) {
          archiveMap.set(parsed.archiveUid, parsed);
        }
      } catch {
        warnings.push(`Skipped unreadable metadata file: ${relPath}`);
      }
    }
  }

  if (archiveMap.size === 0) {
    throw new Error('Archive backup contains no valid archive metadata records.');
  }

  return {
    manifest,
    archives: Array.from(archiveMap.values()),
    filesByRelPath,
    warnings,
  };
}
