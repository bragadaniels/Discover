import {ArrowRight, Compass} from 'lucide-react';
import {useState, type FormEvent} from 'react';

interface OnboardingViewProps {
  onCreateFirstCategory: (categoryName: string, tags: string[]) => Promise<void>;
  onLoadStarter: () => Promise<void>;
  isBusy: boolean;
}

export function OnboardingView({
  onCreateFirstCategory,
  onLoadStarter,
  isBusy,
}: OnboardingViewProps) {
  const [categoryName, setCategoryName] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const trimmedCat = categoryName.trim();
    const parsedTags = tagsText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!trimmedCat) {
      setError('Please enter a category name (for example: Chemistry or Astronomy).');
      return;
    }
    if (parsedTags.length === 0) {
      setError('Please enter at least one interest tag separated by commas.');
      return;
    }

    try {
      await onCreateFirstCategory(trimmedCat, parsedTags);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to initialize category.');
    }
  };

  return (
    <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
      <div className="border-b border-[#DDD8CE] dark:border-[#2B2C28] pb-8">
        <div className="inline-flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-[#737067] dark:text-[#8E8A80]">
          <Compass className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Personal Discovery Index</span>
        </div>
        <h1 className="mt-3 font-serif text-3xl sm:text-4xl font-semibold text-[#1B1B19] dark:text-[#EAE8E1] text-balance">
          Define what matters. Discover finds where it lives.
        </h1>
        <p className="mt-3 text-base leading-relaxed text-[#57554E] dark:text-[#A8A49B] max-w-2xl">
          No RSS feeds to hunt down, no channels to register, and no social noise. Create a topic tab,
          add a few tags, and Discover automatically gathers relevant news, scientific papers, and videos.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-5 gap-8 items-start">
        <form onSubmit={(e) => void handleSubmit(e)} className="md:col-span-3 space-y-4">
          <h2 className="font-serif text-xl font-semibold text-[#1B1B19] dark:text-[#EAE8E1]">
            Create your first category
          </h2>

          <div>
            <label
              htmlFor="onboarding-category"
              className="block text-xs font-medium text-[#57554E] dark:text-[#A8A49B] mb-1.5"
            >
              Category name
            </label>
            <input
              id="onboarding-category"
              type="text"
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              placeholder="e.g. Chemistry"
              className="w-full px-3 py-2 text-sm bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none focus:border-[#1E3A5F] dark:focus:border-[#6B92C4]"
            />
          </div>

          <div>
            <label
              htmlFor="onboarding-tags"
              className="block text-xs font-medium text-[#57554E] dark:text-[#A8A49B] mb-1.5"
            >
              Tags and interests (comma-separated)
            </label>
            <input
              id="onboarding-tags"
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="e.g. Catalysis, Green chemistry, Hydroformylation"
              className="w-full px-3 py-2 text-sm bg-[#EFECE4]/70 dark:bg-[#1C1D1B] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1] focus:outline-none focus:border-[#1E3A5F] dark:focus:border-[#6B92C4]"
            />
          </div>

          {error && (
            <p role="alert" className="text-xs font-medium text-[#7F2929] dark:text-[#D98A8A]">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isBusy}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            <span>{isBusy ? 'Discovering content…' : 'Create & Start Discovery'}</span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </form>

        <div className="md:col-span-2 border-t md:border-t-0 md:border-l border-[#DDD8CE] dark:border-[#2B2C28] pt-6 md:pt-0 md:pl-8">
          <h2 className="font-serif text-lg font-semibold text-[#1B1B19] dark:text-[#EAE8E1]">
            Or start immediately
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-[#57554E] dark:text-[#A8A49B]">
            Load three curated starter tabs — Chemistry, Technology, and Astronomy — and run live
            discovery across Google News, Crossref, and arXiv. You can edit or remove anything later.
          </p>
          <button
            type="button"
            disabled={isBusy}
            onClick={() => void onLoadStarter()}
            className="mt-4 w-full py-2 px-4 text-xs font-medium border border-[#1B1B19] dark:border-[#EAE8E1] text-[#1B1B19] dark:text-[#EAE8E1] hover:bg-[#EFECE4] dark:hover:bg-[#1C1D1B] disabled:opacity-60 transition-colors"
          >
            {isBusy ? 'Preparing workspace…' : 'Load Starter Collection'}
          </button>
        </div>
      </div>
    </section>
  );
}
