import {Dices, Globe} from 'lucide-react';
import {useCallback, useEffect, useState} from 'react';
import type {
  ArchiveFormat,
  ArchiveRecord,
  ArchiveStatus,
  Category,
  CategorySelection,
  ContentItem,
  DiscoveryQueryLog,
  FeedFilterType,
  FeedbackType,
  ProviderHealthMetric,
  ProviderStatusInfo,
  SortOption,
  UserPreferences,
} from '../shared/types';
import {ArchiveLibraryView} from './components/ArchiveLibraryView';
import {ArchiveModal} from './components/ArchiveModal';
import {ArchiveViewerModal, type ArchiveViewerTab} from './components/ArchiveViewerModal';
import {CategoryStrip} from './components/CategoryStrip';
import {FeedItemRow} from './components/FeedItemRow';
import {FeedToolbar} from './components/FeedToolbar';
import {OfflineIndicator} from './components/OfflineIndicator';
import {OnboardingView} from './components/OnboardingView';
import {SourcesSettingsView} from './components/SourcesSettingsView';
import {TopicsManager} from './components/TopicsManager';
import {TopMasthead, type ActiveSection} from './components/TopMasthead';
import {api, type FeedCounts} from './services/api';

const EMPTY_COUNTS: FeedCounts = {
  all: 0,
  news: 0,
  article: 0,
  video: 0,
  toWatch: 0,
  aboutFilm: 0,
  unread: 0,
  saved: 0,
  notes: 0,
  languages: [],
};

function isCategoryEntertainment(cat: Category | null | undefined): boolean {
  if (!cat) return false;
  const lower = cat.name.trim().toLowerCase();
  return (
    cat.icon === 'film' ||
    /\b(cinema|film|films|movie|movies|filmes|pel[ií]culas|entertainment|entretenimento|series|television|tv|anime)\b/i.test(
      lower
    )
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [preferences, setPreferences] = useState<UserPreferences | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeSection, setActiveSection] = useState<ActiveSection>('feed');
  const [activeCategoryId, setActiveCategoryId] = useState<CategorySelection>('all');
  const [luckySeed, setLuckySeed] = useState(1);
  const [filter, setFilter] = useState<FeedFilterType>('all');
  const [sort, setSort] = useState<SortOption>('relevant');
  const [search, setSearch] = useState('');
  const [languageFilter, setLanguageFilter] = useState<string | 'all'>('all');
  const [page, setPage] = useState(1);

  const [items, setItems] = useState<ContentItem[]>([]);
  const [totalItems, setTotalItems] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<FeedCounts>(EMPTY_COUNTS);
  const [loadingFeed, setLoadingFeed] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);

  const [isSearchingWeb, setIsSearchingWeb] = useState(false);
  const [liveSearchActiveQuery, setLiveSearchActiveQuery] = useState<string | null>(null);

  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryNotice, setDiscoveryNotice] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [hiddenUndoItem, setHiddenUndoItem] = useState<ContentItem | null>(null);

  const [providers, setProviders] = useState<ProviderStatusInfo[]>([]);
  const [providerHealth, setProviderHealth] = useState<ProviderHealthMetric[]>([]);
  const [recentLogs, setRecentLogs] = useState<DiscoveryQueryLog[]>([]);

  const [archivedItemMap, setArchivedItemMap] = useState<
    Record<number, {archiveUid: string; formats: ArchiveFormat[]; status: ArchiveStatus}>
  >({});
  const [archiveModalState, setArchiveModalState] = useState<{
    isOpen: boolean;
    item: ContentItem | null;
    initialUrl?: string;
  }>({isOpen: false, item: null});
  const [viewerState, setViewerState] = useState<{
    archive: ArchiveRecord | null;
    initialTab: ArchiveViewerTab;
  }>({archive: null, initialTab: 'html'});
  const [archiveLibraryRefreshToken, setArchiveLibraryRefreshToken] = useState(0);

  // Apply Light / Dark theme class to <html>
  useEffect(() => {
    const theme = preferences?.theme || 'light';
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#141514' : '#F6F4EF');
    }
  }, [preferences?.theme]);

  const loadFeed = useCallback(
    async (opts?: {
      categoryId?: CategorySelection;
      filter?: FeedFilterType;
      sort?: SortOption;
      search?: string;
      language?: string | 'all';
      luckySeed?: number;
      page?: number;
      append?: boolean;
    }) => {
      const catId = opts?.categoryId ?? activeCategoryId;
      const nextFilter = opts?.filter ?? filter;
      const nextSort = opts?.sort ?? sort;
      const nextSearch = opts?.search ?? search;
      const nextLanguage = opts?.language ?? languageFilter;
      const nextLuckySeed = opts?.luckySeed ?? luckySeed;
      const nextPage = opts?.page ?? 1;

      setLoadingFeed(true);
      setFeedError(null);
      try {
        const res = await api.getFeed({
          categoryId: catId,
          filter: nextFilter,
          sort: nextSort,
          search: nextSearch,
          language: nextLanguage,
          luckySeed: nextLuckySeed,
          page: nextPage,
          pageSize: 24,
        });
        setItems((prev) => (opts?.append ? [...prev, ...res.items] : res.items));
        setTotalItems(res.total);
        setHasMore(res.hasMore);
        setCounts(res.counts);
        setPage(nextPage);
      } catch (err) {
        setFeedError(err instanceof Error ? err.message : 'Unable to load feed');
      } finally {
        setLoadingFeed(false);
      }
    },
    [activeCategoryId, filter, sort, search, languageFilter, luckySeed]
  );

  const loadDiscoveryStatus = useCallback(async () => {
    try {
      const st = await api.getDiscoveryStatus();
      setProviders(st.providers);
      setProviderHealth(st.providerHealth || []);
      setRecentLogs(st.recentLogs);
    } catch {
      // Non-blocking when offline
    }
  }, []);

  const refreshArchivedMap = useCallback(async () => {
    try {
      const map = await api.getArchivedItemMap();
      setArchivedItemMap(map);
    } catch {
      // Non-blocking when offline
    }
  }, []);

  // Initial bootstrap
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const [prefs, cats] = await Promise.all([api.getPreferences(), api.getCategories()]);
        if (cancelled) return;

        // Check ?autostart=1 to allow instant non-blocking startup into populated starter feed
        const urlParams = new URLSearchParams(window.location.search);
        let finalCats = cats;
        let finalPrefs = prefs;

        if (urlParams.get('autostart') === '1' && cats.length === 0) {
          finalCats = await api.seedStarterWorkspace();
          finalPrefs = await api.updatePreferences({onboardingCompleted: true});
        }

        setPreferences(finalPrefs);
        setCategories(finalCats);

        const validActiveCat =
          finalPrefs.activeCategoryId === 'all' ||
          finalCats.some((c) => c.id === finalPrefs.activeCategoryId)
            ? finalPrefs.activeCategoryId
            : 'all';
        setActiveCategoryId(validActiveCat);

        if (finalCats.length > 0) {
          const feedRes = await api.getFeed({
            categoryId: validActiveCat,
            filter: 'all',
            sort: 'relevant',
            search: '',
            language: 'all',
            page: 1,
            pageSize: 24,
          });
          if (!cancelled) {
            setItems(feedRes.items);
            setTotalItems(feedRes.total);
            setHasMore(feedRes.hasMore);
            setCounts(feedRes.counts);
          }

          // If starter workspace was just seeded via autostart and has no items yet, run discovery
          if (urlParams.get('autostart') === '1' && feedRes.total === 0) {
            setIsDiscovering(true);
            try {
              await api.runDiscovery(undefined, true);
              const refreshed = await api.getFeed({
                categoryId: validActiveCat,
                filter: 'all',
                sort: 'relevant',
                search: '',
                language: 'all',
                page: 1,
                pageSize: 24,
              });
              if (!cancelled) {
                setItems(refreshed.items);
                setTotalItems(refreshed.total);
                setHasMore(refreshed.hasMore);
                setCounts(refreshed.counts);
              }
            } finally {
              if (!cancelled) setIsDiscovering(false);
            }
          }
        }
        await Promise.all([loadDiscoveryStatus(), refreshArchivedMap()]);
      } catch (err) {
        if (!cancelled) {
          setFeedError(err instanceof Error ? err.message : 'Failed to initialize Discover');
        }
      } finally {
        if (!cancelled) setBooting(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [loadDiscoveryStatus, refreshArchivedMap]);

  // Reload feed whenever filters/search/category/language change after initial boot
  useEffect(() => {
    if (booting || categories.length === 0) return;
    if (activeSection !== 'feed' && activeSection !== 'saved') return;
    if (liveSearchActiveQuery && search.trim() === liveSearchActiveQuery) return;

    const effectiveFilter: FeedFilterType = activeSection === 'saved' ? 'saved' : filter;
    const effectiveCategoryId = activeSection === 'saved' ? 'all' : activeCategoryId;
    const timer = setTimeout(() => {
      void loadFeed({
        categoryId: effectiveCategoryId,
        filter: effectiveFilter,
        sort,
        search,
        language: languageFilter,
        luckySeed,
        page: 1,
        append: false,
      });
    }, search ? 180 : 0);

    return () => clearTimeout(timer);
  }, [
    booting,
    categories.length,
    activeSection,
    activeCategoryId,
    filter,
    sort,
    search,
    languageFilter,
    luckySeed,
    liveSearchActiveQuery,
    loadFeed,
  ]);

  const handleSelectSection = (section: ActiveSection) => {
    setLiveSearchActiveQuery(null);
    setActiveSection(section);
    if (section === 'saved') {
      setFilter('saved');
    } else if (section === 'feed' && filter === 'saved') {
      setFilter('all');
    }
    if (section === 'sources') {
      void loadDiscoveryStatus();
    }
  };

  const handleSelectCategory = async (id: CategorySelection) => {
    const nextCatObj =
      typeof id === 'number' ? categories.find((c) => c.id === id) || null : null;
    const nextIsEntertainment = isCategoryEntertainment(nextCatObj);

    setLiveSearchActiveQuery(null);
    setActiveCategoryId(id);
    setLanguageFilter('all');

    // Clear stale film sub-tabs and film filter immediately when switching to non-entertainment tabs
    if (!nextIsEntertainment && id !== 'all') {
      setCounts((prev) => ({...prev, toWatch: 0, aboutFilm: 0}));
      if (filter === 'to_watch' || filter === 'about_film') {
        setFilter('all');
      }
    }

    if (id === 'lucky') {
      setLuckySeed((prev) => prev + 1);
      if (filter === 'to_watch' || filter === 'about_film' || filter === 'saved') {
        setFilter('all');
      }
    }

    if (activeSection !== 'feed' && activeSection !== 'saved') {
      setActiveSection('feed');
    }
    if (id !== 'lucky') {
      try {
        const updated = await api.updatePreferences({activeCategoryId: id});
        setPreferences(updated);
      } catch {
        // Ignore offline preference persistence error
      }
    }
  };

  const handleLiveWebSearch = async (queryText: string) => {
    const clean = queryText.trim();
    if (!clean || isSearchingWeb) return;
    setIsSearchingWeb(true);
    setFeedError(null);
    setDiscoveryNotice(null);
    try {
      const res = await api.liveSearch({
        query: clean,
        language: languageFilter,
        sort: sort === 'oldest' ? 'oldest' : 'newest',
        filter,
      });
      setLiveSearchActiveQuery(clean);
      setItems(res.items);
      setTotalItems(res.total);
      setHasMore(false);
      setDiscoveryNotice({
        type: res.errors.length > 0 && res.total === 0 ? 'error' : 'success',
        message:
          res.total > 0
            ? `Web search found ${res.total} recent results for "${clean}".`
            : `No new web results matched "${clean}" right now.`,
      });
    } catch (err) {
      setDiscoveryNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Web search failed.',
      });
    } finally {
      setIsSearchingWeb(false);
    }
  };

  const handleRunDiscovery = async (categoryId?: number) => {
    if (isDiscovering) return;
    setIsDiscovering(true);
    setDiscoveryNotice(null);
    try {
      const summary = await api.runDiscovery(categoryId, true);
      await Promise.all([
        loadFeed({
          categoryId: activeSection === 'saved' ? 'all' : activeCategoryId,
          filter: activeSection === 'saved' ? 'saved' : filter,
          luckySeed,
          page: 1,
          append: false,
        }),
        loadDiscoveryStatus(),
      ]);
      const pruned = summary.itemsPruned || 0;
      const prunedText =
        pruned > 0 ? ` · ${pruned} outdated entr${pruned === 1 ? 'y' : 'ies'} removed` : '';
      if (summary.itemsAdded > 0) {
        setDiscoveryNotice({
          type: 'success',
          message: `Feed updated: ${summary.itemsAdded} new item${summary.itemsAdded === 1 ? '' : 's'} added across ${summary.queriesExecuted} queries${prunedText}.`,
        });
      } else if (summary.errors.length > 0) {
        setDiscoveryNotice({
          type: 'error',
          message: `Completed with notices: ${summary.errors[0]}${prunedText}`,
        });
      } else if (pruned > 0) {
        setDiscoveryNotice({
          type: 'success',
          message: `Feed synchronized: ${pruned} outdated entr${pruned === 1 ? 'y' : 'ies'} removed; no new unseen items matched right now.`,
        });
      } else {
        setDiscoveryNotice({
          type: 'success',
          message: 'Feed is up to date — all entries match your active preferences.',
        });
      }
    } catch (err) {
      setDiscoveryNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Feed update failed.',
      });
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleCreateFirstCategory = async (categoryName: string, tags: string[]) => {
    setIsDiscovering(true);
    try {
      const cat = await api.createCategory(categoryName);
      for (const tagName of tags) {
        await api.createTag(cat.id, {name: tagName, priority: 3});
      }
      const nextCats = await api.getCategories();
      const nextPrefs = await api.updatePreferences({
        onboardingCompleted: true,
        activeCategoryId: cat.id,
      });
      setCategories(nextCats);
      setPreferences(nextPrefs);
      setActiveCategoryId(cat.id);
      await api.runDiscovery(cat.id, true);
      await Promise.all([loadFeed({categoryId: cat.id, page: 1}), loadDiscoveryStatus()]);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleLoadStarter = async () => {
    setIsDiscovering(true);
    try {
      const nextCats = await api.seedStarterWorkspace();
      const nextPrefs = await api.updatePreferences({
        onboardingCompleted: true,
        activeCategoryId: 'all',
      });
      setCategories(nextCats);
      setPreferences(nextPrefs);
      setActiveCategoryId('all');
      await api.runDiscovery(undefined, true);
      await Promise.all([loadFeed({categoryId: 'all', page: 1}), loadDiscoveryStatus()]);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleToggleTheme = async () => {
    const nextTheme = preferences?.theme === 'dark' ? 'light' : 'dark';
    setPreferences((prev) => (prev ? {...prev, theme: nextTheme} : prev));
    try {
      const updated = await api.updatePreferences({theme: nextTheme});
      setPreferences(updated);
    } catch {
      // Keep UI theme even if offline
    }
  };

  const handleToggleSave = async (item: ContentItem) => {
    const nextSaved = !item.isSaved;
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? {...it, isSaved: nextSaved} : it))
    );
    setCounts((prev) => ({
      ...prev,
      saved: Math.max(0, prev.saved + (nextSaved ? 1 : -1)),
    }));
    await api.updateFeedback(item.id, {isSaved: nextSaved});
    if (filter === 'saved' && !nextSaved) {
      setItems((prev) => prev.filter((it) => it.id !== item.id));
    }
  };

  const handleToggleRead = async (item: ContentItem) => {
    const nextRead = !item.isRead;
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? {...it, isRead: nextRead} : it))
    );
    setCounts((prev) => ({
      ...prev,
      unread: Math.max(0, prev.unread + (nextRead ? -1 : 1)),
    }));
    await api.updateFeedback(item.id, {isRead: nextRead});
    if (filter === 'unread' && nextRead) {
      setItems((prev) => prev.filter((it) => it.id !== item.id));
    }
  };

  const handleOpenOriginal = (item: ContentItem) => {
    if (!item.isRead) {
      void handleToggleRead(item);
    }
  };

  const handleSetFeedback = async (item: ContentItem, next: FeedbackType) => {
    setItems((prev) =>
      prev.map((it) => (it.id === item.id ? {...it, feedbackType: next} : it))
    );
    await api.updateFeedback(item.id, {feedbackType: next});
  };

  const handleHideItem = async (item: ContentItem) => {
    setItems((prev) => prev.filter((it) => it.id !== item.id));
    setHiddenUndoItem(item);
    await api.updateFeedback(item.id, {isHidden: true});
  };

  const handleUndoHide = async () => {
    if (!hiddenUndoItem) return;
    const target = hiddenUndoItem;
    setHiddenUndoItem(null);
    await api.updateFeedback(target.id, {isHidden: false});
    await loadFeed({page: 1, append: false});
  };

  const handleSaveNote = async (item: ContentItem, noteText: string) => {
    const hadNote = Boolean(item.note && item.note.trim());
    const saved = await api.upsertNote({
      contentItemId: item.id,
      canonicalUrl: item.canonicalUrl,
      noteText,
    });
    const hasNow = Boolean(saved && saved.noteText.trim());
    setItems((prev) => {
      const mapped = prev.map((it) =>
        it.id === item.id
          ? {
              ...it,
              note: saved?.noteText ?? null,
              noteUpdatedAt: saved?.updatedAt ?? null,
            }
          : it
      );
      return filter === 'notes' && !hasNow ? mapped.filter((it) => it.id !== item.id) : mapped;
    });
    if (hadNote !== hasNow) {
      setCounts((prev) => ({
        ...prev,
        notes: Math.max(0, prev.notes + (hasNow ? 1 : -1)),
      }));
    }
  };

  const refreshCategories = async () => {
    const cats = await api.getCategories();
    setCategories(cats);
  };

  const currentCategory =
    typeof activeCategoryId === 'number'
      ? categories.find((c) => c.id === activeCategoryId) || null
      : null;

  const isEntertainmentCategory = isCategoryEntertainment(currentCategory);

  const activeLanguages =
    currentCategory?.languages && currentCategory.languages.length > 0
      ? currentCategory.languages
      : preferences?.languages || ['en'];
  const activeRegions =
    currentCategory?.regions && currentCategory.regions.length > 0
      ? currentCategory.regions
      : preferences?.regions || ['US'];

  const youtubeProvider = providers.find((p) => p.providerName === 'youtube');

  return (
    <div className="min-h-screen bg-[#F6F4EF] dark:bg-[#141514] text-[#1B1B19] dark:text-[#EAE8E1] transition-colors">
      <TopMasthead
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        onRefreshDiscovery={() =>
          void handleRunDiscovery(typeof activeCategoryId === 'number' ? activeCategoryId : undefined)
        }
        isDiscovering={isDiscovering}
        hasCategories={categories.length > 0}
      />

      {booting ? (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
          <div className="space-y-4">
            <div className="h-6 w-48 bg-[#EFECE4] dark:bg-[#1C1D1B]" />
            <div className="h-20 w-full bg-[#EFECE4] dark:bg-[#1C1D1B]" />
            <div className="h-20 w-full bg-[#EFECE4] dark:bg-[#1C1D1B]" />
          </div>
        </main>
      ) : categories.length === 0 && activeSection === 'feed' ? (
        <main>
          <OnboardingView
            onCreateFirstCategory={handleCreateFirstCategory}
            onLoadStarter={handleLoadStarter}
            isBusy={isDiscovering}
          />
        </main>
      ) : (
        <>
          {(activeSection === 'feed' || activeSection === 'saved') && (
            <>
              <CategoryStrip
                categories={categories}
                activeCategoryId={activeCategoryId}
                onSelectCategory={(id) => void handleSelectCategory(id)}
                onCreateCategory={async (name) => {
                  const created = await api.createCategory(name);
                  await refreshCategories();
                  setActiveCategoryId(created.id);
                  setActiveSection('topics');
                }}
                onOpenTopicsManager={() => setActiveSection('topics')}
              />
              <FeedToolbar
                filter={activeSection === 'saved' ? 'saved' : filter}
                onFilterChange={(f) => {
                  setLiveSearchActiveQuery(null);
                  setFilter(f);
                  if (activeSection === 'saved' && f !== 'saved') {
                    setActiveSection('feed');
                  }
                }}
                sort={sort}
                onSortChange={(nextSort) => {
                  setLiveSearchActiveQuery(null);
                  setSort(nextSort);
                }}
                search={search}
                onSearchChange={(val) => {
                  if (val.trim() !== liveSearchActiveQuery) {
                    setLiveSearchActiveQuery(null);
                  }
                  setSearch(val);
                }}
                onSubmitSearch={(q) => {
                  if (!q) {
                    setLiveSearchActiveQuery(null);
                    return;
                  }
                  void loadFeed({
                    categoryId: activeSection === 'saved' ? 'all' : activeCategoryId,
                    filter: activeSection === 'saved' ? 'saved' : filter,
                    sort,
                    search: q,
                    language: languageFilter,
                    luckySeed,
                    page: 1,
                    append: false,
                  });
                }}
                languageFilter={languageFilter}
                onLanguageFilterChange={(lang) => {
                  setLiveSearchActiveQuery(null);
                  setLanguageFilter(lang);
                }}
                customLanguages={preferences?.customLanguages || []}
                isEntertainmentCategory={isEntertainmentCategory}
                isAllCategories={activeCategoryId === 'all' && activeSection !== 'saved'}
                counts={counts}
                theme={preferences?.theme || 'light'}
                onToggleTheme={() => void handleToggleTheme()}
              />
            </>
          )}

          <main className="pb-16">
            {(activeSection === 'feed' || activeSection === 'saved') && (
              <div className="max-w-6xl mx-auto px-3 sm:px-6">
                {/* Editorial issue header & active locale summary */}
                <div className="pt-5 pb-3 border-b border-[#DDD8CE] dark:border-[#2B2C28] flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-3">
                      <h1 className="font-serif text-2xl font-semibold text-[#1B1B19] dark:text-[#EAE8E1]">
                        {activeSection === 'saved'
                          ? 'Saved Reading List'
                          : activeCategoryId === 'lucky'
                            ? "I'm Feeling Lucky"
                            : currentCategory
                              ? currentCategory.name
                              : 'All Interests'}
                      </h1>
                      {activeCategoryId === 'lucky' && activeSection === 'feed' && (
                        <button
                          type="button"
                          onClick={() => setLuckySeed((prev) => prev + 1)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border border-[#1E3A5F] dark:border-[#6B92C4] text-[#1E3A5F] dark:text-[#9BBCE8] hover:bg-[#1E3A5F]/10 dark:hover:bg-[#6B92C4]/15 transition-colors"
                        >
                          <Dices className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Shuffle Picks</span>
                        </button>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[#737067] dark:text-[#8E8A80] font-mono tabular-nums">
                      {totalItems} {totalItems === 1 ? 'entry' : 'entries'}
                      {activeCategoryId === 'lucky' && activeSection === 'feed'
                        ? ' · Serendipitous cross-topic mix'
                        : currentCategory
                          ? ` · ${currentCategory.tags.filter((t) => t.isEnabled).length} active tags`
                          : ''}
                      {' · '}
                      <button
                        type="button"
                        onClick={() => setActiveSection(currentCategory ? 'topics' : 'sources')}
                        className="underline underline-offset-2 hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]"
                        title="Configure active languages and regions"
                      >
                        Lang: {activeLanguages.map((l) => l.toUpperCase()).join(', ')} · Reg:{' '}
                        {activeRegions.join(', ')}
                        {currentCategory && (currentCategory.languages || currentCategory.regions)
                          ? ' (tab)'
                          : ''}
                      </button>
                    </p>
                  </div>

                  {discoveryNotice && (
                    <p
                      role={discoveryNotice.type === 'error' ? 'alert' : 'status'}
                      className={`text-xs font-medium ${
                        discoveryNotice.type === 'error'
                          ? 'text-[#7F2929] dark:text-[#D98A8A]'
                          : 'text-[#3F5E45] dark:text-[#8FB896]'
                      }`}
                    >
                      {discoveryNotice.message}
                    </p>
                  )}
                </div>

                {/* Active search context bar with on-demand Web Search button */}
                {search.trim().length >= 2 && activeSection === 'feed' && (
                  <div className="py-2.5 border-b border-[#DDD8CE] dark:border-[#2B2C28] flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-[#57554E] dark:text-[#A8A49B]">
                      {liveSearchActiveQuery === search.trim()
                        ? `Showing live web results for "${search.trim()}"`
                        : `Filtering collected feed for "${search.trim()}"`}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void handleLiveWebSearch(search)}
                        disabled={isSearchingWeb}
                        className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 disabled:opacity-60 transition-opacity whitespace-nowrap"
                      >
                        <Globe className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          {isSearchingWeb
                            ? 'Searching Web Sources…'
                            : `Search Web Sources for "${search.trim()}"`}
                        </span>
                      </button>
                      {liveSearchActiveQuery && (
                        <button
                          type="button"
                          onClick={() => {
                            setLiveSearchActiveQuery(null);
                            void loadFeed({page: 1, append: false});
                          }}
                          className="px-2.5 py-1 text-xs border border-[#DDD8CE] dark:border-[#2B2C28] text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]"
                        >
                          Back to Local Feed
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Unconfigured YouTube note strictly when filtering Videos */}
                {filter === 'video' && youtubeProvider && !youtubeProvider.isConfigured && (
                  <div className="my-4 p-4 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/70 dark:bg-[#1C1D1B] text-xs text-[#57554E] dark:text-[#A8A49B]">
                    <strong className="text-[#1B1B19] dark:text-[#EAE8E1]">
                      Video discovery is not configured:
                    </strong>{' '}
                    Set <code className="font-mono">YOUTUBE_API_KEY</code> on the server to enable
                    automatic YouTube discovery. News and scientific publication providers continue
                    operating normally.
                  </div>
                )}

                {feedError && (
                  <div
                    role="alert"
                    className="my-4 p-4 border border-[#7F2929]/40 bg-[#7F2929]/5 text-xs text-[#7F2929] dark:text-[#D98A8A]"
                  >
                    {feedError}
                  </div>
                )}

                {(loadingFeed || isSearchingWeb) && items.length === 0 ? (
                  <div className="py-10 space-y-6">
                    {[1, 2, 3, 4].map((n) => (
                      <div key={n} className="pb-5 border-b border-[#DDD8CE] dark:border-[#2B2C28] space-y-2">
                        <div className="h-3 w-44 bg-[#EFECE4] dark:bg-[#1C1D1B]" />
                        <div className="h-5 w-3/4 bg-[#EFECE4] dark:bg-[#1C1D1B]" />
                        <div className="h-4 w-2/3 bg-[#EFECE4] dark:bg-[#1C1D1B]" />
                      </div>
                    ))}
                  </div>
                ) : items.length === 0 ? (
                  <div className="py-14 max-w-lg">
                    <h2 className="font-serif text-xl font-semibold text-[#1B1B19] dark:text-[#EAE8E1]">
                      {search
                        ? `No matches for "${search}"`
                        : filter === 'saved'
                          ? 'No saved items yet'
                          : filter === 'to_watch'
                            ? 'No film recommendations matching right now'
                            : filter === 'about_film'
                              ? 'No film commentary or industry articles yet'
                              : currentCategory && currentCategory.tags.length === 0
                                ? `No tags configured in ${currentCategory.name}`
                                : 'No content discovered yet'}
                    </h2>
                    <p className="mt-2 text-sm text-[#57554E] dark:text-[#A8A49B] leading-relaxed">
                      {search
                        ? 'Search across live news, Crossref papers, and arXiv preprints for this query, or clear the search filter.'
                        : filter === 'saved'
                          ? 'Use the Save action on any news item, paper, or video to keep it here for offline reading.'
                          : filter === 'to_watch' || filter === 'about_film'
                            ? 'Run discovery on a Cinema tab or switch to All to view both film recommendations and film coverage.'
                            : currentCategory && currentCategory.tags.length === 0
                              ? 'Add one or more interest tags to this category so Discover knows what to search for.'
                              : 'Run discovery to pull the latest news, scholarly publications, and preprints matching your tags.'}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-3">
                      {search ? (
                        <>
                          {activeSection === 'feed' && (
                            <button
                              type="button"
                              onClick={() => void handleLiveWebSearch(search)}
                              disabled={isSearchingWeb}
                              className="px-3.5 py-1.5 text-xs font-medium bg-[#1E3A5F] text-[#F6F4EF] disabled:opacity-60"
                            >
                              {isSearchingWeb
                                ? 'Searching Web Sources…'
                                : `Search Web Sources for "${search.trim()}"`}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setLiveSearchActiveQuery(null);
                              setSearch('');
                            }}
                            className="px-3.5 py-1.5 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
                          >
                            Clear Search
                          </button>
                        </>
                      ) : filter === 'saved' || filter === 'to_watch' || filter === 'about_film' ? (
                        <button
                          type="button"
                          onClick={() => {
                            setFilter('all');
                            setActiveSection('feed');
                          }}
                          className="px-3.5 py-1.5 text-xs font-medium bg-[#1E3A5F] text-[#F6F4EF]"
                        >
                          Return to Feed
                        </button>
                      ) : currentCategory && currentCategory.tags.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => setActiveSection('topics')}
                          className="px-3.5 py-1.5 text-xs font-medium bg-[#1E3A5F] text-[#F6F4EF]"
                        >
                          Add Tags to {currentCategory.name}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() =>
                            void handleRunDiscovery(
                              typeof activeCategoryId === 'number' ? activeCategoryId : undefined
                            )
                          }
                          disabled={isDiscovering}
                          className="px-3.5 py-1.5 text-xs font-medium bg-[#1E3A5F] text-[#F6F4EF] disabled:opacity-60"
                        >
                          {isDiscovering ? 'Updating Feed…' : 'Update Feed'}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    <div>
                      {items.map((item) => (
                        <FeedItemRow
                          key={item.id}
                          item={item}
                          archiveBadge={archivedItemMap[item.id] || null}
                          onToggleSave={(it) => void handleToggleSave(it)}
                          onToggleRead={(it) => void handleToggleRead(it)}
                          onSetFeedback={(it, fb) => void handleSetFeedback(it, fb)}
                          onHide={(it) => void handleHideItem(it)}
                          onOpenOriginal={handleOpenOriginal}
                          onArchive={(it) =>
                            setArchiveModalState({isOpen: true, item: it})
                          }
                          onSaveNote={handleSaveNote}
                        />
                      ))}
                    </div>

                    {hasMore && (
                      <div className="pt-6 flex justify-center">
                        <button
                          type="button"
                          disabled={loadingFeed}
                          onClick={() =>
                            void loadFeed({
                              page: page + 1,
                              append: true,
                            })
                          }
                          className="px-5 py-2 text-xs font-medium border border-[#1B1B19] dark:border-[#EAE8E1] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] disabled:opacity-50"
                        >
                          {loadingFeed ? 'Loading…' : 'Load More Entries'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {activeSection === 'archive' && (
              <ArchiveLibraryView
                refreshToken={archiveLibraryRefreshToken}
                onOpenArchiveUrlModal={(url) =>
                  setArchiveModalState({isOpen: true, item: null, initialUrl: url})
                }
                onOpenViewer={(archive, tab) =>
                  setViewerState({archive, initialTab: tab})
                }
                onArchiveDeletedOrRestored={() => {
                  void refreshArchivedMap();
                }}
              />
            )}

            {activeSection === 'topics' && preferences && (
              <TopicsManager
                categories={categories}
                preferences={preferences}
                onCreateCategory={async (name, icon) => {
                  await api.createCategory(name, icon);
                  await refreshCategories();
                }}
                onAddCinemaPreset={async () => {
                  const res = await api.addCinemaPreset();
                  setCategories(res.categories);
                  return res.category?.id ?? res.categories.find((c) => c.slug === 'cinema')?.id;
                }}
                onUpdateCategory={async (id, patch) => {
                  await api.updateCategory(id, patch);
                  await refreshCategories();
                }}
                onDeleteCategory={async (id) => {
                  await api.deleteCategory(id);
                  if (activeCategoryId === id) {
                    setActiveCategoryId('all');
                  }
                  await refreshCategories();
                }}
                onReorderCategories={async (orderedIds) => {
                  const reordered = await api.reorderCategories(orderedIds);
                  setCategories(reordered);
                }}
                onPreviewTagSuggestions={api.suggestTagTerms}
                onCreateTag={async (categoryId, input) => {
                  await api.createTag(categoryId, input);
                  await refreshCategories();
                }}
                onUpdateTag={async (id, patch) => {
                  await api.updateTag(id, patch);
                  await refreshCategories();
                }}
                onDeleteTag={async (id) => {
                  await api.deleteTag(id);
                  await refreshCategories();
                }}
                onAddTagRelation={async (tagId, term, type) => {
                  await api.addTagRelation(tagId, term, type);
                  await refreshCategories();
                }}
                onToggleTagRelation={async (id, isEnabled) => {
                  await api.toggleTagRelation(id, isEnabled);
                  await refreshCategories();
                }}
                onDeleteTagRelation={async (id) => {
                  await api.deleteTagRelation(id);
                  await refreshCategories();
                }}
                onAddCustomLanguage={async ({code, name}) => {
                  const updated = await api.addCustomLanguage(code, name);
                  setPreferences(updated);
                }}
                onRemoveCustomLanguage={async (code) => {
                  const updated = await api.removeCustomLanguage(code);
                  setPreferences(updated);
                  await refreshCategories();
                }}
                onAddCustomRegion={async (input) => {
                  const updated = await api.addCustomRegion(input);
                  setPreferences(updated);
                }}
                onRemoveCustomRegion={async (code) => {
                  const updated = await api.removeCustomRegion(code);
                  setPreferences(updated);
                  await refreshCategories();
                }}
                onRunCategoryDiscovery={async (catId) => {
                  setActiveCategoryId(catId);
                  setActiveSection('feed');
                  await handleRunDiscovery(catId);
                }}
                isDiscovering={isDiscovering}
              />
            )}

            {activeSection === 'sources' && preferences && (
              <SourcesSettingsView
                providers={providers}
                providerHealth={providerHealth}
                recentLogs={recentLogs}
                preferences={preferences}
                onToggleProvider={async (name, isEnabled) => {
                  const updated = await api.setProviderEnabled(name, isEnabled);
                  setProviders(updated);
                  void loadDiscoveryStatus();
                }}
                onUpdatePreferences={async (patch) => {
                  const updated = await api.updatePreferences(patch);
                  setPreferences(updated);
                }}
                onAddCustomLanguage={async ({code, name}) => {
                  const updated = await api.addCustomLanguage(code, name);
                  setPreferences(updated);
                }}
                onRemoveCustomLanguage={async (code) => {
                  const updated = await api.removeCustomLanguage(code);
                  setPreferences(updated);
                  await refreshCategories();
                }}
                onAddCustomRegion={async (input) => {
                  const updated = await api.addCustomRegion(input);
                  setPreferences(updated);
                }}
                onRemoveCustomRegion={async (code) => {
                  const updated = await api.removeCustomRegion(code);
                  setPreferences(updated);
                  await refreshCategories();
                }}
                onUpdateFeed={async () => {
                  setActiveSection('feed');
                  await handleRunDiscovery(
                    typeof activeCategoryId === 'number' ? activeCategoryId : undefined
                  );
                }}
                isDiscovering={isDiscovering}
                onImportBackup={async (payload) => {
                  const res = await api.importBackup(payload);
                  const [nextPrefs] = await Promise.all([api.getPreferences(), refreshCategories()]);
                  setPreferences(nextPrefs);
                  await loadFeed({page: 1, append: false});
                  return res;
                }}
              />
            )}
          </main>
        </>
      )}

      {hiddenUndoItem && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-3 px-4 py-2.5 text-xs bg-[#1B1B19] text-[#F6F4EF] dark:bg-[#EAE8E1] dark:text-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28]"
        >
          <span>Item hidden from feed.</span>
          <button
            type="button"
            onClick={() => void handleUndoHide()}
            className="underline font-medium"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={() => setHiddenUndoItem(null)}
            aria-label="Dismiss hide notification"
            className="opacity-70 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      <ArchiveModal
        isOpen={archiveModalState.isOpen}
        item={archiveModalState.item}
        initialUrl={archiveModalState.initialUrl}
        existingBadge={
          archiveModalState.item ? archivedItemMap[archiveModalState.item.id] || null : null
        }
        onClose={() => setArchiveModalState({isOpen: false, item: null})}
        onArchiveComplete={() => {
          void refreshArchivedMap();
          setArchiveLibraryRefreshToken((n) => n + 1);
        }}
        onOpenArchiveViewer={(archive, tab = 'html') =>
          setViewerState({archive, initialTab: tab})
        }
        onOpenArchiveLibrary={() => setActiveSection('archive')}
      />

      <ArchiveViewerModal
        archive={viewerState.archive}
        initialTab={viewerState.initialTab}
        onClose={() => setViewerState({archive: null, initialTab: 'html'})}
        onNewVersionCreated={(newVersion) => {
          setViewerState({archive: newVersion, initialTab: 'details'});
          void refreshArchivedMap();
          setArchiveLibraryRefreshToken((n) => n + 1);
        }}
      />

      <OfflineIndicator />
    </div>
  );
}
