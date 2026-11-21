import type {
  ArchiveFormat,
  ArchiveIntegrityResult,
  ArchiveJobStatus,
  ArchiveRecord,
  ArchiveRestoreResponse,
  ArchiveStatus,
  Category,
  CategorySelection,
  ContentItem,
  DiscoveryQueryLog,
  DiscoveryRunSummary,
  FeedFilterType,
  FeedResponse,
  FeedbackType,
  ItemNote,
  ProviderHealthMetric,
  ProviderStatusInfo,
  SortOption,
  Tag,
  TagRelation,
  TagSuggestionPreview,
  UserPreferences,
  WarcRecordSummary,
} from '../../shared/types';

export interface FeedCounts {
  all: number;
  news: number;
  article: number;
  video: number;
  toWatch: number;
  aboutFilm: number;
  unread: number;
  saved: number;
  notes: number;
  languages: string[];
}

export interface FullFeedResponse extends FeedResponse {
  counts: FeedCounts;
}

const FEED_CACHE_KEY = 'discover_offline_feed_cache_v1';
const CATEGORIES_CACHE_KEY = 'discover_offline_categories_cache_v1';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & {error?: string};
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export const api = {
  async getPreferences(): Promise<UserPreferences> {
    const res = await requestJson<{preferences: UserPreferences}>('/api/preferences');
    return res.preferences;
  },

  async updatePreferences(partial: Partial<UserPreferences>): Promise<UserPreferences> {
    const res = await requestJson<{preferences: UserPreferences}>('/api/preferences', {
      method: 'PATCH',
      body: JSON.stringify(partial),
    });
    return res.preferences;
  },

  async addCustomLanguage(code: string, name?: string): Promise<UserPreferences> {
    const res = await requestJson<{preferences: UserPreferences}>('/api/preferences/custom-languages', {
      method: 'POST',
      body: JSON.stringify({code, name}),
    });
    return res.preferences;
  },

  async removeCustomLanguage(code: string): Promise<UserPreferences> {
    const res = await requestJson<{preferences: UserPreferences}>(
      `/api/preferences/custom-languages/${encodeURIComponent(code)}`,
      {method: 'DELETE'}
    );
    return res.preferences;
  },

  async addCustomRegion(input: {
    code?: string;
    name?: string;
    countryCode?: string;
    defaultLanguage?: string;
    queryLocation?: string;
  }): Promise<UserPreferences> {
    const res = await requestJson<{preferences: UserPreferences}>('/api/preferences/custom-regions', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.preferences;
  },

  async removeCustomRegion(code: string): Promise<UserPreferences> {
    const res = await requestJson<{preferences: UserPreferences}>(
      `/api/preferences/custom-regions/${encodeURIComponent(code)}`,
      {method: 'DELETE'}
    );
    return res.preferences;
  },

  async getCategories(): Promise<Category[]> {
    try {
      const res = await requestJson<{categories: Category[]}>('/api/categories');
      try {
        localStorage.setItem(CATEGORIES_CACHE_KEY, JSON.stringify(res.categories));
      } catch {
        // Ignore storage quota issues
      }
      return res.categories;
    } catch (err) {
      const cached = localStorage.getItem(CATEGORIES_CACHE_KEY);
      if (cached) {
        return JSON.parse(cached) as Category[];
      }
      throw err;
    }
  },

  async createCategory(name: string, icon = 'bookmark'): Promise<Category> {
    const res = await requestJson<{category: Category}>('/api/categories', {
      method: 'POST',
      body: JSON.stringify({name, icon}),
    });
    return res.category;
  },

  async seedStarterWorkspace(): Promise<Category[]> {
    const res = await requestJson<{categories: Category[]}>('/api/categories/starter', {
      method: 'POST',
    });
    return res.categories;
  },

  async addCinemaPreset(): Promise<{category: Category; categories: Category[]}> {
    return requestJson<{category: Category; categories: Category[]}>('/api/categories/cinema-preset', {
      method: 'POST',
    });
  },

  async updateCategory(
    id: number,
    patch: {
      name?: string;
      icon?: string;
      isEnabled?: boolean;
      languages?: string[] | null;
      regions?: string[] | null;
    }
  ): Promise<Category> {
    const res = await requestJson<{category: Category}>(`/api/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return res.category;
  },

  async deleteCategory(id: number): Promise<void> {
    await requestJson<{ok: boolean}>(`/api/categories/${id}`, {method: 'DELETE'});
  },

  async reorderCategories(orderedIds: number[]): Promise<Category[]> {
    const res = await requestJson<{categories: Category[]}>('/api/categories/reorder', {
      method: 'PUT',
      body: JSON.stringify({orderedIds}),
    });
    return res.categories;
  },

  async suggestTagTerms(
    tagName: string,
    categoryName?: string,
    languages?: string[]
  ): Promise<TagSuggestionPreview> {
    return requestJson<TagSuggestionPreview>('/api/tags/suggest', {
      method: 'POST',
      body: JSON.stringify({tagName, categoryName, languages}),
    });
  },

  async createTag(
    categoryId: number,
    input: {
      name: string;
      description?: string;
      priority?: number;
      expandedTerms?: string[];
      exclusions?: string[];
    }
  ): Promise<Tag> {
    const res = await requestJson<{tag: Tag}>(`/api/categories/${categoryId}/tags`, {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.tag;
  },

  async updateTag(
    id: number,
    patch: {name?: string; description?: string | null; priority?: number; isEnabled?: boolean}
  ): Promise<Tag> {
    const res = await requestJson<{tag: Tag}>(`/api/tags/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return res.tag;
  },

  async deleteTag(id: number): Promise<void> {
    await requestJson<{ok: boolean}>(`/api/tags/${id}`, {method: 'DELETE'});
  },

  async addTagRelation(
    tagId: number,
    term: string,
    relationType: 'expanded' | 'exclusion'
  ): Promise<TagRelation> {
    const res = await requestJson<{relation: TagRelation}>(`/api/tags/${tagId}/relations`, {
      method: 'POST',
      body: JSON.stringify({term, relationType}),
    });
    return res.relation;
  },

  async toggleTagRelation(id: number, isEnabled: boolean): Promise<void> {
    await requestJson<{ok: boolean}>(`/api/tag-relations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({isEnabled}),
    });
  },

  async deleteTagRelation(id: number): Promise<void> {
    await requestJson<{ok: boolean}>(`/api/tag-relations/${id}`, {method: 'DELETE'});
  },

  async getFeed(params: {
    categoryId: CategorySelection;
    filter: FeedFilterType;
    sort: SortOption;
    search: string;
    language?: string | 'all';
    luckySeed?: number;
    page: number;
    pageSize?: number;
  }): Promise<FullFeedResponse> {
    const qs = new URLSearchParams({
      categoryId: String(params.categoryId),
      filter: params.filter,
      sort: params.sort,
      search: params.search,
      language: params.language || 'all',
      luckySeed: String(params.luckySeed || 0),
      page: String(params.page),
      pageSize: String(params.pageSize || 24),
    });

    try {
      const data = await requestJson<FullFeedResponse>(`/api/feed?${qs.toString()}`);
      if (
        params.page === 1 &&
        params.categoryId === 'all' &&
        params.filter === 'all' &&
        !params.search &&
        (!params.language || params.language === 'all')
      ) {
        try {
          localStorage.setItem(FEED_CACHE_KEY, JSON.stringify(data));
        } catch {
          // Ignore storage quota issues
        }
      }
      return data;
    } catch (err) {
      const cached = localStorage.getItem(FEED_CACHE_KEY);
      if (cached && !navigator.onLine) {
        const parsed = JSON.parse(cached) as FullFeedResponse;
        const filteredItems = filterCachedItemsOffline(parsed.items, {
          categoryId: params.categoryId === 'lucky' ? 'all' : params.categoryId,
          filter: params.filter,
          search: params.search,
          language: params.language,
        });
        return {
          ...parsed,
          items: filteredItems,
          total: filteredItems.length,
          hasMore: false,
        };
      }
      throw err;
    }
  },

  async liveSearch(params: {
    query: string;
    language?: string | 'all';
    sort?: SortOption;
    filter?: FeedFilterType;
  }): Promise<{items: ContentItem[]; total: number; errors: string[]}> {
    return requestJson('/api/feed/live-search', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  async updateFeedback(
    contentId: number,
    patch: {feedbackType?: FeedbackType; isRead?: boolean; isSaved?: boolean; isHidden?: boolean}
  ): Promise<{
    contentId: number;
    feedbackType: FeedbackType;
    isRead: boolean;
    isSaved: boolean;
    isHidden: boolean;
  }> {
    return requestJson(`/api/content/${contentId}/feedback`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  },

  async upsertNote(input: {
    canonicalUrl?: string;
    contentItemId?: number | null;
    archiveUid?: string | null;
    noteText: string;
  }): Promise<ItemNote | null> {
    const res = await requestJson<{note: ItemNote | null}>('/api/notes', {
      method: 'PUT',
      body: JSON.stringify(input),
    });
    return res.note;
  },

  async getDiscoveryStatus(): Promise<{
    isRunning: boolean;
    providers: ProviderStatusInfo[];
    providerHealth: ProviderHealthMetric[];
    recentLogs: DiscoveryQueryLog[];
  }> {
    return requestJson('/api/discovery/status');
  },

  async runDiscovery(categoryId?: number, force = true): Promise<DiscoveryRunSummary> {
    const res = await requestJson<{summary: DiscoveryRunSummary}>('/api/discovery/run', {
      method: 'POST',
      body: JSON.stringify({categoryId, force}),
    });
    return res.summary;
  },

  async setProviderEnabled(providerName: string, isEnabled: boolean): Promise<ProviderStatusInfo[]> {
    const res = await requestJson<{providers: ProviderStatusInfo[]}>(`/api/providers/${providerName}`, {
      method: 'PATCH',
      body: JSON.stringify({isEnabled}),
    });
    return res.providers;
  },

  async importBackup(payload: unknown): Promise<{
    categoriesImported: number;
    tagsImported: number;
    itemsImported: number;
  }> {
    return requestJson('/api/backup/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async listArchives(params?: {
    search?: string;
    category?: string;
    tag?: string;
    format?: ArchiveFormat | 'all';
    status?: ArchiveStatus | 'all';
    dateRange?: 'all' | 'today' | '7d' | '30d';
    dateFrom?: string;
    dateTo?: string;
    hasNotes?: boolean;
    sort?: 'archived_desc' | 'archived_asc' | 'published_desc' | 'published_asc';
  }): Promise<{
    archives: ArchiveRecord[];
    total: number;
    categories: string[];
    tags: string[];
    totalDiskBytes: number;
  }> {
    const qs = new URLSearchParams();
    if (params?.search) qs.set('search', params.search);
    if (params?.category && params.category !== 'all') qs.set('category', params.category);
    if (params?.tag && params.tag !== 'all') qs.set('tag', params.tag);
    if (params?.format && params.format !== 'all') qs.set('format', params.format);
    if (params?.status && params.status !== 'all') qs.set('status', params.status);
    if (params?.dateRange && params.dateRange !== 'all') qs.set('dateRange', params.dateRange);
    if (params?.dateFrom) qs.set('dateFrom', params.dateFrom);
    if (params?.dateTo) qs.set('dateTo', params.dateTo);
    if (params?.hasNotes) qs.set('hasNotes', '1');
    if (params?.sort) qs.set('sort', params.sort);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson(`/api/archives${suffix}`);
  },

  async getArchivedItemMap(): Promise<
    Record<number, {archiveUid: string; formats: ArchiveFormat[]; status: ArchiveStatus}>
  > {
    const res = await requestJson<{
      map: Record<number, {archiveUid: string; formats: ArchiveFormat[]; status: ArchiveStatus}>;
    }>('/api/archives/item-map');
    return res.map;
  },

  async startArchive(input: {
    contentItemId?: number | null;
    url?: string;
    title?: string;
    formats: ArchiveFormat[];
    categoryName?: string | null;
    tagNames?: string[];
  }): Promise<ArchiveJobStatus> {
    const res = await requestJson<{job: ArchiveJobStatus}>('/api/archives', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return res.job;
  },

  async getArchiveJob(jobId: string): Promise<ArchiveJobStatus> {
    const res = await requestJson<{job: ArchiveJobStatus}>(
      `/api/archives/jobs/${encodeURIComponent(jobId)}`
    );
    return res.job;
  },

  async retryArchive(archiveUid: string, formats?: ArchiveFormat[]): Promise<ArchiveJobStatus> {
    const res = await requestJson<{job: ArchiveJobStatus}>(
      `/api/archives/${encodeURIComponent(archiveUid)}/retry`,
      {
        method: 'POST',
        body: JSON.stringify({formats}),
      }
    );
    return res.job;
  },

  async verifyArchiveIntegrity(archiveUid: string): Promise<ArchiveIntegrityResult> {
    const res = await requestJson<{integrity: ArchiveIntegrityResult}>(
      `/api/archives/${encodeURIComponent(archiveUid)}/verify`,
      {method: 'POST'}
    );
    return res.integrity;
  },

  async inspectWarc(archiveUid: string): Promise<{
    archive: ArchiveRecord;
    records: WarcRecordSummary[];
    limitations: string[];
  }> {
    return requestJson(`/api/archives/${encodeURIComponent(archiveUid)}/warc-inspect`);
  },

  async deleteArchive(archiveUid: string): Promise<void> {
    await requestJson<{ok: boolean}>(`/api/archives/${encodeURIComponent(archiveUid)}`, {
      method: 'DELETE',
    });
  },

  async restoreArchivesZip(
    fileOrBytes: File | Blob | ArrayBuffer,
    overwriteConfirmed = false
  ): Promise<ArchiveRestoreResponse> {
    const qs = overwriteConfirmed ? '?overwriteConfirmed=true' : '';
    const response = await fetch(`/api/archives/restore${qs}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/zip',
      },
      body: fileOrBytes,
    });
    const data = (await response.json().catch(() => ({}))) as ArchiveRestoreResponse & {error?: string};
    if (response.status === 409 && data.requiresConfirmation) {
      return data;
    }
    if (!response.ok) {
      throw new Error(data.error || `Restore failed (${response.status})`);
    }
    return data;
  },

  getArchiveViewUrl(archiveUid: string, download = false): string {
    return `/api/archives/${encodeURIComponent(archiveUid)}/view${download ? '?download=1' : ''}`;
  },

  getArchivePdfUrl(archiveUid: string, download = false): string {
    return `/api/archives/${encodeURIComponent(archiveUid)}/pdf${download ? '?download=1' : ''}`;
  },

  getArchiveWarcUrl(archiveUid: string): string {
    return `/api/archives/${encodeURIComponent(archiveUid)}/warc`;
  },

  getArchiveWarcReplayUrl(archiveUid: string, resourceUrl?: string): string {
    const qs = resourceUrl ? `?url=${encodeURIComponent(resourceUrl)}` : '';
    return `/api/archives/${encodeURIComponent(archiveUid)}/warc-replay${qs}`;
  },

  getArchiveThumbnailUrl(archiveUid: string): string {
    return `/api/archives/${encodeURIComponent(archiveUid)}/thumbnail`;
  },

  getArchiveExportUrl(archiveUid: string): string {
    return `/api/archives/${encodeURIComponent(archiveUid)}/export`;
  },

  getArchiveExportAllUrl(): string {
    return '/api/archives/export-all';
  },
};

function filterCachedItemsOffline(
  items: ContentItem[],
  params: {categoryId: number | 'all'; filter: FeedFilterType; search: string; language?: string | 'all'}
): ContentItem[] {
  const q = params.search.trim().toLowerCase();
  const lang = params.language && params.language !== 'all' ? params.language.toLowerCase() : null;
  return items.filter((item) => {
    if (params.categoryId !== 'all') {
      const inCat = item.associatedTags.some((t) => t.categoryId === params.categoryId);
      if (!inCat) return false;
    }
    if (params.filter === 'news' || params.filter === 'article' || params.filter === 'video') {
      if (item.contentType !== params.filter) return false;
    } else if (params.filter === 'to_watch' || params.filter === 'about_film') {
      if (item.filmCategory !== params.filter) return false;
    } else if (params.filter === 'unread' && item.isRead) {
      return false;
    } else if (params.filter === 'saved' && !item.isSaved) {
      return false;
    } else if (params.filter === 'notes' && !item.note) {
      return false;
    }
    if (lang && item.language.toLowerCase() !== lang) {
      return false;
    }
    if (q) {
      const hay = `${item.title} ${item.description || ''} ${item.sourceName} ${item.associatedTags.map((t) => t.tagName).join(' ')}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
