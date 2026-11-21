import {
  AlertTriangle,
  Archive,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Globe,
  Info,
  NotebookPen,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {
  ArchiveFormat,
  ArchiveRecord,
  ArchiveRestoreResponse,
  ArchiveStatus,
} from '../../shared/types';
import {api} from '../services/api';
import type {ArchiveViewerTab} from './ArchiveViewerModal';
import {InlineNoteDrawer} from './InlineNoteDrawer';
import {SearchHighlightText} from './SearchHighlightText';

interface ArchiveLibraryViewProps {
  onOpenArchiveUrlModal: (url?: string) => void;
  onOpenViewer: (archive: ArchiveRecord, tab: ArchiveViewerTab) => void;
  onArchiveDeletedOrRestored: () => void;
  refreshToken: number;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatShortDate(iso: string | null): string {
  if (!iso) return 'Undated';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Undated';
  return d.toLocaleDateString('en-US', {year: 'numeric', month: 'short', day: 'numeric'});
}

function statusLabel(status: ArchiveStatus): {text: string; cls: string} {
  if (status === 'complete') {
    return {text: 'Complete', cls: 'text-[#3F5E45] dark:text-[#8FB896]'};
  }
  if (status === 'partial') {
    return {text: 'Partial', cls: 'text-[#8C4A27] dark:text-[#E0A37D]'};
  }
  if (status === 'text_only') {
    return {text: 'Text-Only', cls: 'text-[#8C4A27] dark:text-[#E0A37D]'};
  }
  return {text: 'Failed', cls: 'text-[#7F2929] dark:text-[#D98A8A]'};
}

export function ArchiveLibraryView({
  onOpenArchiveUrlModal,
  onOpenViewer,
  onArchiveDeletedOrRestored,
  refreshToken,
}: ArchiveLibraryViewProps) {
  const [archives, setArchives] = useState<ArchiveRecord[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [totalDiskBytes, setTotalDiskBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [formatFilter, setFormatFilter] = useState<ArchiveFormat | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<ArchiveStatus | 'all'>('all');
  const [dateRange, setDateRange] = useState<'all' | 'today' | '7d' | '30d'>('all');
  const [hasNotesOnly, setHasNotesOnly] = useState(false);
  const [sort, setSort] = useState<
    'archived_desc' | 'archived_asc' | 'published_desc' | 'published_asc'
  >('archived_desc');

  const [openNoteUid, setOpenNoteUid] = useState<string | null>(null);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState<string | null>(null);
  const [customUrlInput, setCustomUrlInput] = useState('');

  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const [pendingRestoreFile, setPendingRestoreFile] = useState<File | null>(null);
  const [restoreConflictResponse, setRestoreConflictResponse] =
    useState<ArchiveRestoreResponse | null>(null);
  const [restoreNotice, setRestoreNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [restoring, setRestoring] = useState(false);

  const loadLibrary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listArchives({
        search,
        category: categoryFilter,
        tag: tagFilter,
        format: formatFilter,
        status: statusFilter,
        dateRange,
        hasNotes: hasNotesOnly,
        sort,
      });
      setArchives(res.archives);
      setCategories(res.categories);
      setTags(res.tags);
      setTotalDiskBytes(res.totalDiskBytes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load archive library');
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter, tagFilter, formatFilter, statusFilter, dateRange, hasNotesOnly, sort]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadLibrary();
    }, search ? 150 : 0);
    return () => clearTimeout(timer);
  }, [loadLibrary, refreshToken, search]);

  const handleDelete = async (uid: string) => {
    try {
      await api.deleteArchive(uid);
      setConfirmDeleteUid(null);
      await loadLibrary();
      onArchiveDeletedOrRestored();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete archive');
    }
  };

  const handleSaveArchiveNote = async (arc: ArchiveRecord, noteText: string) => {
    const saved = await api.upsertNote({
      archiveUid: arc.archiveUid,
      canonicalUrl: arc.canonicalUrl,
      contentItemId: arc.contentItemId,
      noteText,
    });
    setArchives((prev) => {
      const updated = prev.map((entry) =>
        entry.archiveUid === arc.archiveUid
          ? {
              ...entry,
              note: saved?.noteText ?? null,
              noteUpdatedAt: saved?.updatedAt ?? null,
            }
          : entry
      );
      return hasNotesOnly && !saved ? updated.filter((e) => e.archiveUid !== arc.archiveUid) : updated;
    });
  };

  const handleRestoreFileSelected = async (file: File | null, overwriteConfirmed = false) => {
    if (!file) return;
    setRestoring(true);
    setRestoreNotice(null);
    try {
      const result = await api.restoreArchivesZip(file, overwriteConfirmed);
      if (result.requiresConfirmation) {
        setPendingRestoreFile(file);
        setRestoreConflictResponse(result);
      } else {
        setPendingRestoreFile(null);
        setRestoreConflictResponse(null);
        setRestoreNotice({
          type: 'success',
          message: `Restore complete: ${result.restored} restored, ${result.overwritten} overwritten${
            result.warnings.length > 0 ? ` (${result.warnings[0]})` : ''
          }.`,
        });
        await loadLibrary();
        onArchiveDeletedOrRestored();
      }
    } catch (err) {
      setRestoreNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to restore ZIP backup.',
      });
    } finally {
      setRestoring(false);
      if (restoreInputRef.current && !overwriteConfirmed) {
        restoreInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 pt-5 pb-16 space-y-5">
      {/* Header */}
      <div className="pb-4 border-b border-[#DDD8CE] dark:border-[#2B2C28] flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-[#1B1B19] dark:text-[#EAE8E1]">
            Offline Archive Library
          </h1>
          <p className="mt-1 text-xs font-mono text-[#737067] dark:text-[#8E8A80] tabular-nums">
            {archives.length} {archives.length === 1 ? 'preserved item' : 'preserved items'} ·{' '}
            {formatBytes(totalDiskBytes)} stored · Self-contained HTML, WARC 1.1 & PDF
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <a
            href={api.getArchiveExportAllUrl()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Export All ZIP</span>
          </a>

          <input
            ref={restoreInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] || null;
              void handleRestoreFileSelected(file, false);
            }}
          />
          <button
            type="button"
            disabled={restoring}
            onClick={() => restoreInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] disabled:opacity-60 whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{restoring ? 'Restoring…' : 'Restore ZIP Backup'}</span>
          </button>
        </div>
      </div>

      {/* Restore Conflict Confirmation Dialog */}
      {restoreConflictResponse && pendingRestoreFile && (
        <div
          role="alertdialog"
          aria-labelledby="restore-conflict-title"
          className="p-4 border border-[#8C4A27] bg-[#EFECE4] dark:bg-[#1C1D1B] space-y-3 text-xs"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-[#8C4A27] shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <h2 id="restore-conflict-title" className="font-semibold text-sm text-[#1B1B19] dark:text-[#EAE8E1]">
                Existing archives conflict with backup ({restoreConflictResponse.conflicts.length})
              </h2>
              <p className="mt-1 text-[#57554E] dark:text-[#A8A49B]">
                Discover never overwrites existing archives silently. Confirm whether you want to overwrite these entries from the ZIP backup:
              </p>
              <ul className="mt-2 space-y-1 font-mono text-[11px] text-[#57554E] dark:text-[#A8A49B]">
                {restoreConflictResponse.conflicts.slice(0, 5).map((c) => (
                  <li key={c.archiveUid}>
                    · {c.archiveUid} — {c.title}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={restoring}
              onClick={() => void handleRestoreFileSelected(pendingRestoreFile, true)}
              className="px-3 py-1.5 text-xs font-medium bg-[#8C4A27] text-[#F6F4EF] whitespace-nowrap"
            >
              Confirm Overwrite & Restore
            </button>
            <button
              type="button"
              onClick={() => {
                setPendingRestoreFile(null);
                setRestoreConflictResponse(null);
              }}
              className="px-3 py-1.5 text-xs border border-[#DDD8CE] dark:border-[#2B2C28] whitespace-nowrap"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {restoreNotice && (
        <div
          role={restoreNotice.type === 'error' ? 'alert' : 'status'}
          className={`p-3 border text-xs ${
            restoreNotice.type === 'error'
              ? 'border-[#7F2929]/40 bg-[#7F2929]/5 text-[#7F2929] dark:text-[#D98A8A]'
              : 'border-[#3F5E45]/40 bg-[#3F5E45]/5 text-[#3F5E45] dark:text-[#8FB896]'
          }`}
        >
          {restoreNotice.message}
        </div>
      )}

      {/* Archive Any Custom URL Bar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onOpenArchiveUrlModal(customUrlInput.trim());
          setCustomUrlInput('');
        }}
        className="flex flex-wrap items-center gap-2 pb-4 border-b border-[#DDD8CE] dark:border-[#2B2C28]"
      >
        <input
          type="url"
          value={customUrlInput}
          onChange={(e) => setCustomUrlInput(e.target.value)}
          placeholder="Archive any webpage URL directly (https://...)"
          aria-label="Archive custom URL"
          className="flex-1 min-w-60 px-3 py-2 text-xs bg-white dark:bg-[#1A1B19] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none focus:border-[#1E3A5F]"
        />
        <button
          type="submit"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 whitespace-nowrap"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Archive URL</span>
        </button>
      </form>

      {/* Search & Multi-Facet Filter Bar */}
      <div className="flex flex-wrap items-center gap-2.5 pb-4 border-b border-[#DDD8CE] dark:border-[#2B2C28] text-xs">
        <div className="relative flex-1 min-w-52">
          <Search
            className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#737067]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, notes, URL, or archived page text…"
            aria-label="Search archives"
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white dark:bg-[#1A1B19] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none focus:border-[#1E3A5F]"
          />
        </div>

        <select
          aria-label="Filter by category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="px-2.5 py-1.5 bg-white dark:bg-[#1A1B19] border border-[#DDD8CE] dark:border-[#2B2C28] text-xs"
        >
          <option value="all">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by tag"
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          className="px-2.5 py-1.5 bg-white dark:bg-[#1A1B19] border border-[#DDD8CE] dark:border-[#2B2C28] text-xs"
        >
          <option value="all">All Tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by format"
          value={formatFilter}
          onChange={(e) => setFormatFilter(e.target.value as ArchiveFormat | 'all')}
          className="px-2.5 py-1.5 bg-white dark:bg-[#1A1B19] border border-[#DDD8CE] dark:border-[#2B2C28] text-xs"
        >
          <option value="all">All Formats</option>
          <option value="html">HTML</option>
          <option value="warc">WARC 1.1</option>
          <option value="pdf">PDF</option>
        </select>

        <select
          aria-label="Filter by capture status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ArchiveStatus | 'all')}
          className="px-2.5 py-1.5 bg-white dark:bg-[#1A1B19] border border-[#DDD8CE] dark:border-[#2B2C28] text-xs"
        >
          <option value="all">All Statuses</option>
          <option value="complete">Complete</option>
          <option value="partial">Partial</option>
          <option value="text_only">Text-Only</option>
          <option value="failed">Failed</option>
        </select>

        <select
          aria-label="Filter by archival date"
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as 'all' | 'today' | '7d' | '30d')}
          className="px-2.5 py-1.5 bg-white dark:bg-[#1A1B19] border border-[#DDD8CE] dark:border-[#2B2C28] text-xs"
        >
          <option value="all">Any Archive Date</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 Days</option>
          <option value="30d">Last 30 Days</option>
        </select>

        <select
          aria-label="Sort archives"
          value={sort}
          onChange={(e) =>
            setSort(
              e.target.value as
                | 'archived_desc'
                | 'archived_asc'
                | 'published_desc'
                | 'published_asc'
            )
          }
          className="px-2.5 py-1.5 bg-white dark:bg-[#1A1B19] border border-[#DDD8CE] dark:border-[#2B2C28] text-xs"
        >
          <option value="archived_desc">Archived (Newest)</option>
          <option value="archived_asc">Archived (Oldest)</option>
          <option value="published_desc">Published (Newest)</option>
          <option value="published_asc">Published (Oldest)</option>
        </select>

        <label className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-white dark:bg-[#1A1B19] border border-[#DDD8CE] dark:border-[#2B2C28] text-xs cursor-pointer select-none">
          <input
            type="checkbox"
            checked={hasNotesOnly}
            onChange={(e) => setHasNotesOnly(e.target.checked)}
            className="accent-[#1E3A5F]"
          />
          <span>Has Notes</span>
        </label>
      </div>

      {error && (
        <div role="alert" className="p-3 border border-[#7F2929]/40 text-xs text-[#7F2929]">
          {error}
        </div>
      )}

      {/* Archive List */}
      {loading && archives.length === 0 ? (
        <div className="py-10 space-y-4">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-20 bg-[#EFECE4] dark:bg-[#1C1D1B]" />
          ))}
        </div>
      ) : archives.length === 0 ? (
        <div className="py-14 max-w-lg">
          <Archive className="w-6 h-6 text-[#737067] mb-3" aria-hidden="true" />
          <h2 className="font-serif text-xl font-semibold text-[#1B1B19] dark:text-[#EAE8E1]">
            No archived pages match right now
          </h2>
          <p className="mt-2 text-sm text-[#57554E] dark:text-[#A8A49B] leading-relaxed">
            Use <strong>Save Offline</strong> on any item in your Discover feed or paste any URL above to preserve self-contained HTML, WARC 1.1, and PDF snapshots locally.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-[#DDD8CE] dark:divide-[#2B2C28]">
          {archives.map((arc) => {
            const st = statusLabel(arc.status);
            const totalSize = Object.values(arc.fileSizes).reduce(
              (s, v) => s + (typeof v === 'number' ? v : 0),
              0
            );

            return (
              <article key={arc.archiveUid} className="py-4 sm:py-5 flex items-start justify-between gap-5">
                <div className="min-w-0 flex-1">
                  {/* Editorial kicker line */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#737067] dark:text-[#8E8A80]">
                    <span className={`font-medium ${st.cls}`}>
                      {st.text} ({arc.completeness}%)
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[11px] tabular-nums">v{arc.versionNumber}</span>
                    {arc.publisher && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-[#57554E] dark:text-[#B5B0A6]">
                          {arc.publisher}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[11px] tabular-nums">
                      Archived {formatShortDate(arc.archivedAt)}
                    </span>
                    {arc.publishedAt && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono text-[11px] tabular-nums">
                          Published {formatShortDate(arc.publishedAt)}
                        </span>
                      </>
                    )}
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-[11px] tabular-nums">
                      {formatBytes(totalSize)}
                    </span>
                  </div>

                  {/* Title */}
                  <h2 className="mt-1.5 font-serif text-lg font-semibold text-[#1B1B19] dark:text-[#EAE8E1] leading-snug">
                    <button
                      type="button"
                      onClick={() =>
                        onOpenViewer(
                          arc,
                          arc.availableFormats.includes('html')
                            ? 'html'
                            : arc.availableFormats.includes('warc')
                              ? 'warc'
                              : arc.availableFormats.includes('pdf')
                                ? 'pdf'
                                : 'details'
                        )
                      }
                      className="text-left hover:underline underline-offset-4 decoration-[#1E3A5F]"
                    >
                      {arc.title}
                    </button>
                  </h2>

                  {/* Author / URL / Category & Tags */}
                  <p className="mt-1 text-xs font-mono text-[#737067] dark:text-[#8E8A80] break-all">
                    {arc.originalUrl}
                  </p>
                  {(arc.author || arc.categoryName || arc.tagNames.length > 0) && (
                    <p className="mt-1 text-xs text-[#57554E] dark:text-[#A8A49B]">
                      {arc.author ? `${arc.author}` : ''}
                      {arc.author && (arc.categoryName || arc.tagNames.length > 0) ? ' · ' : ''}
                      {arc.categoryName ? `${arc.categoryName}` : ''}
                      {arc.categoryName && arc.tagNames.length > 0 ? ' · ' : ''}
                      {arc.tagNames.join(' · ')}
                    </p>
                  )}

                  {arc.searchMatch && <SearchHighlightText preview={arc.searchMatch} />}

                  {arc.note && openNoteUid !== arc.archiveUid && arc.searchMatch?.source !== 'note' && (
                    <div className="mt-2 pl-2.5 border-l-2 border-[#1E3A5F] dark:border-[#6B92C4] text-xs text-[#1B1B19] dark:text-[#EAE8E1]">
                      <button
                        type="button"
                        onClick={() => setOpenNoteUid(arc.archiveUid)}
                        className="text-left hover:underline underline-offset-2 line-clamp-2"
                      >
                        <span className="font-mono text-[10px] uppercase tracking-wider text-[#1E3A5F] dark:text-[#9BBCE8] mr-2">
                          Note:
                        </span>
                        {arc.note}
                      </button>
                    </div>
                  )}

                  {/* Format & Management Actions */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {arc.availableFormats.includes('html') && (
                      <button
                        type="button"
                        onClick={() => onOpenViewer(arc, 'html')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 whitespace-nowrap"
                      >
                        <FileCode2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Open HTML</span>
                      </button>
                    )}

                    {arc.availableFormats.includes('warc') && (
                      <button
                        type="button"
                        onClick={() => onOpenViewer(arc, 'warc')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] whitespace-nowrap"
                      >
                        <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Replay WARC</span>
                      </button>
                    )}

                    {arc.availableFormats.includes('pdf') && (
                      <button
                        type="button"
                        onClick={() => onOpenViewer(arc, 'pdf')}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] whitespace-nowrap"
                      >
                        <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Open PDF</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setOpenNoteUid((prev) => (prev === arc.archiveUid ? null : arc.archiveUid))
                      }
                      aria-expanded={openNoteUid === arc.archiveUid}
                      aria-label={arc.note ? `Edit note for ${arc.title}` : `Add note for ${arc.title}`}
                      className={`inline-flex items-center gap-1 px-2 py-1 text-xs transition-colors whitespace-nowrap ${
                        arc.note || openNoteUid === arc.archiveUid
                          ? 'text-[#1E3A5F] dark:text-[#9BBCE8] font-medium bg-[#1E3A5F]/10 dark:bg-[#6B92C4]/15'
                          : 'text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B]'
                      }`}
                    >
                      <NotebookPen className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{arc.note ? 'Note · edited' : 'Note'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenViewer(arc, 'details')}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] whitespace-nowrap"
                    >
                      <Info className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Details</span>
                    </button>

                    <a
                      href={arc.originalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] whitespace-nowrap"
                    >
                      <span>Original</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>

                    <a
                      href={api.getArchiveExportUrl(arc.archiveUid)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] whitespace-nowrap"
                    >
                      <Download className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>ZIP</span>
                    </a>

                    {confirmDeleteUid === arc.archiveUid ? (
                      <span className="inline-flex items-center gap-1.5 ml-1">
                        <button
                          type="button"
                          onClick={() => void handleDelete(arc.archiveUid)}
                          className="px-2 py-1 text-xs font-medium bg-[#7F2929] text-[#F6F4EF] whitespace-nowrap"
                        >
                          Confirm Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteUid(null)}
                          className="px-2 py-1 text-xs border border-[#DDD8CE] dark:border-[#2B2C28] whitespace-nowrap"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteUid(arc.archiveUid)}
                        aria-label={`Delete archive ${arc.title}`}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-[#737067] dark:text-[#8E8A80] hover:text-[#7F2929] dark:hover:text-[#D98A8A] whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Delete</span>
                      </button>
                    )}
                  </div>

                  {openNoteUid === arc.archiveUid && (
                    <InlineNoteDrawer
                      inputId={`archive-note-${arc.archiveUid}`}
                      itemTitle={arc.title}
                      initialNote={arc.note}
                      updatedAt={arc.noteUpdatedAt}
                      onSave={(noteText) => handleSaveArchiveNote(arc, noteText)}
                      onClose={() => setOpenNoteUid(null)}
                    />
                  )}
                </div>

                {arc.thumbnailPath && (
                  <button
                    type="button"
                    onClick={() =>
                      onOpenViewer(
                        arc,
                        arc.availableFormats.includes('html') ? 'html' : 'details'
                      )
                    }
                    className="hidden sm:block w-36 aspect-video shrink-0 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4] dark:bg-[#1C1D1B] overflow-hidden"
                    aria-label={`Preview snapshot of ${arc.title}`}
                  >
                    <img
                      src={api.getArchiveThumbnailUrl(arc.archiveUid)}
                      alt={`Snapshot of ${arc.title}`}
                      loading="lazy"
                      className="w-full h-full object-cover object-top"
                    />
                  </button>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
