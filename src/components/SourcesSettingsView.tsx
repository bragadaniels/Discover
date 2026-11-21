import {AlertCircle, CheckCircle2, Download, RefreshCw, Upload} from 'lucide-react';
import {useEffect, useRef, useState, type ChangeEvent, type FormEvent} from 'react';
import {getLocaleProviderLimitations} from '../../shared/locale';
import type {
  DiscoveryQueryLog,
  ProviderHealthMetric,
  ProviderStatusInfo,
  UserPreferences,
} from '../../shared/types';
import {LocaleMultiSelector} from './LocaleMultiSelector';

interface SourcesSettingsViewProps {
  providers: ProviderStatusInfo[];
  providerHealth: ProviderHealthMetric[];
  recentLogs: DiscoveryQueryLog[];
  preferences: UserPreferences;
  onToggleProvider: (name: string, isEnabled: boolean) => Promise<void>;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => Promise<void>;
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
  onUpdateFeed: () => Promise<void>;
  isDiscovering: boolean;
  onImportBackup: (payload: unknown) => Promise<{
    categoriesImported: number;
    tagsImported: number;
    itemsImported: number;
  }>;
}

export function SourcesSettingsView({
  providers,
  providerHealth,
  recentLogs,
  preferences,
  onToggleProvider,
  onUpdatePreferences,
  onAddCustomLanguage,
  onRemoveCustomLanguage,
  onAddCustomRegion,
  onRemoveCustomRegion,
  onUpdateFeed,
  isDiscovering,
  onImportBackup,
}: SourcesSettingsViewProps) {
  const [languages, setLanguages] = useState<string[]>(preferences.languages);
  const [regions, setRegions] = useState<string[]>(preferences.regions);
  const [newsMinutes, setNewsMinutes] = useState(preferences.intervals.newsMinutes);
  const [articlesHours, setArticlesHours] = useState(preferences.intervals.articlesHours);
  const [videosHours, setVideosHours] = useState(preferences.intervals.videosHours);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [importingBackup, setImportingBackup] = useState(false);
  const [togglingProvider, setTogglingProvider] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; message: string} | null>(
    null
  );
  const [prefsSavedJustNow, setPrefsSavedJustNow] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync local editor state when external preference mutations (custom add/remove, backup import) occur
  useEffect(() => {
    setLanguages(preferences.languages);
    setRegions(preferences.regions);
    setNewsMinutes(preferences.intervals.newsMinutes);
    setArticlesHours(preferences.intervals.articlesHours);
    setVideosHours(preferences.intervals.videosHours);
  }, [preferences]);

  const limitationNotes = getLocaleProviderLimitations(
    languages,
    regions,
    preferences.customLanguages,
    preferences.customRegions
  );

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    if (savingPrefs) return;
    setSavingPrefs(true);
    setFeedback(null);
    setPrefsSavedJustNow(false);
    try {
      await onUpdatePreferences({
        languages,
        regions,
        intervals: {newsMinutes, articlesHours, videosHours},
      });
      setPrefsSavedJustNow(true);
      setFeedback({
        type: 'success',
        message: 'Preferences saved. Click Update Feed to synchronize results with these preferences.',
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save preferences.',
      });
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleProviderToggle = async (name: string, displayName: string, checked: boolean) => {
    setTogglingProvider(name);
    setFeedback(null);
    try {
      await onToggleProvider(name, checked);
      setFeedback({
        type: 'success',
        message: `${displayName} ${checked ? 'enabled' : 'disabled'}. Click Update Feed to synchronize.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : `Failed to update ${displayName}.`,
      });
    } finally {
      setTogglingProvider(null);
    }
  };

  const handleImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportingBackup(true);
    setFeedback(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await onImportBackup(parsed);
      setFeedback({
        type: 'success',
        message: `Restored ${res.categoriesImported} categories, ${res.tagsImported} tags, and ${res.itemsImported} items.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to import backup.',
      });
    } finally {
      setImportingBackup(false);
    }
    e.target.value = '';
  };

  return (
    <section className="max-w-6xl mx-auto px-3 sm:px-6 py-6 sm:py-8 space-y-10">
      <div className="border-b border-[#DDD8CE] dark:border-[#2B2C28] pb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-[#1B1B19] dark:text-[#EAE8E1]">
            Discovery Providers &amp; Preferences
          </h1>
          <p className="mt-1 text-sm text-[#57554E] dark:text-[#A8A49B]">
            Automatic source connectors, custom languages and regions, local newspaper targeting, and backup.
          </p>
        </div>
        {feedback && (
          <p
            role={feedback.type === 'error' ? 'alert' : 'status'}
            className={`text-xs font-medium ${
              feedback.type === 'error'
                ? 'text-[#7F2929] dark:text-[#D98A8A]'
                : 'text-[#3F5E45] dark:text-[#8FB896]'
            }`}
          >
            {feedback.message}
          </p>
        )}
      </div>

      {/* Providers table */}
      <div>
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#737067] dark:text-[#8E8A80] mb-3">
          Discovery Providers &amp; Locale Capabilities
        </h2>
        <div className="border-t border-[#DDD8CE] dark:border-[#2B2C28]">
          {providers.map((p) => (
            <div
              key={p.providerName}
              className="py-3.5 border-b border-[#DDD8CE] dark:border-[#2B2C28] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-sm font-medium text-[#1B1B19] dark:text-[#EAE8E1]">
                    {p.displayName}
                  </span>
                  <span className="text-xs text-[#737067] dark:text-[#8E8A80]">· {p.contentType}</span>
                  {p.isConfigured ? (
                    <span className="inline-flex items-center gap-1 text-xs text-[#3F5E45] dark:text-[#8FB896]">
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Ready
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-[#7F2929] dark:text-[#D98A8A]">
                      <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                      Key required
                    </span>
                  )}
                  <span className="font-mono text-[11px] text-[#737067] dark:text-[#8E8A80]">
                    · {p.supportsMultiLanguage ? 'Multi-language' : 'English-only'} ·{' '}
                    {p.supportsMultiRegion ? 'Multi-region' : 'Global (no region filter)'}
                  </span>
                </div>
                <p className="text-xs text-[#57554E] dark:text-[#A8A49B]">{p.localeLimitationNote}</p>
                {p.note && (
                  <p className="text-xs text-[#57554E] dark:text-[#A8A49B]">{p.note}</p>
                )}
                {p.lastError && (
                  <p className="text-xs text-[#7F2929] dark:text-[#D98A8A]">
                    Last error: {p.lastError}
                  </p>
                )}
                <p className="text-xs font-mono text-[#737067] dark:text-[#8E8A80] tabular-nums">
                  Last success:{' '}
                  {p.lastSuccessAt
                    ? new Date(p.lastSuccessAt).toLocaleString()
                    : 'Not run yet'}
                </p>
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-[#1B1B19] dark:text-[#EAE8E1] shrink-0">
                <input
                  type="checkbox"
                  disabled={!p.isConfigured || togglingProvider === p.providerName}
                  checked={p.isEnabled && p.isConfigured}
                  onChange={(e) =>
                    void handleProviderToggle(p.providerName, p.displayName, e.target.checked)
                  }
                  className="accent-[#1E3A5F]"
                />
                <span>{togglingProvider === p.providerName ? 'Saving…' : 'Enabled'}</span>
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Multi-Language, Multi-Region & Schedule Preferences + Backup */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
        <form onSubmit={(e) => void handleSaveSettings(e)} className="lg:col-span-7 space-y-5">
          <h2 className="text-xs font-mono uppercase tracking-wider text-[#737067] dark:text-[#8E8A80]">
            Global Search Languages, Regions &amp; Schedule
          </h2>

          <LocaleMultiSelector
            kind="language"
            label="Active Search Languages (predefined & custom, executed simultaneously)"
            selected={languages}
            onChange={(next) => {
              setLanguages(next);
              setPrefsSavedJustNow(false);
            }}
            customLanguages={preferences.customLanguages}
            onAddCustomLanguage={onAddCustomLanguage}
            onRemoveCustomLanguage={onRemoveCustomLanguage}
          />

          <LocaleMultiSelector
            kind="region"
            label="Active Publication Regions & Cities (countries, regions, and local press)"
            selected={regions}
            onChange={(next) => {
              setRegions(next);
              setPrefsSavedJustNow(false);
            }}
            customRegions={preferences.customRegions}
            onAddCustomRegion={onAddCustomRegion}
            onRemoveCustomRegion={onRemoveCustomRegion}
          />

          {limitationNotes.length > 0 && (
            <div className="p-3 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/50 dark:bg-[#1C1D1B] space-y-1 text-[11px] text-[#57554E] dark:text-[#A8A49B]">
              <div className="font-medium text-[#1B1B19] dark:text-[#EAE8E1]">
                Provider Locale Behavior
              </div>
              {limitationNotes.map((note) => (
                <p key={note}>{note}</p>
              ))}
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 pt-1">
            <div>
              <label
                htmlFor="int-news"
                className="block text-xs font-medium text-[#57554E] dark:text-[#A8A49B] mb-1"
              >
                News (minutes)
              </label>
              <input
                id="int-news"
                type="number"
                min={15}
                max={1440}
                value={newsMinutes}
                onChange={(e) => setNewsMinutes(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
              />
            </div>

            <div>
              <label
                htmlFor="int-articles"
                className="block text-xs font-medium text-[#57554E] dark:text-[#A8A49B] mb-1"
              >
                Articles (hours)
              </label>
              <input
                id="int-articles"
                type="number"
                min={1}
                max={168}
                value={articlesHours}
                onChange={(e) => setArticlesHours(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
              />
            </div>

            <div>
              <label
                htmlFor="int-videos"
                className="block text-xs font-medium text-[#57554E] dark:text-[#A8A49B] mb-1"
              >
                Videos (hours)
              </label>
              <input
                id="int-videos"
                type="number"
                min={1}
                max={168}
                value={videosHours}
                onChange={(e) => setVideosHours(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-xs font-mono tabular-nums bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={savingPrefs}
              className="px-4 py-2 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 disabled:opacity-50"
            >
              {savingPrefs ? 'Saving Preferences…' : 'Save Preferences'}
            </button>

            <button
              type="button"
              disabled={isDiscovering || savingPrefs}
              onClick={() => void onUpdateFeed()}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium border border-[#1E3A5F] dark:border-[#6B92C4] text-[#1E3A5F] dark:text-[#9BBCE8] hover:bg-[#1E3A5F]/10 disabled:opacity-50"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isDiscovering ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{isDiscovering ? 'Updating Feed…' : 'Update Feed'}</span>
            </button>

            {prefsSavedJustNow && (
              <span role="status" className="text-xs font-medium text-[#3F5E45] dark:text-[#8FB896]">
                Saved!
              </span>
            )}
          </div>
        </form>

        <div className="lg:col-span-5 space-y-4">
          <h2 className="text-xs font-mono uppercase tracking-wider text-[#737067] dark:text-[#8E8A80]">
            Database Backup &amp; Restore
          </h2>
          <p className="text-xs leading-relaxed text-[#57554E] dark:text-[#A8A49B]">
            Export your categories, custom languages &amp; regions, tags, preferences, and saved
            articles as a portable JSON archive, or restore from an earlier backup.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/api/backup/export"
              download="discover-backup.json"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#1B1B19] dark:border-[#EAE8E1] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B]"
            >
              <Download className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Export Backup</span>
            </a>

            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              onChange={(e) => void handleImportFile(e)}
              className="hidden"
            />
            <button
              type="button"
              disabled={importingBackup}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{importingBackup ? 'Importing…' : 'Import Backup'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Provider Health & Latency Matrix */}
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 className="text-xs font-mono uppercase tracking-wider text-[#737067] dark:text-[#8E8A80]">
            Provider Health &amp; Latency Matrix (30d)
          </h2>
          <span className="text-[11px] font-mono text-[#737067] dark:text-[#8E8A80]">
            Success rate, round-trip latency, and yield per connector
          </span>
        </div>
        <div className="overflow-x-auto border-t border-[#DDD8CE] dark:border-[#2B2C28]">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-[#DDD8CE] dark:border-[#2B2C28] text-[#737067] dark:text-[#8E8A80]">
                <th className="py-2 pr-4 font-medium">Provider</th>
                <th className="py-2 pr-4 font-medium text-right">Runs</th>
                <th className="py-2 pr-4 font-medium text-right">Success</th>
                <th className="py-2 pr-4 font-medium text-right">Avg Latency</th>
                <th className="py-2 pr-4 font-medium text-right">Found / Added</th>
                <th className="py-2 font-medium">Health Status</th>
              </tr>
            </thead>
            <tbody>
              {providerHealth.map((m) => {
                const nowIso = new Date().toISOString();
                const isCoolingDown = Boolean(m.rateLimitResetAt && m.rateLimitResetAt > nowIso);
                const statusText = !m.isConfigured
                  ? 'Key required'
                  : !m.isEnabled
                    ? 'Disabled'
                    : isCoolingDown
                      ? `Rate limited until ${new Date(m.rateLimitResetAt!).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`
                      : m.errorRuns > 0 && (m.successRatePct ?? 100) < 60
                        ? 'Degraded'
                        : m.totalRuns === 0
                          ? 'Idle'
                          : 'Healthy';
                const statusColor = !m.isConfigured || statusText === 'Degraded'
                  ? 'text-[#7F2929] dark:text-[#D98A8A]'
                  : isCoolingDown
                    ? 'text-[#8C4A27] dark:text-[#E0A37D]'
                    : !m.isEnabled || statusText === 'Idle'
                      ? 'text-[#737067] dark:text-[#8E8A80]'
                      : 'text-[#3F5E45] dark:text-[#8FB896]';

                return (
                  <tr
                    key={m.providerName}
                    className="border-b border-[#DDD8CE]/60 dark:border-[#2B2C28]/60 text-[#1B1B19] dark:text-[#EAE8E1]"
                  >
                    <td className="py-2 pr-4 whitespace-nowrap font-medium">{m.displayName}</td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-right">{m.totalRuns}</td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-right">
                      {m.successRatePct !== null ? `${m.successRatePct}%` : '—'}
                    </td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-right">
                      {m.avgLatencyMs !== null ? `${m.avgLatencyMs} ms` : '—'}
                    </td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-right">
                      {m.totalFound} / {m.totalAdded}
                    </td>
                    <td className={`py-2 whitespace-nowrap font-medium ${statusColor}`}>
                      {statusText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent discovery history */}
      <div>
        <h2 className="text-xs font-mono uppercase tracking-wider text-[#737067] dark:text-[#8E8A80] mb-3">
          Recent Discovery Queries ({recentLogs.length})
        </h2>
        {recentLogs.length === 0 ? (
          <p className="text-xs text-[#57554E] dark:text-[#A8A49B]">
            No discovery queries executed yet. Click &ldquo;Update Feed&rdquo; to fetch fresh content.
          </p>
        ) : (
          <div className="overflow-x-auto border-t border-[#DDD8CE] dark:border-[#2B2C28]">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-[#DDD8CE] dark:border-[#2B2C28] text-[#737067] dark:text-[#8E8A80]">
                  <th className="py-2 pr-4 font-medium">Provider</th>
                  <th className="py-2 pr-4 font-medium">Locale</th>
                  <th className="py-2 pr-4 font-medium">Tag</th>
                  <th className="py-2 pr-4 font-medium">Query</th>
                  <th className="py-2 pr-4 font-medium text-right">Found</th>
                  <th className="py-2 pr-4 font-medium text-right">Added</th>
                  <th className="py-2 pr-4 font-medium text-right">Latency</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-[#DDD8CE]/60 dark:border-[#2B2C28]/60 text-[#1B1B19] dark:text-[#EAE8E1]"
                  >
                    <td className="py-2 pr-4 font-mono whitespace-nowrap">{log.providerName}</td>
                    <td className="py-2 pr-4 font-mono text-[11px] whitespace-nowrap text-[#57554E] dark:text-[#A8A49B]">
                      {log.language ? log.language.toUpperCase() : '—'}
                      {log.region ? ` / ${log.region}` : ''}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap">{log.tagName || '—'}</td>
                    <td className="py-2 pr-4 font-mono text-[11px] max-w-xs truncate">{log.queryText}</td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-right">{log.itemsFound}</td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-right">{log.itemsAdded}</td>
                    <td className="py-2 pr-4 font-mono tabular-nums text-right text-[#57554E] dark:text-[#A8A49B]">
                      {typeof log.durationMs === 'number' ? `${log.durationMs} ms` : '—'}
                    </td>
                    <td className="py-2 whitespace-nowrap">
                      <span
                        className={
                          log.status === 'success'
                            ? 'text-[#3F5E45] dark:text-[#8FB896]'
                            : 'text-[#7F2929] dark:text-[#D98A8A]'
                        }
                      >
                        {log.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
