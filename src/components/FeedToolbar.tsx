import {Moon, Search, Sun, X} from 'lucide-react';
import {useEffect, useState, type FormEvent} from 'react';
import {getLanguageLabel} from '../../shared/locale';
import type {CustomLanguage, FeedFilterType, SortOption} from '../../shared/types';
import type {FeedCounts} from '../services/api';

interface FeedToolbarProps {
  filter: FeedFilterType;
  onFilterChange: (filter: FeedFilterType) => void;
  sort: SortOption;
  onSortChange: (sort: SortOption) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onSubmitSearch?: (query: string) => void;
  languageFilter: string | 'all';
  onLanguageFilterChange: (lang: string | 'all') => void;
  customLanguages?: CustomLanguage[];
  isEntertainmentCategory: boolean;
  isAllCategories: boolean;
  counts: FeedCounts;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function FeedToolbar({
  filter,
  onFilterChange,
  sort,
  onSortChange,
  search,
  onSearchChange,
  onSubmitSearch,
  languageFilter,
  onLanguageFilterChange,
  customLanguages = [],
  isEntertainmentCategory,
  isAllCategories,
  counts,
  theme,
  onToggleTheme,
}: FeedToolbarProps) {
  const [searchDraft, setSearchDraft] = useState(search);

  useEffect(() => {
    setSearchDraft(search);
  }, [search]);

  const showFilmFilters =
    isEntertainmentCategory ||
    (isAllCategories && (counts.toWatch > 0 || counts.aboutFilm > 0));

  const filterTabs: Array<{id: FeedFilterType; label: string; count: number}> = [
    {id: 'all', label: 'All', count: counts.all},
    {id: 'news', label: 'News', count: counts.news},
    {id: 'article', label: 'Articles', count: counts.article},
    {id: 'video', label: 'Videos', count: counts.video},
    ...(showFilmFilters
      ? [
          {id: 'to_watch' as const, label: 'Films to Watch', count: counts.toWatch},
          {id: 'about_film' as const, label: 'About Film', count: counts.aboutFilm},
        ]
      : []),
    {id: 'unread', label: 'Unread', count: counts.unread},
    {id: 'saved', label: 'Saved', count: counts.saved},
    {id: 'notes', label: 'Has Notes', count: counts.notes},
  ];

  const showLanguageSelect = counts.languages.length > 1 || languageFilter !== 'all';

  const handleSearchFormSubmit = (e: FormEvent) => {
    e.preventDefault();
    const clean = searchDraft.trim();
    onSearchChange(clean);
    onSubmitSearch?.(clean);
  };

  return (
    <div className="border-b border-[#DDD8CE] dark:border-[#2B2C28] bg-[#F6F4EF] dark:bg-[#141514]">
      <div className="max-w-6xl mx-auto px-3 sm:px-6 py-2.5 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-2.5">
        <div
          role="group"
          aria-label="Content type filter"
          className="flex flex-wrap items-center gap-1 min-w-0"
        >
          {filterTabs.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onFilterChange(tab.id)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium whitespace-nowrap shrink-0 border transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E3A5F] ${
                  active
                    ? 'border-[#1E3A5F] dark:border-[#6B92C4] bg-[#1E3A5F]/10 dark:bg-[#6B92C4]/15 text-[#1E3A5F] dark:text-[#9BBCE8]'
                    : 'border-transparent text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]'
                }`}
              >
                <span>{tab.label}</span>
                <span className="font-mono text-[11px] opacity-70 tabular-nums">{tab.count}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
          <form onSubmit={handleSearchFormSubmit} className="flex items-center flex-1 sm:flex-initial">
            <div className="relative flex-1 sm:w-44 xl:w-48">
              <Search
                className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#737067] dark:text-[#7C7971]"
                aria-hidden="true"
              />
              <label htmlFor="feed-search-input" className="sr-only">
                Search collected content
              </label>
              <input
                id="feed-search-input"
                type="search"
                value={searchDraft}
                onChange={(e) => {
                  const val = e.target.value;
                  setSearchDraft(val);
                  onSearchChange(val);
                }}
                placeholder="Search title, notes, source, tag…"
                className="w-full pl-8 pr-7 py-1.5 text-xs bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] placeholder:text-[#737067] dark:placeholder:text-[#7C7971] focus:outline-none focus:border-[#1E3A5F] dark:focus:border-[#6B92C4] [&::-webkit-search-cancel-button]:hidden"
              />
              {searchDraft && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft('');
                    onSearchChange('');
                  }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#737067] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
            <button
              type="submit"
              aria-label="Search feed and web sources"
              className="px-2.5 py-1.5 text-xs font-medium border border-l-0 border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4] dark:bg-[#232421] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#E5E0D5] dark:hover:bg-[#2B2C28] transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E3A5F]"
            >
              Search
            </button>
          </form>

          {showLanguageSelect && (
            <div className="shrink-0">
              <label htmlFor="feed-language-select" className="sr-only">
                Filter by language
              </label>
              <select
                id="feed-language-select"
                value={languageFilter}
                onChange={(e) => onLanguageFilterChange(e.target.value)}
                className="py-1.5 px-2 text-xs bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none focus:border-[#1E3A5F] dark:focus:border-[#6B92C4]"
              >
                <option value="all">All languages</option>
                {counts.languages.map((code) => (
                  <option key={code} value={code}>
                    {code.toUpperCase()} · {getLanguageLabel(code, customLanguages)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="shrink-0">
            <label htmlFor="feed-sort-select" className="sr-only">
              Sort order
            </label>
            <select
              id="feed-sort-select"
              value={sort}
              onChange={(e) => onSortChange(e.target.value as SortOption)}
              className="py-1.5 px-2.5 text-xs bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none focus:border-[#1E3A5F] dark:focus:border-[#6B92C4]"
            >
              <option value="relevant">Most relevant</option>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </div>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
            className="p-1.5 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/70 dark:bg-[#1C1D1B] text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] transition-colors shrink-0"
          >
            {theme === 'light' ? (
              <Moon className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <Sun className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
