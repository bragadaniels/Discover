import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Globe,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {useEffect, useState} from 'react';
import type {
  ArchiveIntegrityResult,
  ArchiveJobStatus,
  ArchiveRecord,
  WarcRecordSummary,
} from '../../shared/types';
import {api} from '../services/api';

export type ArchiveViewerTab = 'html' | 'warc' | 'pdf' | 'details';

interface ArchiveViewerModalProps {
  archive: ArchiveRecord | null;
  initialTab?: ArchiveViewerTab;
  onClose: () => void;
  onNewVersionCreated: (archive: ArchiveRecord) => void;
}

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ArchiveViewerModal({
  archive,
  initialTab = 'html',
  onClose,
  onNewVersionCreated,
}: ArchiveViewerModalProps) {
  const [activeTab, setActiveTab] = useState<ArchiveViewerTab>(initialTab);
  const [warcMode, setWarcMode] = useState<'replay' | 'records'>('replay');
  const [warcRecords, setWarcRecords] = useState<WarcRecordSummary[] | null>(null);
  const [warcLimitations, setWarcLimitations] = useState<string[]>([]);
  const [loadingWarc, setLoadingWarc] = useState(false);
  const [warcError, setWarcError] = useState<string | null>(null);

  const [integrity, setIntegrity] = useState<ArchiveIntegrityResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [retryJob, setRetryJob] = useState<ArchiveJobStatus | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    if (!archive) return;
    const hasInitial =
      initialTab === 'details' ||
      (initialTab === 'html' && archive.availableFormats.includes('html')) ||
      (initialTab === 'warc' && archive.availableFormats.includes('warc')) ||
      (initialTab === 'pdf' && archive.availableFormats.includes('pdf'));

    if (hasInitial) {
      setActiveTab(initialTab);
    } else if (archive.availableFormats.includes('html')) {
      setActiveTab('html');
    } else if (archive.availableFormats.includes('warc')) {
      setActiveTab('warc');
    } else if (archive.availableFormats.includes('pdf')) {
      setActiveTab('pdf');
    } else {
      setActiveTab('details');
    }
    setWarcRecords(null);
    setWarcError(null);
    setIntegrity(null);
    setVerifyError(null);
    setRetryJob(null);
    setRetrying(false);
  }, [archive, initialTab]);

  // Load WARC inspection records when opening WARC tab
  useEffect(() => {
    if (!archive || activeTab !== 'warc' || !archive.availableFormats.includes('warc')) return;
    if (warcRecords !== null) return;

    let cancelled = false;
    setLoadingWarc(true);
    setWarcError(null);
    void api
      .inspectWarc(archive.archiveUid)
      .then((res) => {
        if (!cancelled) {
          setWarcRecords(res.records);
          setWarcLimitations(res.limitations);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setWarcError(err instanceof Error ? err.message : 'Unable to inspect WARC archive');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingWarc(false);
      });

    return () => {
      cancelled = true;
    };
  }, [archive, activeTab, warcRecords]);

  // Poll retry job when user triggers Capture New Version
  useEffect(() => {
    if (!retryJob || retryJob.stage === 'completed' || retryJob.stage === 'failed') return;
    const timer = setInterval(() => {
      void api
        .getArchiveJob(retryJob.jobId)
        .then((updated) => {
          setRetryJob(updated);
          if ((updated.stage === 'completed' || updated.stage === 'failed') && updated.archive) {
            setRetrying(false);
            onNewVersionCreated(updated.archive);
          }
        })
        .catch(() => {
          // Continue polling
        });
    }, 450);
    return () => clearInterval(timer);
  }, [retryJob, onNewVersionCreated]);

  if (!archive) return null;

  const handleVerifyIntegrity = async () => {
    setVerifying(true);
    setVerifyError(null);
    try {
      const result = await api.verifyArchiveIntegrity(archive.archiveUid);
      setIntegrity(result);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setVerifying(false);
    }
  };

  const handleRetryNewVersion = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const job = await api.retryArchive(
        archive.archiveUid,
        archive.captureDetails.requestedFormats.length > 0
          ? archive.captureDetails.requestedFormats
          : ['html']
      );
      setRetryJob(job);
    } catch {
      setRetrying(false);
    }
  };

  const totalBytes = Object.values(archive.fileSizes).reduce(
    (sum, val) => sum + (typeof val === 'number' ? val : 0),
    0
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-viewer-title"
      className="fixed inset-0 z-50 flex flex-col bg-[#F6F4EF] dark:bg-[#141514] text-[#1B1B19] dark:text-[#EAE8E1]"
    >
      {/* Top Reader Masthead */}
      <div className="border-b border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/70 dark:bg-[#1A1B19] px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-mono text-[#737067] dark:text-[#8E8A80] tabular-nums">
            <span className="font-medium text-[#1E3A5F] dark:text-[#9BBCE8]">
              OFFLINE ARCHIVE · v{archive.versionNumber}
            </span>
            <span>·</span>
            <span>Archived {formatDate(archive.archivedAt)}</span>
            <span>·</span>
            <span>
              Status: {archive.status.replace('_', '-').toUpperCase()} ({archive.completeness}%)
            </span>
            <span>·</span>
            <span>{formatBytes(totalBytes)}</span>
          </div>
          <h2
            id="archive-viewer-title"
            className="mt-0.5 font-serif text-lg font-semibold truncate text-[#1B1B19] dark:text-[#EAE8E1]"
          >
            {archive.title}
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <a
            href={archive.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-[#DDD8CE] dark:border-[#2B2C28] text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] whitespace-nowrap"
          >
            <span>Original URL</span>
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
          </a>

          <a
            href={api.getArchiveExportUrl(archive.archiveUid)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#F6F4EF] dark:hover:bg-[#141514] whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export ZIP</span>
          </a>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close archive viewer"
            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-[#1B1B19] dark:bg-[#EAE8E1] text-[#F6F4EF] dark:text-[#141514] whitespace-nowrap"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Close</span>
          </button>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="border-b border-[#DDD8CE] dark:border-[#2B2C28] px-4 sm:px-6 flex items-center gap-6 overflow-x-auto bg-[#F6F4EF] dark:bg-[#141514]">
        {archive.availableFormats.includes('html') && (
          <button
            type="button"
            onClick={() => setActiveTab('html')}
            className={`py-2.5 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'html'
                ? 'border-[#1E3A5F] dark:border-[#6B92C4] text-[#1B1B19] dark:text-[#EAE8E1]'
                : 'border-transparent text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19]'
            }`}
          >
            <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Offline HTML Reader</span>
          </button>
        )}

        {archive.availableFormats.includes('warc') && (
          <button
            type="button"
            onClick={() => setActiveTab('warc')}
            className={`py-2.5 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'warc'
                ? 'border-[#1E3A5F] dark:border-[#6B92C4] text-[#1B1B19] dark:text-[#EAE8E1]'
                : 'border-transparent text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19]'
            }`}
          >
            <Globe className="w-3.5 h-3.5" aria-hidden="true" />
            <span>WARC 1.1 Inspector & Replay</span>
          </button>
        )}

        {archive.availableFormats.includes('pdf') && (
          <button
            type="button"
            onClick={() => setActiveTab('pdf')}
            className={`py-2.5 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'pdf'
                ? 'border-[#1E3A5F] dark:border-[#6B92C4] text-[#1B1B19] dark:text-[#EAE8E1]'
                : 'border-transparent text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19]'
            }`}
          >
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            <span>PDF Document</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveTab('details')}
          className={`py-2.5 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 whitespace-nowrap ${
            activeTab === 'details'
              ? 'border-[#1E3A5F] dark:border-[#6B92C4] text-[#1B1B19] dark:text-[#EAE8E1]'
              : 'border-transparent text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19]'
          }`}
        >
          <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Capture Details & Integrity</span>
        </button>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 min-h-0 flex flex-col">
        {activeTab === 'html' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-4 sm:px-6 py-1.5 border-b border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/40 dark:bg-[#1C1D1B] flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-[#57554E] dark:text-[#A8A49B]">
              <span>
                Sandboxed offline rendering · Active scripts stripped · Embedded CSS/fonts/images
              </span>
              <a
                href={api.getArchiveViewUrl(archive.archiveUid, true)}
                className="text-[#1E3A5F] dark:text-[#9BBCE8] hover:underline whitespace-nowrap"
              >
                Download .html ({formatBytes(archive.fileSizes.html)})
              </a>
            </div>
            <iframe
              title={`Offline HTML Archive: ${archive.title}`}
              src={api.getArchiveViewUrl(archive.archiveUid)}
              sandbox=""
              className="flex-1 w-full bg-white border-0"
            />
          </div>
        )}

        {activeTab === 'warc' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-4 sm:px-6 py-2 border-b border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/40 dark:bg-[#1C1D1B] flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWarcMode('replay')}
                  className={`px-3 py-1 text-xs font-medium border whitespace-nowrap ${
                    warcMode === 'replay'
                      ? 'bg-[#1E3A5F] text-[#F6F4EF] border-[#1E3A5F]'
                      : 'border-[#DDD8CE] dark:border-[#2B2C28] text-[#57554E] dark:text-[#A8A49B]'
                  }`}
                >
                  Local Offline Replay
                </button>
                <button
                  type="button"
                  onClick={() => setWarcMode('records')}
                  className={`px-3 py-1 text-xs font-medium border whitespace-nowrap ${
                    warcMode === 'records'
                      ? 'bg-[#1E3A5F] text-[#F6F4EF] border-[#1E3A5F]'
                      : 'border-[#DDD8CE] dark:border-[#2B2C28] text-[#57554E] dark:text-[#A8A49B]'
                  }`}
                >
                  WARC 1.1 Records ({warcRecords ? warcRecords.length : '…'})
                </button>
              </div>
              <a
                href={api.getArchiveWarcUrl(archive.archiveUid)}
                className="inline-flex items-center gap-1 text-xs font-mono text-[#1E3A5F] dark:text-[#9BBCE8] hover:underline whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Download .warc.gz ({formatBytes(archive.fileSizes.warc)})</span>
              </a>
            </div>

            {warcMode === 'replay' ? (
              <iframe
                title={`WARC Offline Replay: ${archive.title}`}
                src={api.getArchiveWarcReplayUrl(archive.archiveUid)}
                sandbox=""
                className="flex-1 w-full bg-white border-0"
              />
            ) : (
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 max-w-6xl mx-auto w-full space-y-6">
                {loadingWarc && (
                  <div className="flex items-center gap-2 text-xs text-[#57554E]">
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Parsing WARC 1.1 records…</span>
                  </div>
                )}
                {warcError && (
                  <p className="text-xs text-[#7F2929] dark:text-[#D98A8A]">{warcError}</p>
                )}
                {warcLimitations.length > 0 && (
                  <div className="p-4 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/60 dark:bg-[#1C1D1B]">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-[#57554E] dark:text-[#A8A49B]">
                      Documented WARC Preservation Scope & Limitations
                    </h3>
                    <ul className="mt-2 space-y-1 text-xs text-[#57554E] dark:text-[#A8A49B] list-disc pl-4">
                      {warcLimitations.map((lim) => (
                        <li key={lim}>{lim}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {warcRecords && (
                  <div className="border border-[#DDD8CE] dark:border-[#2B2C28] overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-[#EFECE4] dark:bg-[#1C1D1B] text-[#57554E] dark:text-[#A8A49B] font-mono">
                        <tr>
                          <th className="px-3 py-2 border-b border-[#DDD8CE] dark:border-[#2B2C28]">Type</th>
                          <th className="px-3 py-2 border-b border-[#DDD8CE] dark:border-[#2B2C28]">HTTP</th>
                          <th className="px-3 py-2 border-b border-[#DDD8CE] dark:border-[#2B2C28]">MIME</th>
                          <th className="px-3 py-2 border-b border-[#DDD8CE] dark:border-[#2B2C28] text-right">Bytes</th>
                          <th className="px-3 py-2 border-b border-[#DDD8CE] dark:border-[#2B2C28]">Target URI</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#DDD8CE] dark:divide-[#2B2C28] font-mono tabular-nums">
                        {warcRecords.map((rec, idx) => (
                          <tr key={`${rec.recordId || idx}`} className="hover:bg-[#EFECE4]/40 dark:hover:bg-[#1C1D1B]/60">
                            <td className="px-3 py-2 font-medium whitespace-nowrap">{rec.warcType}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{rec.httpStatus ?? '—'}</td>
                            <td className="px-3 py-2 whitespace-nowrap">{rec.contentType || '—'}</td>
                            <td className="px-3 py-2 text-right whitespace-nowrap">
                              {rec.payloadBytes.toLocaleString()}
                            </td>
                            <td className="px-3 py-2 break-all text-[#57554E] dark:text-[#A8A49B]">
                              {rec.targetUri || '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'pdf' && (
          <div className="flex-1 flex flex-col min-h-0">
            <div className="px-4 sm:px-6 py-1.5 border-b border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/40 dark:bg-[#1C1D1B] flex items-center justify-between gap-2 text-[11px] font-mono text-[#57554E] dark:text-[#A8A49B]">
              <span>Archival A4 PDF · Provenance banner & offline citation footer</span>
              <a
                href={api.getArchivePdfUrl(archive.archiveUid, true)}
                className="text-[#1E3A5F] dark:text-[#9BBCE8] hover:underline whitespace-nowrap"
              >
                Download .pdf ({formatBytes(archive.fileSizes.pdf)})
              </a>
            </div>
            <iframe
              title={`PDF Archive: ${archive.title}`}
              src={api.getArchivePdfUrl(archive.archiveUid)}
              className="flex-1 w-full bg-[#EFECE4] border-0"
            />
          </div>
        )}

        {activeTab === 'details' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            <div className="max-w-4xl mx-auto space-y-6">
              {/* Actions Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#DDD8CE] dark:border-[#2B2C28]">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleVerifyIntegrity()}
                    disabled={verifying}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#1E3A5F] dark:border-[#6B92C4] text-[#1E3A5F] dark:text-[#9BBCE8] hover:bg-[#1E3A5F]/10 disabled:opacity-60 whitespace-nowrap"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{verifying ? 'Verifying SHA-256…' : 'Verify SHA-256 Integrity'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleRetryNewVersion()}
                    disabled={retrying}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span>{retrying ? 'Capturing New Version…' : 'Capture New Version'}</span>
                  </button>
                </div>

                {retryJob && (
                  <span className="text-xs font-mono text-[#3F5E45] dark:text-[#8FB896]">
                    {retryJob.message} ({retryJob.progress}%)
                  </span>
                )}
              </div>

              {verifyError && (
                <p className="text-xs text-[#7F2929] dark:text-[#D98A8A]">{verifyError}</p>
              )}

              {integrity && (
                <div
                  className={`p-4 border text-xs ${
                    integrity.valid
                      ? 'border-[#3F5E45]/50 bg-[#3F5E45]/5'
                      : 'border-[#7F2929]/50 bg-[#7F2929]/5'
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    {integrity.valid ? (
                      <CheckCircle2 className="w-4 h-4 text-[#3F5E45]" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-[#7F2929]" aria-hidden="true" />
                    )}
                    <span>
                      {integrity.valid
                        ? 'All stored archive files passed SHA-256 checksum verification.'
                        : 'One or more archive files failed SHA-256 checksum verification.'}
                    </span>
                  </div>
                  <div className="mt-2 space-y-1 font-mono text-[11px] tabular-nums">
                    {integrity.files.map((f) => (
                      <div key={f.format} className="flex items-center justify-between gap-2">
                        <span>
                          {String(f.format).toUpperCase()} ({f.path})
                        </span>
                        <span className={f.valid ? 'text-[#3F5E45]' : 'text-[#7F2929]'}>
                          {f.valid ? 'VERIFIED' : f.exists ? 'CHECKSUM MISMATCH' : 'MISSING'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs border-b border-[#DDD8CE] dark:border-[#2B2C28] pb-5">
                <div>
                  <span className="text-[#737067] dark:text-[#8E8A80] block">Archive UID</span>
                  <span className="font-mono">{archive.archiveUid} (v{archive.versionNumber})</span>
                </div>
                <div>
                  <span className="text-[#737067] dark:text-[#8E8A80] block">Original URL</span>
                  <span className="font-mono break-all">{archive.originalUrl}</span>
                </div>
                <div>
                  <span className="text-[#737067] dark:text-[#8E8A80] block">Publisher / Author</span>
                  <span>
                    {archive.publisher || 'Unknown'}
                    {archive.author ? ` · ${archive.author}` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-[#737067] dark:text-[#8E8A80] block">Publication / Archival Dates</span>
                  <span className="font-mono tabular-nums">
                    Published: {formatDate(archive.publishedAt)} · Archived: {formatDate(archive.archivedAt)}
                  </span>
                </div>
                <div>
                  <span className="text-[#737067] dark:text-[#8E8A80] block">Category & Tags</span>
                  <span>
                    {archive.categoryName || 'Uncategorized'}
                    {archive.tagNames.length > 0 ? ` · ${archive.tagNames.join(', ')}` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-[#737067] dark:text-[#8E8A80] block">Capture Engine</span>
                  <span className="font-mono tabular-nums">
                    {archive.captureDetails.captureMethod} · HTTP {archive.captureDetails.httpStatus ?? '—'} ·{' '}
                    {archive.captureDetails.resourcesCaptured} resources · {archive.captureDetails.durationMs}ms
                  </span>
                </div>
              </div>

              {/* Warnings & Limitations */}
              {(archive.captureDetails.warnings.length > 0 ||
                archive.captureDetails.limitations.length > 0) && (
                <div className="space-y-3 border-b border-[#DDD8CE] dark:border-[#2B2C28] pb-5 text-xs">
                  {archive.captureDetails.warnings.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-[#8C4A27] dark:text-[#E0A37D]">
                        Capture Warnings
                      </h3>
                      <ul className="mt-1 list-disc pl-4 space-y-0.5 text-[#57554E] dark:text-[#A8A49B]">
                        {archive.captureDetails.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {archive.captureDetails.limitations.length > 0 && (
                    <div>
                      <h3 className="font-semibold text-[#57554E] dark:text-[#A8A49B]">
                        Known Archival Limitations
                      </h3>
                      <ul className="mt-1 list-disc pl-4 space-y-0.5 text-[#57554E] dark:text-[#A8A49B]">
                        {archive.captureDetails.limitations.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {/* Stored Files & SHA-256 Checksums */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[#57554E] dark:text-[#A8A49B] mb-2">
                  Stored Files & SHA-256 Checksums
                </h3>
                <div className="border border-[#DDD8CE] dark:border-[#2B2C28] divide-y divide-[#DDD8CE] dark:divide-[#2B2C28] text-xs font-mono tabular-nums">
                  {(['html', 'warc', 'pdf', 'metadata', 'thumbnail'] as const).map((kind) => {
                    const rel = archive.filePaths[kind];
                    if (!rel) return null;
                    return (
                      <div key={kind} className="p-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-semibold uppercase mr-2">{kind}</span>
                          <span className="text-[#57554E] dark:text-[#A8A49B]">{rel}</span>
                        </div>
                        <div className="text-right">
                          <span className="mr-3">{formatBytes(archive.fileSizes[kind])}</span>
                          <span className="text-[11px] text-[#737067] dark:text-[#8E8A80] break-all">
                            sha256:{archive.checksums[kind]?.slice(0, 16) || '—'}…
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
