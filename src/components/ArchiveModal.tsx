import {AlertTriangle, Archive, CheckCircle2, FileCode2, FileText, Globe, Loader2, X} from 'lucide-react';
import {useEffect, useState} from 'react';
import type {ArchiveFormat, ArchiveJobStatus, ArchiveRecord, ContentItem} from '../../shared/types';
import {api} from '../services/api';

interface ArchiveModalProps {
  isOpen: boolean;
  item: ContentItem | null;
  initialUrl?: string;
  initialTitle?: string;
  existingBadge?: {archiveUid: string; formats: ArchiveFormat[]; status: string} | null;
  onClose: () => void;
  onArchiveComplete: (archive: ArchiveRecord) => void;
  onOpenArchiveViewer: (archive: ArchiveRecord, initialTab?: 'html' | 'warc' | 'pdf' | 'details') => void;
  onOpenArchiveLibrary: () => void;
}

export function ArchiveModal({
  isOpen,
  item,
  initialUrl = '',
  initialTitle = '',
  existingBadge,
  onClose,
  onArchiveComplete,
  onOpenArchiveViewer,
  onOpenArchiveLibrary,
}: ArchiveModalProps) {
  const [urlInput, setUrlInput] = useState(initialUrl);
  const [titleInput, setTitleInput] = useState(initialTitle);
  const [selectedFormats, setSelectedFormats] = useState<ArchiveFormat[]>(['html']);
  const [job, setJob] = useState<ArchiveJobStatus | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setUrlInput(item?.originalUrl || initialUrl);
    setTitleInput(item?.title || initialTitle);
    setSelectedFormats(['html']);
    setJob(null);
    setSubmitError(null);
    setIsSubmitting(false);
  }, [isOpen, item, initialUrl, initialTitle]);

  // Poll job status until completed or failed
  useEffect(() => {
    if (!job || job.stage === 'completed' || job.stage === 'failed') return;

    const timer = setInterval(() => {
      void api
        .getArchiveJob(job.jobId)
        .then((updated) => {
          setJob(updated);
          if (updated.stage === 'completed' && updated.archive) {
            onArchiveComplete(updated.archive);
          } else if (updated.stage === 'failed' && updated.archive) {
            onArchiveComplete(updated.archive);
          }
        })
        .catch(() => {
          // Keep polling on transient network blip
        });
    }, 450);

    return () => clearInterval(timer);
  }, [job, onArchiveComplete]);

  if (!isOpen) return null;

  const toggleFormat = (fmt: ArchiveFormat) => {
    setSelectedFormats((prev) => {
      if (prev.includes(fmt)) {
        if (prev.length === 1) return prev; // Keep at least one format selected
        return prev.filter((f) => f !== fmt);
      }
      return [...prev, fmt];
    });
  };

  const selectAllFormats = () => {
    setSelectedFormats(['html', 'warc', 'pdf']);
  };

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    const targetUrl = (item?.originalUrl || urlInput).trim();
    if (!targetUrl) {
      setSubmitError('Please enter a valid http:// or https:// URL.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const started = await api.startArchive({
        contentItemId: item?.id ?? null,
        url: targetUrl,
        title: (item?.title || titleInput).trim() || undefined,
        formats: selectedFormats,
        categoryName: item?.associatedTags?.[0]?.categoryName ?? null,
        tagNames: item?.associatedTags?.map((t) => t.tagName) ?? [],
      });
      setJob(started);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Unable to start archival job.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const isRunning = Boolean(job && job.stage !== 'completed' && job.stage !== 'failed');
  const finishedArchive = job?.archive || null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="archive-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1B1B19]/60 dark:bg-black/75 p-4"
    >
      <div className="w-full max-w-xl bg-[#F6F4EF] dark:bg-[#1A1B19] border border-[#DDD8CE] dark:border-[#2B2C28] shadow-xl">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#DDD8CE] dark:border-[#2B2C28] flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Archive className="w-4 h-4 text-[#1E3A5F] dark:text-[#6B92C4] shrink-0" aria-hidden="true" />
            <h2
              id="archive-modal-title"
              className="font-serif text-lg font-semibold text-[#1B1B19] dark:text-[#EAE8E1] truncate"
            >
              Save Offline / Long-Term Archive
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close archive dialog"
            className="p-1 text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={(e) => void handleStart(e)} className="p-5 space-y-5">
          {/* Target Item or Custom URL */}
          {item ? (
            <div className="pb-4 border-b border-[#DDD8CE] dark:border-[#2B2C28]">
              <p className="font-serif text-base font-semibold text-[#1B1B19] dark:text-[#EAE8E1] leading-snug">
                {item.title}
              </p>
              <p className="mt-1 text-xs font-mono text-[#737067] dark:text-[#8E8A80] break-all">
                {item.originalUrl}
              </p>
              {existingBadge && (
                <p className="mt-2 text-xs text-[#3F5E45] dark:text-[#8FB896]">
                  Previously archived ({existingBadge.formats.map((f) => f.toUpperCase()).join(' · ')}).
                  Archiving again creates a new preserved version without overwriting prior captures.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3 pb-4 border-b border-[#DDD8CE] dark:border-[#2B2C28]">
              <div>
                <label
                  htmlFor="archive-custom-url"
                  className="block text-xs font-medium text-[#57554E] dark:text-[#A8A49B] mb-1"
                >
                  Webpage URL
                </label>
                <input
                  id="archive-custom-url"
                  type="url"
                  required
                  placeholder="https://example.org/article"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  disabled={isRunning}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none focus:border-[#1E3A5F]"
                />
              </div>
              <div>
                <label
                  htmlFor="archive-custom-title"
                  className="block text-xs font-medium text-[#57554E] dark:text-[#A8A49B] mb-1"
                >
                  Title (optional — auto-detected from page if blank)
                </label>
                <input
                  id="archive-custom-title"
                  type="text"
                  placeholder="Optional title override"
                  value={titleInput}
                  onChange={(e) => setTitleInput(e.target.value)}
                  disabled={isRunning}
                  className="w-full px-3 py-2 text-sm bg-white dark:bg-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none focus:border-[#1E3A5F]"
                />
              </div>
            </div>
          )}

          {/* Archival Format Selection */}
          <div>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <span className="text-xs font-medium uppercase tracking-wider text-[#57554E] dark:text-[#A8A49B]">
                Archival Formats
              </span>
              <div className="flex items-center gap-3 text-xs">
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => setSelectedFormats(['html'])}
                  className="text-[#57554E] dark:text-[#A8A49B] hover:underline disabled:opacity-50 whitespace-nowrap"
                >
                  HTML Only (Default)
                </button>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={selectAllFormats}
                  className="text-[#1E3A5F] dark:text-[#9BBCE8] font-medium hover:underline disabled:opacity-50 whitespace-nowrap"
                >
                  Select All Formats
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label
                className={`flex items-start gap-3 p-3 border cursor-pointer transition-colors ${
                  selectedFormats.includes('html')
                    ? 'border-[#1E3A5F] dark:border-[#6B92C4] bg-[#EFECE4]/70 dark:bg-[#222421]'
                    : 'border-[#DDD8CE] dark:border-[#2B2C28]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedFormats.includes('html')}
                  onChange={() => toggleFormat('html')}
                  disabled={isRunning}
                  className="mt-0.5 accent-[#1E3A5F]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#1B1B19] dark:text-[#EAE8E1]">
                    <FileCode2 className="w-3.5 h-3.5 text-[#1E3A5F] dark:text-[#9BBCE8]" aria-hidden="true" />
                    <span>Self-Contained HTML</span>
                    <span className="text-[11px] font-mono text-[#737067] dark:text-[#8E8A80]">
                      · Default · Offline reading
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[#57554E] dark:text-[#A8A49B]">
                    Embeds rendered DOM, CSS stylesheets, fonts, and images directly as data URIs for standalone offline viewing.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 border cursor-pointer transition-colors ${
                  selectedFormats.includes('warc')
                    ? 'border-[#1E3A5F] dark:border-[#6B92C4] bg-[#EFECE4]/70 dark:bg-[#222421]'
                    : 'border-[#DDD8CE] dark:border-[#2B2C28]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedFormats.includes('warc')}
                  onChange={() => toggleFormat('warc')}
                  disabled={isRunning}
                  className="mt-0.5 accent-[#1E3A5F]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#1B1B19] dark:text-[#EAE8E1]">
                    <Globe className="w-3.5 h-3.5 text-[#3F5E45] dark:text-[#8FB896]" aria-hidden="true" />
                    <span>WARC 1.1 (.warc.gz)</span>
                    <span className="text-[11px] font-mono text-[#737067] dark:text-[#8E8A80]">
                      · Technical preservation
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[#57554E] dark:text-[#A8A49B]">
                    ISO 28500 web archive recording full HTTP requests, responses, headers, timestamps, and local replay support.
                  </p>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 p-3 border cursor-pointer transition-colors ${
                  selectedFormats.includes('pdf')
                    ? 'border-[#1E3A5F] dark:border-[#6B92C4] bg-[#EFECE4]/70 dark:bg-[#222421]'
                    : 'border-[#DDD8CE] dark:border-[#2B2C28]'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedFormats.includes('pdf')}
                  onChange={() => toggleFormat('pdf')}
                  disabled={isRunning}
                  className="mt-0.5 accent-[#1E3A5F]"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-[#1B1B19] dark:text-[#EAE8E1]">
                    <FileText className="w-3.5 h-3.5 text-[#8C4A27] dark:text-[#E0A37D]" aria-hidden="true" />
                    <span>PDF Document</span>
                    <span className="text-[11px] font-mono text-[#737067] dark:text-[#8E8A80]">
                      · Document copy
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[#57554E] dark:text-[#A8A49B]">
                    Generates a multi-page printable PDF with original URL, archival date, publication metadata, and page numbers.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {submitError && (
            <div
              role="alert"
              className="p-3 border border-[#7F2929]/40 bg-[#7F2929]/5 text-xs text-[#7F2929] dark:text-[#D98A8A]"
            >
              {submitError}
            </div>
          )}

          {/* Live Job Progress / Completion Panel */}
          {job && (
            <div className="p-3.5 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/60 dark:bg-[#141514] space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 font-medium text-[#1B1B19] dark:text-[#EAE8E1]">
                  {isRunning ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#1E3A5F]" aria-hidden="true" />
                  ) : job.stage === 'failed' ? (
                    <AlertTriangle className="w-3.5 h-3.5 text-[#7F2929]" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#3F5E45]" aria-hidden="true" />
                  )}
                  <span>{job.message}</span>
                </span>
                <span className="font-mono tabular-nums text-[#737067] dark:text-[#8E8A80]">
                  {job.progress}%
                </span>
              </div>

              <div className="h-1.5 w-full bg-[#DDD8CE] dark:bg-[#2B2C28] overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    job.stage === 'failed'
                      ? 'bg-[#7F2929]'
                      : job.stage === 'completed'
                        ? 'bg-[#3F5E45]'
                        : 'bg-[#1E3A5F]'
                  }`}
                  style={{width: `${job.progress}%`}}
                />
              </div>

              {finishedArchive && (
                <div className="pt-1 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-[#57554E] dark:text-[#A8A49B] tabular-nums">
                    <span>Status: {finishedArchive.status.toUpperCase()}</span>
                    <span>·</span>
                    <span>Completeness: {finishedArchive.completeness}%</span>
                    <span>·</span>
                    <span>Version: v{finishedArchive.versionNumber}</span>
                    <span>·</span>
                    <span>
                      Formats:{' '}
                      {finishedArchive.availableFormats.length > 0
                        ? finishedArchive.availableFormats.map((f) => f.toUpperCase()).join(', ')
                        : 'None'}
                    </span>
                  </div>

                  {finishedArchive.captureDetails.warnings.length > 0 && (
                    <p className="text-[11px] text-[#8C4A27] dark:text-[#E0A37D]">
                      Note: {finishedArchive.captureDetails.warnings[0]}
                    </p>
                  )}

                  <div className="pt-1 flex flex-wrap items-center gap-2">
                    {finishedArchive.availableFormats.includes('html') && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenArchiveViewer(finishedArchive, 'html');
                        }}
                        className="px-2.5 py-1 text-xs font-medium bg-[#1E3A5F] text-[#F6F4EF] whitespace-nowrap"
                      >
                        View Offline HTML
                      </button>
                    )}
                    {finishedArchive.availableFormats.includes('warc') && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenArchiveViewer(finishedArchive, 'warc');
                        }}
                        className="px-2.5 py-1 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] whitespace-nowrap"
                      >
                        Inspect / Replay WARC
                      </button>
                    )}
                    {finishedArchive.availableFormats.includes('pdf') && (
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenArchiveViewer(finishedArchive, 'pdf');
                        }}
                        className="px-2.5 py-1 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] whitespace-nowrap"
                      >
                        Open PDF
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenArchiveLibrary();
                      }}
                      className="px-2.5 py-1 text-xs text-[#1E3A5F] dark:text-[#9BBCE8] underline underline-offset-2 whitespace-nowrap"
                    >
                      Open Archive Library
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-2 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] whitespace-nowrap"
            >
              {finishedArchive ? 'Close' : 'Cancel'}
            </button>
            {!finishedArchive && (
              <button
                type="submit"
                disabled={isSubmitting || isRunning}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 disabled:opacity-60 whitespace-nowrap"
              >
                <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{isRunning ? 'Archiving…' : 'Archive Now'}</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
