import {Download} from 'lucide-react';
import {useState} from 'react';
import {usePWAInstall} from '../hooks/usePWAInstall';

export function PWAInstallButton() {
  const {isInstallable, isInstalled, isIOS, install} = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5" aria-hidden="true" />
        Install App
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          Install
        </button>

        {showIOSGuide && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="ios-install-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          >
            <div className="w-full max-w-sm bg-[#F6F4EF] dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] p-6">
              <h3
                id="ios-install-title"
                className="font-serif text-lg font-semibold text-[#1B1B19] dark:text-[#EAE8E1]"
              >
                Install Discover on iOS
              </h3>
              <p className="mt-2 text-sm text-[#57554E] dark:text-[#A8A49B] leading-relaxed">
                1. Tap the <strong>Share</strong> icon in the Safari toolbar.
                <br />
                2. Scroll down and select <strong>Add to Home Screen</strong>.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full py-2 px-4 text-sm font-medium bg-[#1E3A5F] text-[#F6F4EF] hover:opacity-90 transition-opacity"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
}
