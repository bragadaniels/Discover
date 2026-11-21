import {RefreshCw} from 'lucide-react';
import {PWAInstallButton} from './PWAInstallButton';

export type ActiveSection = 'feed' | 'saved' | 'archive' | 'topics' | 'sources';

interface TopMastheadProps {
  activeSection: ActiveSection;
  onSelectSection: (section: ActiveSection) => void;
  onRefreshDiscovery: () => void;
  isDiscovering: boolean;
  hasCategories: boolean;
}

export function TopMasthead({
  activeSection,
  onSelectSection,
  onRefreshDiscovery,
  isDiscovering,
  hasCategories,
}: TopMastheadProps) {
  const navItems: Array<{id: ActiveSection; label: string}> = [
    {id: 'feed', label: 'Feed'},
    {id: 'saved', label: 'Saved'},
    {id: 'archive', label: 'Archive'},
    {id: 'topics', label: 'Topics'},
    {id: 'sources', label: 'Sources'},
  ];

  return (
    <header className="border-b border-[#DDD8CE] dark:border-[#2B2C28] bg-[#F6F4EF] dark:bg-[#141514]">
      <div className="max-w-6xl mx-auto px-2.5 sm:px-6 h-13 sm:h-14 flex items-center justify-between gap-2 sm:gap-8">
        <button
          type="button"
          onClick={() => onSelectSection('feed')}
          className="font-serif text-lg sm:text-2xl font-semibold tracking-tight text-[#1B1B19] dark:text-[#EAE8E1] whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A5F]"
        >
          Discover
        </button>

        <nav aria-label="Primary navigation" className="flex items-center gap-2 sm:gap-7 min-w-0 overflow-x-auto no-scrollbar">
          {navItems.map((item) => {
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectSection(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`py-1.5 text-[11px] sm:text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A5F] ${
                  isActive
                    ? 'border-[#1E3A5F] dark:border-[#6B92C4] text-[#1B1B19] dark:text-[#EAE8E1]'
                    : 'border-transparent text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="hidden sm:block">
            <PWAInstallButton />
          </div>
          {hasCategories && (
            <button
              type="button"
              onClick={onRefreshDiscovery}
              disabled={isDiscovering}
              aria-label={
                isDiscovering
                  ? 'Updating feed with current preferences'
                  : 'Update feed with current preferences'
              }
              className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3.5 py-1 sm:py-1.5 text-[11px] sm:text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 disabled:opacity-60 transition-opacity whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A5F]"
            >
              <RefreshCw
                className={`w-3 h-3 sm:w-3.5 sm:h-3.5 ${isDiscovering ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span className="sm:hidden">{isDiscovering ? 'Updating…' : 'Update'}</span>
              <span className="hidden sm:inline">{isDiscovering ? 'Updating…' : 'Update Feed'}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
