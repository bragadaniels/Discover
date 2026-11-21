import {
  Archive,
  Bookmark,
  BookOpen,
  Check,
  Clapperboard,
  ExternalLink,
  EyeOff,
  FileText,
  Film,
  Newspaper,
  NotebookPen,
  Play,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-react';
import {useState} from 'react';
import type {ArchiveFormat, ArchiveStatus, ContentItem, FeedbackType} from '../../shared/types';
import {InlineNoteDrawer} from './InlineNoteDrawer';
import {SearchHighlightText} from './SearchHighlightText';

interface FeedItemRowProps {
  item: ContentItem;
  archiveBadge?: {archiveUid: string; formats: ArchiveFormat[]; status: ArchiveStatus} | null;
  onToggleSave: (item: ContentItem) => void;
  onToggleRead: (item: ContentItem) => void;
  onSetFeedback: (item: ContentItem, next: FeedbackType) => void;
  onHide: (item: ContentItem) => void;
  onOpenOriginal: (item: ContentItem) => void;
  onArchive?: (item: ContentItem) => void;
  onSaveNote?: (item: ContentItem, noteText: string) => Promise<void>;
}

function formatEditorialDate(iso: string | null): string {
  if (!iso) return 'Undated';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Undated';
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function ContentTypeLabel({type}: {type: ContentItem['contentType']}) {
  if (type === 'news') {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-[#1E3A5F] dark:text-[#9BBCE8]">
        <Newspaper className="w-3 h-3" aria-hidden="true" />
        News
      </span>
    );
  }
  if (type === 'article') {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-[#3F5E45] dark:text-[#8FB896]">
        <BookOpen className="w-3 h-3" aria-hidden="true" />
        Article
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-medium text-[#7F2929] dark:text-[#D98A8A]">
      <Play className="w-3 h-3" aria-hidden="true" />
      Video
    </span>
  );
}

function FilmCategoryLabel({category}: {category: ContentItem['filmCategory']}) {
  if (!category) return null;
  if (category === 'to_watch') {
    return (
      <span className="inline-flex items-center gap-1 font-medium text-[#8C4A27] dark:text-[#E0A37D]">
        <Film className="w-3 h-3" aria-hidden="true" />
        Film to Watch
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-medium text-[#5B4B7A] dark:text-[#B9A9DB]">
      <Clapperboard className="w-3 h-3" aria-hidden="true" />
      About Film
    </span>
  );
}

function formatLocaleIndicator(item: ContentItem): string {
  const lang = (item.language || 'en').toUpperCase();
  if (item.publisherCountry) {
    return `${lang} / ${item.publisherCountry}`;
  }
  if (item.publicationRegion) {
    return `${lang} · ${item.publicationRegion} edition`;
  }
  return lang;
}

export function FeedItemRow({
  item,
  archiveBadge,
  onToggleSave,
  onToggleRead,
  onSetFeedback,
  onHide,
  onOpenOriginal,
  onArchive,
  onSaveNote,
}: FeedItemRowProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const dateLabel = formatEditorialDate(item.publishedAt || item.discoveredAt);
  const localeLabel = formatLocaleIndicator(item);

  return (
    <article
      className={`py-4 sm:py-5 border-b border-[#DDD8CE] dark:border-[#2B2C28] transition-opacity ${
        item.isRead ? 'opacity-70' : 'opacity-100'
      }`}
    >
      <div className="flex items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          {/* Quiet unboxed kicker line with typographic separators */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#737067] dark:text-[#8E8A80]">
            <ContentTypeLabel type={item.contentType} />
            {item.filmCategory && (
              <>
                <span aria-hidden="true">·</span>
                <FilmCategoryLabel category={item.filmCategory} />
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-medium text-[#57554E] dark:text-[#B5B0A6]">{item.sourceName}</span>
            <span aria-hidden="true">·</span>
            <span
              title={
                item.publisherCountry
                  ? `Language: ${item.language.toUpperCase()}, Publisher country: ${item.publisherCountry}`
                  : item.publicationRegion
                    ? `Language: ${item.language.toUpperCase()}, Query edition: ${item.publicationRegion}`
                    : `Language: ${item.language.toUpperCase()}`
              }
              className="font-mono text-[11px] text-[#57554E] dark:text-[#9C978D] tabular-nums"
            >
              {localeLabel}
            </span>
            <span aria-hidden="true">·</span>
            <time dateTime={item.publishedAt || item.discoveredAt} className="font-mono text-[11px] tabular-nums">
              {dateLabel}
            </time>
            {item.duration && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-[11px] tabular-nums">{item.duration}</span>
              </>
            )}
            {item.isRead && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-[11px] font-medium text-[#3F5E45] dark:text-[#8FB896]">Read</span>
              </>
            )}
          </div>

          {/* Primary editorial headline */}
          <h2 className="mt-1.5 font-serif text-lg sm:text-[1.1875rem] leading-snug font-semibold text-[#1B1B19] dark:text-[#EAE8E1] text-balance">
            <a
              href={item.originalUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => onOpenOriginal(item)}
              className="hover:underline underline-offset-4 decoration-[#1E3A5F] dark:decoration-[#6B92C4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A5F]"
            >
              {item.title}
            </a>
          </h2>

          {/* Author & DOI metadata for scientific publications */}
          {(item.author || item.doi || item.openAccessUrl) && (
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#57554E] dark:text-[#A8A49B]">
              {item.author && <span className="truncate max-w-md">{item.author}</span>}
              {item.author && item.doi && <span aria-hidden="true">·</span>}
              {item.doi && (
                <span className="font-mono text-[11px] tabular-nums text-[#737067] dark:text-[#8E8A80]">
                  DOI: {item.doi}
                </span>
              )}
              {item.openAccessUrl && (
                <>
                  <span aria-hidden="true">·</span>
                  <a
                    href={item.openAccessUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[#1E3A5F] dark:text-[#9BBCE8] hover:underline"
                  >
                    <FileText className="w-3 h-3" aria-hidden="true" />
                    Open Access PDF
                  </a>
                </>
              )}
            </div>
          )}

          {/* Concise summary excerpt */}
          {item.description && (
            <p className="mt-1.5 text-sm leading-relaxed text-[#57554E] dark:text-[#A8A49B] line-clamp-2 max-w-3xl">
              {item.description}
            </p>
          )}

          {/* Full-text search match snippet */}
          {item.searchMatch && <SearchHighlightText preview={item.searchMatch} />}

          {/* Compact saved note preview when drawer is collapsed */}
          {item.note && !noteOpen && onSaveNote && item.searchMatch?.source !== 'note' && (
            <div className="mt-2 pl-2.5 border-l-2 border-[#1E3A5F] dark:border-[#6B92C4] text-xs text-[#1B1B19] dark:text-[#EAE8E1] max-w-3xl">
              <button
                type="button"
                onClick={() => setNoteOpen(true)}
                className="text-left hover:underline underline-offset-2 line-clamp-2"
              >
                <span className="font-mono text-[10px] uppercase tracking-wider text-[#1E3A5F] dark:text-[#9BBCE8] mr-2">
                  Note:
                </span>
                {item.note}
              </button>
            </div>
          )}

          {/* Bottom row: unboxed associated tags + restrained action controls */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-mono text-[#57554E] dark:text-[#9C978D]">
              {item.associatedTags.map((tag, idx) => (
                <span key={tag.tagId} className="inline-flex items-center gap-2">
                  {idx > 0 && <span aria-hidden="true">·</span>}
                  <span title={`Category: ${tag.categoryName} (${tag.matchType} match: ${tag.matchedTerm})`}>
                    {tag.tagName}
                  </span>
                </span>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
              <a
                href={item.originalUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => onOpenOriginal(item)}
                aria-label={`Open source for ${item.title}`}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[#1E3A5F] dark:text-[#9BBCE8] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] transition-colors whitespace-nowrap"
              >
                <span>Open</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>

              <button
                type="button"
                onClick={() => onToggleSave(item)}
                aria-pressed={item.isSaved}
                aria-label={item.isSaved ? `Remove ${item.title} from saved` : `Save ${item.title}`}
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs transition-colors whitespace-nowrap ${
                  item.isSaved
                    ? 'text-[#1E3A5F] dark:text-[#9BBCE8] font-medium bg-[#1E3A5F]/10 dark:bg-[#6B92C4]/15'
                    : 'text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B]'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{item.isSaved ? 'Saved' : 'Save'}</span>
              </button>

              {onArchive && (
                <button
                  type="button"
                  onClick={() => onArchive(item)}
                  aria-label={
                    archiveBadge
                      ? `Archive options for ${item.title} (currently archived)`
                      : `Save Offline / Archive ${item.title}`
                  }
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs transition-colors whitespace-nowrap ${
                    archiveBadge
                      ? 'text-[#3F5E45] dark:text-[#8FB896] font-medium bg-[#3F5E45]/10 dark:bg-[#8FB896]/15'
                      : 'text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B]'
                  }`}
                >
                  <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{archiveBadge ? 'Archived' : 'Save Offline'}</span>
                </button>
              )}

              {onSaveNote && (
                <button
                  type="button"
                  onClick={() => setNoteOpen((v) => !v)}
                  aria-expanded={noteOpen}
                  aria-label={item.note ? `Edit note for ${item.title}` : `Add note for ${item.title}`}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs transition-colors whitespace-nowrap ${
                    item.note || noteOpen
                      ? 'text-[#1E3A5F] dark:text-[#9BBCE8] font-medium bg-[#1E3A5F]/10 dark:bg-[#6B92C4]/15'
                      : 'text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B]'
                  }`}
                >
                  <NotebookPen className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{item.note ? 'Note · edited' : 'Note'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => onSetFeedback(item, item.feedbackType === 'like' ? null : 'like')}
                aria-pressed={item.feedbackType === 'like'}
                aria-label={`Like ${item.title}`}
                className={`p-1.5 transition-colors ${
                  item.feedbackType === 'like'
                    ? 'text-[#3F5E45] dark:text-[#8FB896] bg-[#3F5E45]/10'
                    : 'text-[#737067] dark:text-[#8E8A80] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B]'
                }`}
              >
                <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => onSetFeedback(item, item.feedbackType === 'dislike' ? null : 'dislike')}
                aria-pressed={item.feedbackType === 'dislike'}
                aria-label={`Dislike ${item.title}`}
                className={`p-1.5 transition-colors ${
                  item.feedbackType === 'dislike'
                    ? 'text-[#7F2929] dark:text-[#D98A8A] bg-[#7F2929]/10'
                    : 'text-[#737067] dark:text-[#8E8A80] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B]'
                }`}
              >
                <ThumbsDown className="w-3.5 h-3.5" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => onToggleRead(item)}
                aria-pressed={item.isRead}
                aria-label={item.isRead ? `Mark ${item.title} as unread` : `Mark ${item.title} as read`}
                className={`p-1.5 transition-colors ${
                  item.isRead
                    ? 'text-[#3F5E45] dark:text-[#8FB896]'
                    : 'text-[#737067] dark:text-[#8E8A80] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B]'
                }`}
              >
                <Check className="w-3.5 h-3.5" aria-hidden="true" />
              </button>

              <button
                type="button"
                onClick={() => onHide(item)}
                aria-label={`Hide ${item.title}`}
                className="p-1.5 text-[#737067] dark:text-[#8E8A80] hover:text-[#7F2929] dark:hover:text-[#D98A8A] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] transition-colors"
              >
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {noteOpen && onSaveNote && (
            <InlineNoteDrawer
              inputId={`feed-note-${item.id}`}
              itemTitle={item.title}
              initialNote={item.note}
              updatedAt={item.noteUpdatedAt}
              onSave={(noteText) => onSaveNote(item, noteText)}
              onClose={() => setNoteOpen(false)}
            />
          )}
        </div>

        {/* Compact 16:9 thumbnail reserved exclusively for videos */}
        {item.contentType === 'video' && (
          <a
            href={item.originalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpenOriginal(item)}
            aria-label={`Watch video: ${item.title}`}
            className="hidden sm:block w-40 aspect-video shrink-0 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4] dark:bg-[#1C1D1B] overflow-hidden relative group"
          >
            {item.thumbnailUrl && !imgFailed ? (
              <img
                src={item.thumbnailUrl}
                alt={item.title}
                loading="lazy"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#57554E] dark:text-[#A8A49B]">
                <Play className="w-6 h-6" aria-hidden="true" />
              </div>
            )}
          </a>
        )}
      </div>
    </article>
  );
}
