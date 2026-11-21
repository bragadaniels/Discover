import {WifiOff} from 'lucide-react';
import {useOnlineStatus} from '../hooks/useOnlineStatus';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-4 z-40 inline-flex items-center gap-2 px-3 py-2 text-xs font-medium bg-[#1B1B19] text-[#F6F4EF] dark:bg-[#EAE8E1] dark:text-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28]"
    >
      <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
      <span>Offline mode — showing cached edition</span>
    </div>
  );
}
