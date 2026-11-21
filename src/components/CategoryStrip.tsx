import {Atom, Bookmark, Cpu, Dices, Film, FlaskConical, Globe, Plus, Sparkles} from 'lucide-react';
import {useState, type FormEvent} from 'react';
import type {Category, CategorySelection} from '../../shared/types';

interface CategoryStripProps {
  categories: Category[];
  activeCategoryId: CategorySelection;
  onSelectCategory: (id: CategorySelection) => void;
  onCreateCategory: (name: string) => Promise<void>;
  onOpenTopicsManager: () => void;
}

export function CategoryIcon({icon, className = 'w-3.5 h-3.5'}: {icon: string; className?: string}) {
  switch (icon) {
    case 'flask':
      return <FlaskConical className={className} aria-hidden="true" />;
    case 'cpu':
      return <Cpu className={className} aria-hidden="true" />;
    case 'orbit':
    case 'atom':
      return <Atom className={className} aria-hidden="true" />;
    case 'film':
      return <Film className={className} aria-hidden="true" />;
    case 'globe':
      return <Globe className={className} aria-hidden="true" />;
    case 'sparkles':
      return <Sparkles className={className} aria-hidden="true" />;
    default:
      return <Bookmark className={className} aria-hidden="true" />;
  }
}

export function CategoryStrip({
  categories,
  activeCategoryId,
  onSelectCategory,
  onCreateCategory,
  onOpenTopicsManager,
}: CategoryStripProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);

  const enabledCategories = categories.filter((c) => c.isEnabled);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setQuickAddError(null);
    try {
      await onCreateCategory(trimmed);
      setNewName('');
      setIsAdding(false);
    } catch (err) {
      setQuickAddError(err instanceof Error ? err.message : 'Unable to create category');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border-b border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/60 dark:bg-[#1C1D1B]">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 flex items-center justify-between gap-4">
        <div
          role="tablist"
          aria-label="Category tabs"
          className="flex items-center gap-1 overflow-x-auto py-2 no-scrollbar"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeCategoryId === 'all'}
            onClick={() => onSelectCategory('all')}
            className={`px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E3A5F] ${
              activeCategoryId === 'all'
                ? 'bg-[#1B1B19] text-[#F6F4EF] dark:bg-[#EAE8E1] dark:text-[#141514]'
                : 'text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#DDD8CE]/50 dark:hover:bg-[#2B2C28]/60'
            }`}
          >
            All
          </button>

          {enabledCategories.map((cat) => {
            const isSelected = activeCategoryId === cat.id;
            const activeTagCount = cat.tags.filter((t) => t.isEnabled).length;
            return (
              <button
                key={cat.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => onSelectCategory(cat.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E3A5F] ${
                  isSelected
                    ? 'bg-[#1B1B19] text-[#F6F4EF] dark:bg-[#EAE8E1] dark:text-[#141514]'
                    : 'text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#DDD8CE]/50 dark:hover:bg-[#2B2C28]/60'
                }`}
              >
                <CategoryIcon icon={cat.icon} className="w-3 h-3" />
                <span>{cat.name}</span>
                <span className="font-mono text-[11px] opacity-65 tabular-nums">
                  {activeTagCount}
                </span>
              </button>
            );
          })}

          <button
            type="button"
            role="tab"
            aria-selected={activeCategoryId === 'lucky'}
            onClick={() => onSelectCategory('lucky')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E3A5F] ${
              activeCategoryId === 'lucky'
                ? 'bg-[#1E3A5F] text-[#F6F4EF] dark:bg-[#6B92C4] dark:text-[#141514]'
                : 'text-[#1E3A5F] dark:text-[#9BBCE8] hover:bg-[#1E3A5F]/10 dark:hover:bg-[#6B92C4]/15'
            }`}
          >
            <Dices className="w-3.5 h-3.5" aria-hidden="true" />
            <span>I&apos;m Feeling Lucky</span>
          </button>

          {isAdding ? (
            <form onSubmit={(e) => void handleSubmit(e)} className="inline-flex items-center gap-1 ml-1 shrink-0">
              <label htmlFor="quick-new-category" className="sr-only">
                New category name
              </label>
              <input
                id="quick-new-category"
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Category name…"
                autoFocus
                className="w-32 px-2 py-1 text-xs bg-[#F6F4EF] dark:bg-[#141514] border border-[#1E3A5F] dark:border-[#6B92C4] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none"
              />
              <button
                type="submit"
                disabled={submitting || !newName.trim()}
                className="px-2 py-1 text-xs font-medium bg-[#1E3A5F] text-[#F6F4EF] disabled:opacity-50 whitespace-nowrap"
              >
                {submitting ? 'Adding…' : 'Add'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAdding(false);
                  setNewName('');
                  setQuickAddError(null);
                }}
                className="px-2 py-1 text-xs text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]"
              >
                Cancel
              </button>
              {quickAddError && (
                <span role="alert" className="text-[11px] text-[#7F2929] dark:text-[#D98A8A] pl-1">
                  {quickAddError}
                </span>
              )}
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setIsAdding(true)}
              aria-label="New category"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>New Tab</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenTopicsManager}
          className="hidden md:inline-flex items-center text-xs text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] underline underline-offset-4 whitespace-nowrap shrink-0"
        >
          Manage tags
        </button>
      </div>
    </div>
  );
}
