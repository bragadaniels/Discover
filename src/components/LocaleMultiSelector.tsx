import {Plus, X} from 'lucide-react';
import {useState} from 'react';
import {
  SUPPORTED_LANGUAGES,
  SUPPORTED_REGIONS,
  validateCustomLanguage,
  validateCustomRegion,
} from '../../shared/locale';
import type {CustomLanguage, CustomRegion} from '../../shared/types';

interface LocaleMultiSelectorProps {
  kind: 'language' | 'region';
  selected: string[];
  onChange: (next: string[]) => void;
  customLanguages?: CustomLanguage[];
  customRegions?: CustomRegion[];
  onAddCustomLanguage?: (input: {code: string; name?: string}) => Promise<void>;
  onRemoveCustomLanguage?: (code: string) => Promise<void>;
  onAddCustomRegion?: (input: {
    code?: string;
    name?: string;
    countryCode?: string;
    defaultLanguage?: string;
    queryLocation?: string;
  }) => Promise<void>;
  onRemoveCustomRegion?: (code: string) => Promise<void>;
  compact?: boolean;
  label?: string;
}

export function LocaleMultiSelector({
  kind,
  selected,
  onChange,
  customLanguages = [],
  customRegions = [],
  onAddCustomLanguage,
  onRemoveCustomLanguage,
  onAddCustomRegion,
  onRemoveCustomRegion,
  compact = false,
  label,
}: LocaleMultiSelectorProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [removingCode, setRemovingCode] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{type: 'success' | 'error'; message: string} | null>(
    null
  );

  // Language inputs
  const [customLangCode, setCustomLangCode] = useState('');
  const [customLangName, setCustomLangName] = useState('');

  // Region inputs
  const [customRegionName, setCustomRegionName] = useState('');
  const [customCountryCode, setCustomCountryCode] = useState('');
  const [customRegionCode, setCustomRegionCode] = useState('');
  const [customRegionDefaultLang, setCustomRegionDefaultLang] = useState('');

  const options =
    kind === 'language'
      ? [
          ...SUPPORTED_LANGUAGES.map((l) => ({
            code: l.code,
            short: l.code.toUpperCase(),
            label: l.name,
            isCustom: false,
            sublabel: null as string | null,
          })),
          ...customLanguages.map((l) => ({
            code: l.code,
            short: l.code.toUpperCase(),
            label: l.name,
            isCustom: true,
            sublabel: null as string | null,
          })),
        ]
      : [
          ...SUPPORTED_REGIONS.map((r) => ({
            code: r.code,
            short: r.code,
            label: r.name,
            isCustom: false,
            sublabel: null as string | null,
          })),
          ...customRegions.map((r) => ({
            code: r.code,
            short: r.code,
            label: r.name,
            isCustom: true,
            sublabel: r.queryLocation ? `${r.countryCode} · local` : r.countryCode,
          })),
        ];

  const allCodes = options.map((o) => o.code);
  const allSelected = allCodes.length > 0 && allCodes.every((c) => selected.includes(c));
  const canAddCustom = kind === 'language' ? Boolean(onAddCustomLanguage) : Boolean(onAddCustomRegion);

  const toggle = (code: string) => {
    setFeedback(null);
    if (selected.includes(code)) {
      if (selected.length <= 1) {
        setFeedback({
          type: 'error',
          message: `At least one ${kind === 'language' ? 'language' : 'region'} must remain active.`,
        });
        return;
      }
      onChange(selected.filter((c) => c !== code));
    } else {
      onChange([...selected, code]);
    }
  };

  const handleAddCustom = async () => {
    if (busy) return;
    setFeedback(null);

    if (kind === 'language' && onAddCustomLanguage) {
      const check = validateCustomLanguage(
        {code: customLangCode, name: customLangName},
        customLanguages
      );
      if (!check.ok) {
        setFeedback({type: 'error', message: check.error});
        return;
      }
      setBusy(true);
      try {
        await onAddCustomLanguage({
          code: check.language.code,
          name: check.language.name,
        });
        setCustomLangCode('');
        setCustomLangName('');
        setShowAddForm(false);
        setFeedback({
          type: 'success',
          message: `Added language ${check.language.name} (${check.language.code.toUpperCase()}).`,
        });
      } catch (err) {
        setFeedback({
          type: 'error',
          message: err instanceof Error ? err.message : 'Unable to add language.',
        });
      } finally {
        setBusy(false);
      }
      return;
    }

    if (kind === 'region' && onAddCustomRegion) {
      const trimmedCountry = customCountryCode.trim().toUpperCase();
      const trimmedName = customRegionName.trim();
      const trimmedCode = customRegionCode.trim().toUpperCase();

      // Convenience: if user typed a 2-letter code into Name and left Country empty, infer it
      const inferredCountry =
        trimmedCountry || (/^[A-Za-z]{2}$/.test(trimmedName) ? trimmedName.toUpperCase() : '');
      const inferredCode = trimmedCode || (/^[A-Za-z]{2}$/.test(trimmedName) ? trimmedName.toUpperCase() : '');
      const cleanName = /^[A-Za-z]{2}$/.test(trimmedName) && !trimmedCode ? '' : trimmedName;

      const check = validateCustomRegion(
        {
          code: inferredCode || undefined,
          name: cleanName,
          countryCode: inferredCountry,
          defaultLanguage: customRegionDefaultLang.trim() || undefined,
          queryLocation: cleanName && inferredCountry && cleanName.length > 2 ? cleanName : undefined,
        },
        customRegions
      );

      if (!check.ok) {
        setFeedback({type: 'error', message: check.error});
        return;
      }

      setBusy(true);
      try {
        await onAddCustomRegion({
          code: check.region.code,
          name: check.region.name,
          countryCode: check.region.countryCode,
          defaultLanguage: check.region.defaultLanguage,
          queryLocation: check.region.queryLocation || undefined,
        });
        setCustomRegionName('');
        setCustomCountryCode('');
        setCustomRegionCode('');
        setCustomRegionDefaultLang('');
        setShowAddForm(false);
        setFeedback({
          type: 'success',
          message: `Added region ${check.region.name} (${check.region.code}).`,
        });
      } catch (err) {
        setFeedback({
          type: 'error',
          message: err instanceof Error ? err.message : 'Unable to add region.',
        });
      } finally {
        setBusy(false);
      }
    }
  };

  const handleRemoveCustom = async (code: string, optLabel: string) => {
    if (removingCode) return;
    setFeedback(null);
    setRemovingCode(code);
    try {
      if (kind === 'language' && onRemoveCustomLanguage) {
        await onRemoveCustomLanguage(code);
        setFeedback({
          type: 'success',
          message: `Removed custom language ${optLabel} (${code.toUpperCase()}).`,
        });
      } else if (kind === 'region' && onRemoveCustomRegion) {
        await onRemoveCustomRegion(code);
        setFeedback({
          type: 'success',
          message: `Removed custom region ${optLabel} (${code}).`,
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to remove custom entry.',
      });
    } finally {
      setRemovingCode(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {label && (
          <span className="text-xs font-medium text-[#57554E] dark:text-[#A8A49B]">{label}</span>
        )}
        <div className="flex items-center gap-2.5 text-[11px]">
          <span className="font-mono text-[#737067] dark:text-[#8E8A80] tabular-nums">
            {selected.length}/{options.length} active
          </span>
          <button
            type="button"
            onClick={() => onChange(allSelected ? [options[0].code] : allCodes)}
            className="underline underline-offset-2 text-[#1E3A5F] dark:text-[#9BBCE8] hover:opacity-80 whitespace-nowrap"
          >
            {allSelected ? 'Only primary' : 'Select all'}
          </button>
          {canAddCustom && (
            <button
              type="button"
              onClick={() => {
                setShowAddForm((v) => !v);
                setFeedback(null);
              }}
              aria-expanded={showAddForm}
              className="inline-flex items-center gap-1 underline underline-offset-2 text-[#1E3A5F] dark:text-[#9BBCE8] hover:opacity-80 whitespace-nowrap"
            >
              <Plus className="w-3 h-3" aria-hidden="true" />
              <span>{showAddForm ? 'Close' : kind === 'language' ? 'Add custom' : 'Add country / city'}</span>
            </button>
          )}
        </div>
      </div>

      <div
        role="group"
        aria-label={label || (kind === 'language' ? 'Languages' : 'Regions')}
        className="flex flex-wrap gap-1.5"
      >
        {options.map((opt) => {
          const active = selected.includes(opt.code);
          const removable =
            opt.isCustom &&
            (kind === 'language' ? Boolean(onRemoveCustomLanguage) : Boolean(onRemoveCustomRegion));
          return (
            <div key={opt.code} className="inline-flex items-stretch shrink-0">
              <button
                type="button"
                aria-pressed={active}
                aria-label={`${opt.label} (${opt.short})`}
                onClick={() => toggle(opt.code)}
                title={`${opt.label} (${opt.short})`}
                className={`inline-flex items-center gap-1 px-2 py-1 text-xs border transition-colors whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1E3A5F] ${
                  active
                    ? 'border-[#1E3A5F] dark:border-[#6B92C4] bg-[#1E3A5F]/12 dark:bg-[#6B92C4]/20 text-[#1E3A5F] dark:text-[#EAE8E1] font-medium'
                    : 'border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/50 dark:bg-[#1C1D1B] text-[#57554E] dark:text-[#A8A49B] hover:text-[#1B1B19] dark:hover:text-[#EAE8E1]'
                }`}
              >
                <span className="font-mono text-[11px]">{opt.short}</span>
                {(!compact || opt.isCustom) && <span>{opt.label}</span>}
              </button>
              {removable && (
                <button
                  type="button"
                  disabled={removingCode === opt.code}
                  onClick={() => void handleRemoveCustom(opt.code, opt.label)}
                  aria-label={`Remove custom ${kind} ${opt.label} (${opt.short})`}
                  title={`Remove custom ${opt.label}`}
                  className="px-1.5 border border-l-0 border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/70 dark:bg-[#1C1D1B] text-[#737067] hover:text-[#7F2929] dark:hover:text-[#D98A8A] disabled:opacity-40"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {showAddForm && kind === 'language' && (
        <div className="p-3 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/40 dark:bg-[#1C1D1B] space-y-2">
          <div className="text-[11px] text-[#57554E] dark:text-[#A8A49B]">
            Add any ISO 639 language code (e.g. <code className="font-mono">nl</code>,{' '}
            <code className="font-mono">zh</code>, <code className="font-mono">ar</code>,{' '}
            <code className="font-mono">ru</code>, <code className="font-mono">sv</code>).
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="custom-lang-code" className="sr-only">
              Language ISO code
            </label>
            <input
              id="custom-lang-code"
              type="text"
              value={customLangCode}
              onChange={(e) => setCustomLangCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddCustom();
                }
              }}
              placeholder="Code (e.g. nl)"
              className="w-28 px-2.5 py-1 text-xs font-mono bg-[#F6F4EF] dark:bg-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
            />
            <label htmlFor="custom-lang-name" className="sr-only">
              Language name (optional)
            </label>
            <input
              id="custom-lang-name"
              type="text"
              value={customLangName}
              onChange={(e) => setCustomLangName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddCustom();
                }
              }}
              placeholder="Name (optional, e.g. Dutch)"
              className="flex-1 min-w-40 px-2.5 py-1 text-xs bg-[#F6F4EF] dark:bg-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleAddCustom()}
              className="px-3 py-1 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
            >
              {busy ? 'Adding…' : 'Add Language'}
            </button>
          </div>
        </div>
      )}

      {showAddForm && kind === 'region' && (
        <div className="p-3 border border-[#DDD8CE] dark:border-[#2B2C28] bg-[#EFECE4]/40 dark:bg-[#1C1D1B] space-y-2">
          <div className="text-[11px] text-[#57554E] dark:text-[#A8A49B]">
            Add a country (e.g. <code className="font-mono">AR</code> / Argentina) or a city/local region
            (e.g. Fortaleza + country <code className="font-mono">BR</code>) to discover regional &amp; local newspapers.
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <div className="sm:col-span-5">
              <label htmlFor="custom-region-name" className="sr-only">
                Country, region, or city name
              </label>
              <input
                id="custom-region-name"
                type="text"
                value={customRegionName}
                onChange={(e) => setCustomRegionName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddCustom();
                  }
                }}
                placeholder="Country or city (e.g. Fortaleza, AR)"
                className="w-full px-2.5 py-1 text-xs bg-[#F6F4EF] dark:bg-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="custom-region-country" className="sr-only">
                2-letter country code
              </label>
              <input
                id="custom-region-country"
                type="text"
                maxLength={2}
                value={customCountryCode}
                onChange={(e) => setCustomCountryCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddCustom();
                  }
                }}
                placeholder="Country (BR)"
                className="w-full px-2 py-1 text-xs font-mono uppercase bg-[#F6F4EF] dark:bg-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="custom-region-lang" className="sr-only">
                Primary language code (optional)
              </label>
              <input
                id="custom-region-lang"
                type="text"
                maxLength={6}
                value={customRegionDefaultLang}
                onChange={(e) => setCustomRegionDefaultLang(e.target.value.toLowerCase())}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddCustom();
                  }
                }}
                placeholder="Lang (pt)"
                className="w-full px-2 py-1 text-xs font-mono lowercase bg-[#F6F4EF] dark:bg-[#141514] border border-[#DDD8CE] dark:border-[#2B2C28] text-[#1B1B19] dark:text-[#EAE8E1]"
              />
            </div>
            <div className="sm:col-span-3 flex gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleAddCustom()}
                className="flex-1 px-3 py-1 text-xs font-medium bg-[#1E3A5F] dark:bg-[#2A4B75] text-[#F6F4EF] hover:opacity-90 disabled:opacity-50 whitespace-nowrap"
              >
                {busy ? 'Adding…' : 'Add Region'}
              </button>
            </div>
          </div>
        </div>
      )}

      {feedback && (
        <p
          role={feedback.type === 'error' ? 'alert' : 'status'}
          className={`text-xs ${
            feedback.type === 'error'
              ? 'text-[#7F2929] dark:text-[#D98A8A]'
              : 'text-[#3F5E45] dark:text-[#8FB896]'
          }`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
