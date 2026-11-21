import type {ContentType} from '../../shared/types';
import {getPreferences} from '../services/preference_service';
import {getProviderStatusList, isDiscoveryRunning, runDiscovery} from './discovery_engine';

let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function isDue(lastRunAt: string | null, intervalMs: number): boolean {
  if (!lastRunAt) return true;
  const lastMs = Date.parse(lastRunAt);
  if (Number.isNaN(lastMs)) return true;
  return Date.now() - lastMs >= intervalMs;
}

async function checkAndRunScheduledDiscovery(): Promise<void> {
  if (isDiscoveryRunning()) return;

  const prefs = getPreferences();
  if (!prefs.onboardingCompleted) return;

  const statuses = getProviderStatusList();
  const dueTypes = new Set<ContentType>();

  for (const st of statuses) {
    if (!st.isEnabled || !st.isConfigured) continue;
    const intervalMs =
      st.contentType === 'news'
        ? prefs.intervals.newsMinutes * 60 * 1000
        : st.contentType === 'article'
          ? prefs.intervals.articlesHours * 60 * 60 * 1000
          : prefs.intervals.videosHours * 60 * 60 * 1000;

    if (isDue(st.lastRunAt, intervalMs)) {
      dueTypes.add(st.contentType);
    }
  }

  if (dueTypes.size > 0) {
    try {
      await runDiscovery({contentTypes: Array.from(dueTypes)});
    } catch (err) {
      console.error('[Scheduler] Background discovery error:', err);
    }
  }
}

export function startDiscoveryScheduler(): void {
  if (schedulerTimer) return;
  // Check every 60 seconds whether any provider interval is due
  schedulerTimer = setInterval(() => {
    void checkAndRunScheduledDiscovery();
  }, 60_000);
}

export function stopDiscoveryScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
