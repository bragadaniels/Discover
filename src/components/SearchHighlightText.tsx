import type {SearchMatchPreview} from '../../shared/types';

interface SearchHighlightTextProps {
  preview: SearchMatchPreview;
}

function sourceLabel(source: SearchMatchPreview['source']): string {
  if (source === 'note') return 'Matched in note';
  if (source === 'archive_text') return 'Matched in archived page text';
  return 'Matched in metadata';
}

export function SearchHighlightText({preview}: SearchHighlightTextProps) {
  if (!preview || preview.segments.length === 0) return null;

  return (
    <div className="mt-2 pl-2.5 border-l border-[#DDD8CE] dark:border-[#2B2C28] text-xs text-[#57554E] dark:text-[#A8A49B] leading-relaxed">
      <span className="font-mono text-[10px] uppercase tracking-wider text-[#1E3A5F] dark:text-[#9BBCE8] mr-2">
        {sourceLabel(preview.source)}:
      </span>
      <span>
        {preview.segments.map((seg, idx) =>
          seg.match ? (
            <mark
              key={idx}
              className="bg-[#1E3A5F]/15 dark:bg-[#6B92C4]/25 text-[#1B1B19] dark:text-[#EAE8E1] font-medium px-0.5"
            >
              {seg.text}
            </mark>
          ) : (
            <span key={idx}>{seg.text}</span>
          )
        )}
      </span>
    </div>
  );
}
