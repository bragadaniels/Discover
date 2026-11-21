import {useEffect, useState, type KeyboardEvent} from 'react';

interface InlineNoteDrawerProps {
  inputId: string;
  itemTitle: string;
  initialNote: string | null | undefined;
  updatedAt?: string | null;
  onSave: (noteText: string) => Promise<void>;
  onClose: () => void;
}

export function InlineNoteDrawer({
  inputId,
  itemTitle,
  initialNote,
  updatedAt,
  onSave,
  onClose,
}: InlineNoteDrawerProps) {
  const [draft, setDraft] = useState(initialNote || '');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{type: 'success' | 'error'; message: string} | null>(null);

  useEffect(() => {
    setDraft(initialNote || '');
  }, [initialNote]);

  const handleSave = async (nextText = draft) => {
    if (saving) return;
    setSaving(true);
    setStatus(null);
    try {
      await onSave(nextText);
      setStatus({
        type: 'success',
        message: nextText.trim() ? 'Note saved.' : 'Note cleared.',
      });
    } catch (err) {
      setStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Unable to save note.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSave(draft);
    }
  };

  return (
    <div className="mt-3 pl-3 border-l-2 border-[#1E3A5F] dark:border-[#6B92C4] bg-[#EFECE4]/40 dark:bg-[#1C1D1B]/60 p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={inputId}
          className="text-[11px] font-mono uppercase tracking-wider text-[#57554E] dark:text-[#A8A49B]"
        >
          Research Note
        </label>
        {updatedAt && (
          <span className="text-[11px] font-mono text-[#737067] dark:text-[#8E8A80] tabular-nums">
            Updated {new Date(updatedAt).toLocaleDateString('en-US', {month: 'short', day: 'numeric'})}
          </span>
        )}
      </div>

      <textarea
        id={inputId}
        rows={3}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setStatus(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder={`Add research notes, quotes, or context for "${itemTitle}"…`}
        className="w-full px-2.5 py-2 text-xs leading-relaxed bg-white dark:bg-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] placeholder:text-[#737067] dark:placeholder:text-[#7C7971] focus:outline-none focus:border-[#1E3A5F] dark:focus:border-[#6B92C4]"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave(draft)}
            className="px-3 py-1 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Note'}
          </button>

          {(initialNote || draft.trim()) && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraft('');
                void handleSave('');
              }}
              className="px-2.5 py-1 text-xs border border-[#DDD8CE] dark:border-[#2B2C28] text-[#57554E] dark:text-[#A8A49B] hover:text-[#7F2929] dark:hover:text-[#D98A8A] disabled:opacity-50"
            >
              Clear
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-xs text-[#737067] dark:text-[#8E8A80] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]"
          >
            Close
          </button>
        </div>

        <div className="flex items-center gap-3">
          {status && (
            <span
              role={status.type === 'error' ? 'alert' : 'status'}
              className={`text-xs font-medium ${
                status.type === 'error'
                  ? 'text-[#7F2929] dark:text-[#D98A8A]'
                  : 'text-[#3F5E45] dark:text-[#8FB896]'
              }`}
            >
              {status.message}
            </span>
          )}
          <span className="hidden sm:inline text-[11px] font-mono text-[#737067] dark:text-[#8E8A80]">
            Ctrl+Enter to save
          </span>
        </div>
      </div>
    </div>
  );
}
