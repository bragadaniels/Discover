import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Film,
  Globe,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {useEffect, useState, type FormEvent} from 'react';
import {getLocaleProviderLimitations} from '../../shared/locale';
import type {Category, Tag, TagSuggestionPreview, UserPreferences} from '../../shared/types';
import {CategoryIcon} from './CategoryStrip';
import {LocaleMultiSelector} from './LocaleMultiSelector';

const HIDDEN_GEMS_TAG_NAME = 'Hidden Gems / Filmes pouco conhecidos';

interface TopicsManagerProps {
  categories: Category[];
  preferences: UserPreferences;
  onCreateCategory: (name: string, icon: string) => Promise<void>;
  onAddCinemaPreset: () => Promise<number | void>;
  onUpdateCategory: (
    id: number,
    patch: {
      name?: string;
      icon?: string;
      isEnabled?: boolean;
      languages?: string[] | null;
      regions?: string[] | null;
    }
  ) => Promise<void>;
  onDeleteCategory: (id: number) => Promise<void>;
  onReorderCategories: (orderedIds: number[]) => Promise<void>;
  onPreviewTagSuggestions: (
    tagName: string,
    categoryName: string,
    languages: string[]
  ) => Promise<TagSuggestionPreview>;
  onCreateTag: (
    categoryId: number,
    input: {
      name: string;
      priority: number;
      description?: string;
      expandedTerms?: string[];
      exclusions?: string[];
    }
  ) => Promise<void>;
  onUpdateTag: (
    id: number,
    patch: {name?: string; priority?: number; isEnabled?: boolean}
  ) => Promise<void>;
  onDeleteTag: (id: number) => Promise<void>;
  onAddTagRelation: (
    tagId: number,
    term: string,
    relationType: 'expanded' | 'exclusion'
  ) => Promise<void>;
  onToggleTagRelation: (id: number, isEnabled: boolean) => Promise<void>;
  onDeleteTagRelation: (id: number) => Promise<void>;
  onAddCustomLanguage: (input: {code: string; name?: string}) => Promise<void>;
  onRemoveCustomLanguage: (code: string) => Promise<void>;
  onAddCustomRegion: (input: {
    code?: string;
    name?: string;
    countryCode?: string;
    defaultLanguage?: string;
    queryLocation?: string;
  }) => Promise<void>;
  onRemoveCustomRegion: (code: string) => Promise<void>;
  onRunCategoryDiscovery: (categoryId: number) => Promise<void>;
  isDiscovering: boolean;
}

const PRIORITY_LABELS: Record<number, string> = {
  1: '1 · Low',
  2: '2 · Normal',
  3: '3 · High',
  4: '4 · Very High',
  5: '5 · Essential',
};

const ICON_OPTIONS = [
  {value: 'bookmark', label: 'Bookmark'},
  {value: 'flask', label: 'Flask'},
  {value: 'cpu', label: 'Hardware'},
  {value: 'orbit', label: 'Atom / Space'},
  {value: 'film', label: 'Cinema / Film'},
  {value: 'globe', label: 'World'},
  {value: 'sparkles', label: 'Research'},
];

const DOMAIN_LABELS: Record<string, string> = {
  entertainment: 'Cinema & Entertainment Strategy',
  science: 'Scientific Literature Strategy',
  technology: 'Technology & Engineering Strategy',
  geopolitics: 'Geopolitics & Policy Strategy',
  general: 'General Editorial Strategy',
};

interface DraftSuggestion {
  term: string;
  facet: string;
  accepted: boolean;
}

export function TopicsManager({
  categories,
  preferences,
  onCreateCategory,
  onAddCinemaPreset,
  onUpdateCategory,
  onDeleteCategory,
  onReorderCategories,
  onPreviewTagSuggestions,
  onCreateTag,
  onUpdateTag,
  onDeleteTag,
  onAddTagRelation,
  onToggleTagRelation,
  onDeleteTagRelation,
  onAddCustomLanguage,
  onRemoveCustomLanguage,
  onAddCustomRegion,
  onRemoveCustomRegion,
  onRunCategoryDiscovery,
  isDiscovering,
}: TopicsManagerProps) {
  const [selectedCatId, setSelectedCatId] = useState<number | null>(categories[0]?.id ?? null);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('bookmark');
  const [newTagName, setNewTagName] = useState('');
  const [newTagPriority, setNewTagPriority] = useState(3);
  const [expandedTagId, setExpandedTagId] = useState<number | null>(null);
  const [newRelationTerm, setNewRelationTerm] = useState('');
  const [newRelationType, setNewRelationType] = useState<'expanded' | 'exclusion'>('expanded');
  const [editingCatName, setEditingCatName] = useState<string | null>(null);
  const [editingLocales, setEditingLocales] = useState(false);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionStatus, setActionStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Interactive term expansion preview state for new tag
  const [previewData, setPreviewData] = useState<TagSuggestionPreview | null>(null);
  const [draftSuggestions, setDraftSuggestions] = useState<DraftSuggestion[]>([]);
  const [draftExclusions, setDraftExclusions] = useState<Array<{term: string; accepted: boolean}>>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const selectedCategory =
    categories.find((c) => c.id === selectedCatId) || categories[0] || null;

  const effectiveLanguages =
    selectedCategory?.languages && selectedCategory.languages.length > 0
      ? selectedCategory.languages
      : preferences.languages;
  const effectiveRegions =
    selectedCategory?.regions && selectedCategory.regions.length > 0
      ? selectedCategory.regions
      : preferences.regions;

  const hasCinemaCategory = categories.some(
    (c) =>
      c.slug === 'cinema' ||
      c.name.toLowerCase().includes('cinema') ||
      c.name.toLowerCase().includes('film') ||
      c.name.toLowerCase().includes('entertainment')
  );

  const isSelectedCinema = Boolean(
    selectedCategory &&
      (selectedCategory.icon === 'film' ||
        selectedCategory.name.toLowerCase().includes('cinema') ||
        selectedCategory.name.toLowerCase().includes('film') ||
        selectedCategory.name.toLowerCase().includes('entertainment'))
  );

  const hasHiddenGemsInSelected = Boolean(
    selectedCategory?.tags.some(
      (t) => t.name.toLowerCase() === HIDDEN_GEMS_TAG_NAME.toLowerCase()
    )
  );

  const limitationNotes = getLocaleProviderLimitations(
    effectiveLanguages,
    effectiveRegions,
    preferences.customLanguages,
    preferences.customRegions
  );

  const runAction = async (
    key: string,
    fn: () => Promise<void>,
    successMsg: string,
    errorFallback: string
  ) => {
    setBusyAction(key);
    setActionStatus(null);
    try {
      await fn();
      setActionStatus({type: 'success', message: successMsg});
    } catch (err) {
      setActionStatus({
        type: 'error',
        message: err instanceof Error ? err.message : errorFallback,
      });
    } finally {
      setBusyAction(null);
    }
  };

  // Auto-preview domain-aware suggestions while typing a new tag
  useEffect(() => {
    const trimmed = newTagName.trim();
    if (!selectedCategory || trimmed.length < 3) {
      setPreviewData(null);
      setDraftSuggestions([]);
      setDraftExclusions([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoadingPreview(true);
      try {
        const res = await onPreviewTagSuggestions(
          trimmed,
          selectedCategory.name,
          effectiveLanguages
        );
        if (cancelled) return;
        setPreviewData(res);
        setDraftSuggestions(res.suggestions.map((s) => ({...s, accepted: true})));
        setDraftExclusions(res.exclusions.map((ex) => ({term: ex, accepted: true})));
      } catch {
        // Ignore preview error while typing
      } finally {
        if (!cancelled) setLoadingPreview(false);
      }
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [newTagName, selectedCategory, effectiveLanguages, onPreviewTagSuggestions]);

  const handleAddCategory = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) {
      setActionStatus({type: 'error', message: 'Category name cannot be empty.'});
      return;
    }
    await runAction(
      'create-cat',
      async () => {
        await onCreateCategory(trimmed, newCatIcon);
        setNewCatName('');
      },
      `Category "${trimmed}" created.`,
      'Failed to create category.'
    );
  };

  const handleMoveCategory = async (index: number, delta: -1 | 1) => {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= categories.length) return;
    const next = [...categories];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    await runAction(
      'reorder-cat',
      () => onReorderCategories(next.map((c) => c.id)),
      `Moved "${moved.name}".`,
      'Failed to reorder categories.'
    );
  };

  const handleAddTag = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedCategory) return;
    const trimmed = newTagName.trim();
    if (!trimmed) {
      setActionStatus({type: 'error', message: 'Tag name cannot be empty.'});
      return;
    }
    const acceptedTerms = previewData
      ? draftSuggestions.filter((d) => d.accepted && d.term.trim()).map((d) => d.term.trim())
      : undefined;
    const acceptedExclusions = previewData
      ? draftExclusions.filter((ex) => ex.accepted && ex.term.trim()).map((ex) => ex.term.trim())
      : undefined;

    await runAction(
      'add-tag',
      async () => {
        await onCreateTag(selectedCategory.id, {
          name: trimmed,
          priority: newTagPriority,
          expandedTerms: acceptedTerms,
          exclusions: acceptedExclusions,
        });
        setNewTagName('');
        setNewTagPriority(3);
        setPreviewData(null);
        setDraftSuggestions([]);
        setDraftExclusions([]);
      },
      `Tag "${trimmed}" added to ${selectedCategory.name}. Click Update Feed to fetch matching content.`,
      'Failed to create tag.'
    );
  };

  const handleAddRelation = async (e: FormEvent, tag: Tag) => {
    e.preventDefault();
    const clean = newRelationTerm.trim();
    if (!clean) {
      setActionStatus({type: 'error', message: 'Enter a term before adding.'});
      return;
    }
    await runAction(
      `add-rel-${tag.id}`,
      async () => {
        await onAddTagRelation(tag.id, clean, newRelationType);
        setNewRelationTerm('');
      },
      `Added ${newRelationType === 'exclusion' ? 'exclusion' : 'related term'} "${clean}" to ${tag.name}.`,
      'Failed to add term.'
    );
  };

  const handleSuggestMoreForTag = async (tag: Tag) => {
    if (!selectedCategory) return;
    setBusyAction(`suggest-${tag.id}`);
    setActionStatus(null);
    try {
      const res = await onPreviewTagSuggestions(
        tag.name,
        selectedCategory.name,
        effectiveLanguages
      );
      const existingTerms = new Set(tag.relations.map((r) => r.term.toLowerCase()));
      let addedCount = 0;
      for (const s of res.suggestions) {
        if (!existingTerms.has(s.term.toLowerCase())) {
          await onAddTagRelation(tag.id, s.term, 'expanded');
          addedCount++;
        }
      }
      setActionStatus({
        type: 'success',
        message:
          addedCount > 0
            ? `Added ${addedCount} domain-aware term${addedCount === 1 ? '' : 's'} to ${tag.name}.`
            : `All suggested terms for ${tag.name} are already present.`,
      });
    } catch (err) {
      setActionStatus({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to refresh suggestions.',
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-8">
      <div className="border-b border-[#DDD8CE] dark:border-[#2B2C28] pb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-[#1B1B19] dark:text-[#EAE8E1]">
            Topics &amp; Interest Tags
          </h1>
          <p className="mt-1 text-sm text-[#57554E] dark:text-[#A8A49B]">
            Organize category tabs, configure per-tab languages &amp; regions, and review domain-aware tag suggestions.
          </p>
        </div>
        {actionStatus && (
          <p
            role={actionStatus.type === 'error' ? 'alert' : 'status'}
            className={`text-xs font-medium ${
              actionStatus.type === 'error'
                ? 'text-[#7F2929] dark:text-[#D98A8A]'
                : 'text-[#3F5E45] dark:text-[#8FB896]'
            }`}
          >
            {actionStatus.message}
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left column: Category list & creator */}
        <div className="lg:col-span-4 space-y-5">
          <div>
            <h2 className="text-xs font-mono uppercase tracking-wider text-[#737067] dark:text-[#8E8A80] mb-3">
              Categories ({categories.length})
            </h2>

            <div className="border-t border-[#DDD8CE] dark:border-[#2B2C28]">
              {categories.map((cat, idx) => {
                const isSelected = selectedCategory?.id === cat.id;
                const hasLocaleOverride = Boolean(
                  (cat.languages && cat.languages.length > 0) || (cat.regions && cat.regions.length > 0)
                );
                return (
                  <div
                    key={cat.id}
                    className={`flex items-center justify-between gap-2 py-2.5 px-2 border-b border-[#DDD8CE] dark:border-[#2B2C28] ${
                      isSelected ? 'bg-[#EFECE4] dark:bg-[#1C1D1B]' : ''
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCatId(cat.id);
                        setEditingCatName(null);
                        setEditingLocales(false);
                      }}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left text-sm font-medium text-[#1B1B19] dark:text-[#EAE8E1]"
                    >
                      <CategoryIcon icon={cat.icon} className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{cat.name}</span>
                      <span className="font-mono text-xs text-[#737067] dark:text-[#8E8A80] tabular-nums">
                        ({cat.tags.length})
                      </span>
                      {hasLocaleOverride && (
                        <Globe
                          className="w-3 h-3 text-[#1E3A5F] dark:text-[#9BBCE8] shrink-0"
                          aria-label="Custom tab locale"
                        />
                      )}
                    </button>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => void handleMoveCategory(idx, -1)}
                        disabled={idx === 0 || busyAction === 'reorder-cat'}
                        aria-label={`Move ${cat.name} up`}
                        className="p-1 text-[#737067] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] disabled:opacity-30"
                      >
                        <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveCategory(idx, 1)}
                        disabled={idx === categories.length - 1 || busyAction === 'reorder-cat'}
                        aria-label={`Move ${cat.name} down`}
                        className="p-1 text-[#737067] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] disabled:opacity-30"
                      >
                        <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {!hasCinemaCategory && (
            <div className="p-3 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/50 dark:bg-[#1C1D1B] space-y-2">
              <div className="text-xs font-medium text-[#1B1B19] dark:text-[#EAE8E1]">
                Cinema &amp; Hidden Gems Preset
              </div>
              <p className="text-xs text-[#57554E] dark:text-[#A8A49B] leading-relaxed">
                Add a Cinema tab pre-configured with <em>{HIDDEN_GEMS_TAG_NAME}</em>, Psychological Thriller, Stanley Kubrick, and World Cinema.
              </p>
              <button
                type="button"
                disabled={busyAction === 'cinema-preset'}
                onClick={() =>
                  void runAction(
                    'cinema-preset',
                    async () => {
                      const createdId = await onAddCinemaPreset();
                      if (typeof createdId === 'number') {
                        setSelectedCatId(createdId);
                      }
                      setEditingCatName(null);
                      setEditingLocales(false);
                    },
                    'Cinema & Hidden Gems category added.',
                    'Failed to add Cinema preset.'
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#1E3A5F] dark:border-[#6B92C4] text-[#1E3A5F] dark:text-[#9BBCE8] hover:bg-[#1E3A5F]/10 disabled:opacity-50"
              >
                <Film className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {busyAction === 'cinema-preset' ? 'Adding Preset…' : 'Add Cinema & Hidden Gems'}
                </span>
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => void handleAddCategory(e)}
            className="pt-2 space-y-2.5 border-t border-[#DDD8CE] dark:border-[#2B2C28]"
          >
            <h3 className="text-xs font-medium text-[#1B1B19] dark:text-[#EAE8E1]">
              Create new category
            </h3>
            <div className="flex gap-2">
              <label htmlFor="topics-new-cat-name" className="sr-only">
                New category name
              </label>
              <input
                id="topics-new-cat-name"
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Category name"
                className="flex-1 px-2.5 py-1.5 text-xs bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none focus:border-[#1E3A5F]"
              />
              <label htmlFor="topics-new-cat-icon" className="sr-only">
                Category icon
              </label>
              <select
                id="topics-new-cat-icon"
                value={newCatIcon}
                onChange={(e) => setNewCatIcon(e.target.value)}
                className="px-2 py-1.5 text-xs bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
              >
                {ICON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              disabled={busyAction === 'create-cat'}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{busyAction === 'create-cat' ? 'Creating…' : 'Add Category'}</span>
            </button>
          </form>
        </div>

        {/* Right column: Selected category details & tag list */}
        <div className="lg:col-span-8">
          {selectedCategory ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-[#DDD8CE] dark:border-[#2B2C28]">
                <div className="flex items-center gap-3">
                  {editingCatName !== null ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = editingCatName.trim();
                        if (!trimmed) {
                          setActionStatus({type: 'error', message: 'Category name cannot be empty.'});
                          return;
                        }
                        void runAction(
                          'rename-cat',
                          async () => {
                            await onUpdateCategory(selectedCategory.id, {name: trimmed});
                            setEditingCatName(null);
                          },
                          `Category renamed to "${trimmed}".`,
                          'Failed to rename category.'
                        );
                      }}
                      className="flex items-center gap-2"
                    >
                      <label htmlFor="rename-category-input" className="sr-only">
                        Rename category
                      </label>
                      <input
                        id="rename-category-input"
                        type="text"
                        value={editingCatName}
                        onChange={(e) => setEditingCatName(e.target.value)}
                        autoFocus
                        className="px-2.5 py-1 text-base font-serif bg-[#EFECE4] dark:bg-[#1C1D1B] border border-[#1E3A5F] text-[#1B1B19] dark:text-[#EAE8E1]"
                      />
                      <button
                        type="submit"
                        disabled={busyAction === 'rename-cat'}
                        className="px-2.5 py-1 text-xs font-medium bg-[#1E3A5F] text-[#F6F4EF] disabled:opacity-50"
                      >
                        {busyAction === 'rename-cat' ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCatName(null)}
                        className="px-2 py-1 text-xs text-[#57554E] dark:text-[#A8A49B]"
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <CategoryIcon
                        icon={selectedCategory.icon}
                        className="w-5 h-5 text-[#1E3A5F] dark:text-[#9BBCE8]"
                      />
                      <h2 className="font-serif text-xl font-semibold text-[#1B1B19] dark:text-[#EAE8E1]">
                        {selectedCategory.name}
                      </h2>
                      <button
                        type="button"
                        onClick={() => setEditingCatName(selectedCategory.name)}
                        className="text-xs text-[#57554E] dark:text-[#A8A49B] underline underline-offset-4 hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]"
                      >
                        Rename
                      </button>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 text-xs text-[#57554E] dark:text-[#A8A49B]">
                    <input
                      type="checkbox"
                      checked={selectedCategory.isEnabled}
                      disabled={busyAction === `cat-toggle-${selectedCategory.id}`}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        void runAction(
                          `cat-toggle-${selectedCategory.id}`,
                          () => onUpdateCategory(selectedCategory.id, {isEnabled: checked}),
                          `${selectedCategory.name} ${checked ? 'enabled' : 'paused'}.`,
                          'Failed to update category state.'
                        );
                      }}
                      className="accent-[#1E3A5F]"
                    />
                    <span>Active</span>
                  </label>

                  <select
                    aria-label={`Icon for ${selectedCategory.name}`}
                    value={selectedCategory.icon}
                    disabled={busyAction === `cat-icon-${selectedCategory.id}`}
                    onChange={(e) => {
                      const nextIcon = e.target.value;
                      void runAction(
                        `cat-icon-${selectedCategory.id}`,
                        () => onUpdateCategory(selectedCategory.id, {icon: nextIcon}),
                        `Updated icon for ${selectedCategory.name}.`,
                        'Failed to update category icon.'
                      );
                    }}
                    className="px-2 py-1 text-xs bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
                  >
                    {ICON_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => setEditingLocales((v) => !v)}
                    aria-expanded={editingLocales}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B]"
                  >
                    <Globe className="w-3 h-3" aria-hidden="true" />
                    <span>Tab Locales</span>
                  </button>

                  <button
                    type="button"
                    disabled={isDiscovering || selectedCategory.tags.length === 0}
                    onClick={() => void onRunCategoryDiscovery(selectedCategory.id)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${isDiscovering ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>{isDiscovering ? 'Updating…' : 'Update Tab Feed'}</span>
                  </button>

                  <button
                    type="button"
                    disabled={busyAction === `delete-cat-${selectedCategory.id}`}
                    onClick={() => {
                      const deletedName = selectedCategory.name;
                      void runAction(
                        `delete-cat-${selectedCategory.id}`,
                        () => onDeleteCategory(selectedCategory.id),
                        `Category "${deletedName}" deleted.`,
                        'Failed to delete category.'
                      );
                    }}
                    aria-label={`Delete category ${selectedCategory.name}`}
                    className="p-1.5 text-[#737067] hover:text-[#7F2929] dark:hover:text-[#D98A8A] disabled:opacity-40"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>

              {/* Per-tab language & region summary and editor */}
              <div className="text-xs text-[#57554E] dark:text-[#A8A49B] flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono">
                  Active locales:{' '}
                  <strong className="text-[#1B1B19] dark:text-[#EAE8E1]">
                    {effectiveLanguages.map((l) => l.toUpperCase()).join(', ')}
                  </strong>{' '}
                  · Regions:{' '}
                  <strong className="text-[#1B1B19] dark:text-[#EAE8E1]">
                    {effectiveRegions.join(', ')}
                  </strong>{' '}
                  {selectedCategory.languages || selectedCategory.regions
                    ? '(tab override)'
                    : '(global default)'}
                </span>

                {(selectedCategory.languages || selectedCategory.regions) && (
                  <button
                    type="button"
                    disabled={busyAction === 'reset-locales'}
                    onClick={() =>
                      void runAction(
                        'reset-locales',
                        () =>
                          onUpdateCategory(selectedCategory.id, {languages: null, regions: null}),
                        `Reset ${selectedCategory.name} locales to global defaults.`,
                        'Failed to reset locales.'
                      )
                    }
                    className="underline underline-offset-2 text-[#1E3A5F] dark:text-[#9BBCE8] disabled:opacity-50"
                  >
                    Reset to global defaults
                  </button>
                )}
              </div>

              {editingLocales && (
                <div className="p-4 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/50 dark:bg-[#1C1D1B] space-y-4">
                  <LocaleMultiSelector
                    kind="language"
                    compact
                    label={`Languages for ${selectedCategory.name}`}
                    selected={effectiveLanguages}
                    customLanguages={preferences.customLanguages}
                    onAddCustomLanguage={onAddCustomLanguage}
                    onRemoveCustomLanguage={onRemoveCustomLanguage}
                    onChange={(nextLangs) =>
                      void runAction(
                        'save-tab-langs',
                        () => onUpdateCategory(selectedCategory.id, {languages: nextLangs}),
                        `Saved languages for ${selectedCategory.name}. Click Update Feed to sync.`,
                        'Failed to save tab languages.'
                      )
                    }
                  />
                  <LocaleMultiSelector
                    kind="region"
                    compact
                    label={`Regions & Cities for ${selectedCategory.name}`}
                    selected={effectiveRegions}
                    customRegions={preferences.customRegions}
                    onAddCustomRegion={onAddCustomRegion}
                    onRemoveCustomRegion={onRemoveCustomRegion}
                    onChange={(nextRegions) =>
                      void runAction(
                        'save-tab-regs',
                        () => onUpdateCategory(selectedCategory.id, {regions: nextRegions}),
                        `Saved regions for ${selectedCategory.name}. Click Update Feed to sync.`,
                        'Failed to save tab regions.'
                      )
                    }
                  />
                  {limitationNotes.length > 0 && (
                    <div className="text-[11px] text-[#57554E] dark:text-[#A8A49B] space-y-0.5 pt-2 border-t border-[#DDD8CE]/60 dark:border-[#2B2C28]">
                      {limitationNotes.map((note) => (
                        <p key={note}>{note}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Quick-add Hidden Gems tag inside Cinema tabs if missing */}
              {isSelectedCinema && !hasHiddenGemsInSelected && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/40 dark:bg-[#1C1D1B]">
                  <span className="text-xs text-[#57554E] dark:text-[#A8A49B]">
                    Discover lesser-known, independent, and international cinema with the dedicated{' '}
                    <strong className="text-[#1B1B19] dark:text-[#EAE8E1]">
                      {HIDDEN_GEMS_TAG_NAME}
                    </strong>{' '}
                    tag.
                  </span>
                  <button
                    type="button"
                    disabled={busyAction === 'add-hidden-gems'}
                    onClick={() =>
                      void runAction(
                        'add-hidden-gems',
                        () =>
                          onCreateTag(selectedCategory.id, {
                            name: HIDDEN_GEMS_TAG_NAME,
                            priority: 5,
                          }),
                        `Added "${HIDDEN_GEMS_TAG_NAME}" to ${selectedCategory.name}.`,
                        'Failed to add Hidden Gems tag.'
                      )
                    }
                    className="px-3 py-1 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] whitespace-nowrap disabled:opacity-50"
                  >
                    {busyAction === 'add-hidden-gems' ? 'Adding…' : 'Add Hidden Gems Tag'}
                  </button>
                </div>
              )}

              {/* Add tag form + domain-aware interactive suggestion review */}
              <div className="space-y-3">
                <form onSubmit={(e) => void handleAddTag(e)} className="flex flex-col sm:flex-row gap-2">
                  <div className="flex-1">
                    <label htmlFor="new-tag-input" className="sr-only">
                      New tag name
                    </label>
                    <input
                      id="new-tag-input"
                      type="text"
                      value={newTagName}
                      onChange={(e) => setNewTagName(e.target.value)}
                      placeholder={
                        isSelectedCinema
                          ? 'Add a cinema tag (e.g. Psychological Thriller, Stanley Kubrick, A24)…'
                          : `Add a tag to ${selectedCategory.name} (e.g. Olefin metathesis)…`
                      }
                      className="w-full px-3 py-2 text-sm bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none focus:border-[#1E3A5F]"
                    />
                  </div>
                  <div className="flex gap-2">
                    <label htmlFor="new-tag-priority" className="sr-only">
                      Tag priority
                    </label>
                    <select
                      id="new-tag-priority"
                      value={newTagPriority}
                      onChange={(e) => setNewTagPriority(Number(e.target.value))}
                      className="px-2.5 py-2 text-xs bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
                    >
                      {[1, 2, 3, 4, 5].map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABELS[p]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={busyAction === 'add-tag'}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 whitespace-nowrap disabled:opacity-50"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{busyAction === 'add-tag' ? 'Adding Tag…' : 'Add Tag'}</span>
                    </button>
                  </div>
                </form>

                {previewData && (
                  <div className="p-3.5 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/40 dark:bg-[#1C1D1B] space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1.5 font-medium text-[#1E3A5F] dark:text-[#9BBCE8]">
                        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{DOMAIN_LABELS[previewData.domain] || 'Suggested Related Terms'}</span>
                      </span>
                      <span className="text-[11px] text-[#737067] dark:text-[#8E8A80]">
                        {loadingPreview
                          ? 'Updating…'
                          : 'Accept, reject, or edit terms individually before adding'}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      {draftSuggestions.map((item, idx) => (
                        <div
                          key={`${item.facet}-${idx}`}
                          className="flex flex-wrap items-center gap-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            aria-label={`Accept suggested term ${item.term}`}
                            checked={item.accepted}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setDraftSuggestions((prev) =>
                                prev.map((s, i) => (i === idx ? {...s, accepted: checked} : s))
                              );
                            }}
                            className="accent-[#1E3A5F]"
                          />
                          <input
                            type="text"
                            aria-label={`Edit suggested term ${idx + 1}`}
                            value={item.term}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDraftSuggestions((prev) =>
                                prev.map((s, i) => (i === idx ? {...s, term: val} : s))
                              );
                            }}
                            className={`flex-1 min-w-44 px-2 py-1 text-xs bg-[#F6F4EF] dark:bg-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] ${
                              item.accepted ? '' : 'opacity-50 line-through'
                            }`}
                          />
                          <span className="font-mono text-[11px] text-[#737067] dark:text-[#8E8A80] whitespace-nowrap">
                            {item.facet}
                          </span>
                        </div>
                      ))}
                    </div>

                    {previewData.multilingualTerms.length > 0 && (
                      <div className="text-[11px] text-[#57554E] dark:text-[#A8A49B] pt-1 border-t border-[#DDD8CE]/70 dark:border-[#2B2C28]">
                        <span className="font-medium">Multilingual search expansions:</span>{' '}
                        {previewData.multilingualTerms
                          .map((m) => `${m.language.toUpperCase()}: ${m.term}`)
                          .join(' · ')}
                      </div>
                    )}

                    {draftExclusions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-3 text-[11px] text-[#7F2929] dark:text-[#D98A8A]">
                        <span className="font-medium">Auto-exclusions:</span>
                        {draftExclusions.map((ex, idx) => (
                          <label key={ex.term} className="inline-flex items-center gap-1">
                            <input
                              type="checkbox"
                              checked={ex.accepted}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setDraftExclusions((prev) =>
                                  prev.map((x, i) => (i === idx ? {...x, accepted: checked} : x))
                                );
                              }}
                              className="accent-[#7F2929]"
                            />
                            <span>-{ex.term}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Tag table */}
              {selectedCategory.tags.length === 0 ? (
                <p className="py-8 text-sm text-[#57554E] dark:text-[#A8A49B] border-t border-[#DDD8CE] dark:border-[#2B2C28]">
                  No tags configured in {selectedCategory.name} yet. Add your first tag above to begin discovery.
                </p>
              ) : (
                <div className="border-t border-[#DDD8CE] dark:border-[#2B2C28]">
                  {selectedCategory.tags.map((tag) => {
                    const isExpanded = expandedTagId === tag.id;
                    const expandedTerms = tag.relations.filter((r) => r.relationType === 'expanded');
                    const exclusions = tag.relations.filter((r) => r.relationType === 'exclusion');

                    return (
                      <div
                        key={tag.id}
                        className="border-b border-[#DDD8CE] dark:border-[#2B2C28] py-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <button
                              type="button"
                              onClick={() => setExpandedTagId(isExpanded ? null : tag.id)}
                              aria-expanded={isExpanded}
                              aria-label={`Expand terms for ${tag.name}`}
                              className="p-1 text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]"
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-4 h-4" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="w-4 h-4" aria-hidden="true" />
                              )}
                            </button>
                            <span
                              className={`text-sm font-medium ${
                                tag.isEnabled
                                  ? 'text-[#1B1B19] dark:text-[#EAE8E1]'
                                  : 'text-[#737067] line-through'
                              }`}
                            >
                              {tag.name}
                            </span>
                            <span className="font-mono text-xs text-[#737067] dark:text-[#8E8A80] tabular-nums">
                              {expandedTerms.filter((r) => r.isEnabled).length} expanded ·{' '}
                              {exclusions.filter((r) => r.isEnabled).length} excluded
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            <select
                              aria-label={`Priority for ${tag.name}`}
                              value={tag.priority}
                              disabled={busyAction === `tag-prio-${tag.id}`}
                              onChange={(e) => {
                                const nextPriority = Number(e.target.value);
                                void runAction(
                                  `tag-prio-${tag.id}`,
                                  () => onUpdateTag(tag.id, {priority: nextPriority}),
                                  `Updated priority for "${tag.name}".`,
                                  'Failed to update tag priority.'
                                );
                              }}
                              className="px-2 py-1 text-xs bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
                            >
                              {[1, 2, 3, 4, 5].map((p) => (
                                <option key={p} value={p}>
                                  {PRIORITY_LABELS[p]}
                                </option>
                              ))}
                            </select>

                            <label className="inline-flex items-center gap-1 text-xs text-[#57554E] dark:text-[#A8A49B]">
                              <input
                                type="checkbox"
                                checked={tag.isEnabled}
                                disabled={busyAction === `tag-toggle-${tag.id}`}
                                onChange={(e) => {
                                  const checked = e.target.checked;
                                  void runAction(
                                    `tag-toggle-${tag.id}`,
                                    () => onUpdateTag(tag.id, {isEnabled: checked}),
                                    `Tag "${tag.name}" ${checked ? 'enabled' : 'disabled'}.`,
                                    'Failed to toggle tag.'
                                  );
                                }}
                                className="accent-[#1E3A5F]"
                              />
                              <span>On</span>
                            </label>

                            <button
                              type="button"
                              disabled={busyAction === `tag-del-${tag.id}`}
                              onClick={() =>
                                void runAction(
                                  `tag-del-${tag.id}`,
                                  () => onDeleteTag(tag.id),
                                  `Tag "${tag.name}" removed.`,
                                  'Failed to remove tag.'
                                )
                              }
                              aria-label={`Delete tag ${tag.name}`}
                              className="p-1 text-[#737067] hover:text-[#7F2929] dark:hover:text-[#D98A8A] disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="mt-3 pl-7 space-y-3">
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <span className="text-xs font-medium text-[#57554E] dark:text-[#A8A49B]">
                                  Related Expanded Terms (keeps original tag distinct)
                                </span>
                                <button
                                  type="button"
                                  disabled={busyAction === `suggest-${tag.id}`}
                                  onClick={() => void handleSuggestMoreForTag(tag)}
                                  className="inline-flex items-center gap-1 text-[11px] underline underline-offset-2 text-[#1E3A5F] dark:text-[#9BBCE8] disabled:opacity-50"
                                >
                                  <Sparkles className="w-3 h-3" aria-hidden="true" />
                                  <span>
                                    {busyAction === `suggest-${tag.id}`
                                      ? 'Refreshing…'
                                      : 'Refresh domain suggestions'}
                                  </span>
                                </button>
                              </div>
                              <div className="space-y-1">
                                {expandedTerms.map((rel) => (
                                  <div
                                    key={rel.id}
                                    className="flex items-center justify-between text-xs py-1 border-b border-[#DDD8CE]/60 dark:border-[#2B2C28]/60"
                                  >
                                    <label className="inline-flex items-center gap-2 text-[#1B1B19] dark:text-[#EAE8E1]">
                                      <input
                                        type="checkbox"
                                        checked={rel.isEnabled}
                                        onChange={(e) => {
                                          const checked = e.target.checked;
                                          void runAction(
                                            `rel-toggle-${rel.id}`,
                                            () => onToggleTagRelation(rel.id, checked),
                                            `${checked ? 'Enabled' : 'Paused'} related term "${rel.term}".`,
                                            'Failed to update term.'
                                          );
                                        }}
                                        className="accent-[#1E3A5F]"
                                      />
                                      <span className={rel.isEnabled ? '' : 'line-through opacity-60'}>
                                        {rel.term}
                                      </span>
                                      <span className="font-mono text-[11px] text-[#737067]">
                                        {rel.isUserDefined ? 'custom' : 'suggested'}
                                      </span>
                                    </label>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void runAction(
                                          `rel-del-${rel.id}`,
                                          () => onDeleteTagRelation(rel.id),
                                          `Removed related term "${rel.term}".`,
                                          'Failed to remove term.'
                                        )
                                      }
                                      aria-label={`Remove term ${rel.term}`}
                                      className="text-[#737067] hover:text-[#7F2929]"
                                    >
                                      Remove
                                    </button>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {exclusions.length > 0 && (
                              <div>
                                <div className="text-xs font-medium text-[#57554E] dark:text-[#A8A49B] mb-1.5">
                                  Excluded Terms
                                </div>
                                <div className="space-y-1">
                                  {exclusions.map((rel) => (
                                    <div
                                      key={rel.id}
                                      className="flex items-center justify-between text-xs py-1 border-b border-[#DDD8CE]/60 dark:border-[#2B2C28]/60"
                                    >
                                      <label className="inline-flex items-center gap-2 text-[#7F2929] dark:text-[#D98A8A]">
                                        <input
                                          type="checkbox"
                                          checked={rel.isEnabled}
                                          onChange={(e) => {
                                            const checked = e.target.checked;
                                            void runAction(
                                              `rel-toggle-${rel.id}`,
                                              () => onToggleTagRelation(rel.id, checked),
                                              `${checked ? 'Enabled' : 'Paused'} exclusion "-${rel.term}".`,
                                              'Failed to update exclusion.'
                                            );
                                          }}
                                          className="accent-[#7F2929]"
                                        />
                                        <span>-{rel.term}</span>
                                      </label>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void runAction(
                                            `rel-del-${rel.id}`,
                                            () => onDeleteTagRelation(rel.id),
                                            `Removed exclusion "-${rel.term}".`,
                                            'Failed to remove exclusion.'
                                          )
                                        }
                                        aria-label={`Remove exclusion ${rel.term}`}
                                        className="text-[#737067] hover:text-[#7F2929]"
                                      >
                                        Remove
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <form
                              onSubmit={(e) => void handleAddRelation(e, tag)}
                              className="flex flex-wrap items-center gap-2 pt-1"
                            >
                              <label htmlFor={`rel-term-${tag.id}`} className="sr-only">
                                Add related or excluded term
                              </label>
                              <input
                                id={`rel-term-${tag.id}`}
                                type="text"
                                value={newRelationTerm}
                                onChange={(e) => setNewRelationTerm(e.target.value)}
                                placeholder="Add related or excluded term…"
                                className="flex-1 min-w-44 px-2.5 py-1 text-xs bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
                              />
                              <select
                                aria-label="Term relation type"
                                value={newRelationType}
                                onChange={(e) =>
                                  setNewRelationType(e.target.value as 'expanded' | 'exclusion')
                                }
                                className="px-2 py-1 text-xs bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
                              >
                                <option value="expanded">Related term</option>
                                <option value="exclusion">Exclusion (-term)</option>
                              </select>
                              <button
                                type="submit"
                                disabled={busyAction === `add-rel-${tag.id}`}
                                className="px-3 py-1 text-xs font-medium bg-[#1B1B19] text-[#F6F4EF] dark:bg-[#EAE8E1] dark:text-[#141514] disabled:opacity-50"
                              >
                                {busyAction === `add-rel-${tag.id}` ? 'Adding…' : 'Add Term'}
                              </button>
                            </form>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-[#57554E] dark:text-[#A8A49B]">
              Create a category on the left to begin organizing tags.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
