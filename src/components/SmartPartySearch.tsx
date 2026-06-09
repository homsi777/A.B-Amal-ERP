import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface SmartPartyOption {
  id: string;
  name?: string;
  company?: string;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  contactEmail?: string | null;
  code?: string | null;
  address?: string | null;
  balance?: number | string | null;
}

interface SmartPartySearchProps<T extends SmartPartyOption> {
  options: T[];
  selectedId: string;
  onSelect: (id: string) => void;
  placeholder: string;
  emptyLabel?: string;
  className?: string;
  onEnterFallback?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

function partyName(option: SmartPartyOption): string {
  return String(option.name || option.company || '').trim();
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function SmartPartySearch<T extends SmartPartyOption>({
  options,
  selectedId,
  onSelect,
  placeholder,
  emptyLabel,
  className = '',
  onEnterFallback,
}: SmartPartySearchProps<T>) {
  const selected = options.find((option) => option.id === selectedId);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setQuery(selected ? partyName(selected) : '');
  }, [selectedId, selected]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    const ranked = options
      .map((option) => {
        const name = partyName(option);
        const fields = [
          name,
          option.phone,
          option.mobile,
          option.email,
          option.contactEmail,
          option.code,
          option.address,
        ].map(normalize);
        const starts = fields.some((field) => field.startsWith(q));
        const contains = fields.some((field) => field.includes(q));
        if (q && !contains) return null;
        return { option, rank: starts ? 0 : 1, name };
      })
      .filter((item): item is { option: T; rank: number; name: string } => Boolean(item))
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name, 'ar'));

    return ranked.slice(0, 12).map((item) => item.option);
  }, [options, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const choose = (option: T) => {
    setQuery(partyName(option));
    setOpen(false);
    onSelect(option.id);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`} dir="rtl">
      <input
        type="search"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          const next = event.target.value;
          setQuery(next);
          setOpen(true);
          if (selected && normalize(next) !== normalize(partyName(selected))) onSelect('');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((index) => Math.min(index + 1, Math.max(0, filtered.length - 1)));
            return;
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActiveIndex((index) => Math.max(0, index - 1));
            return;
          }
          if (event.key === 'Enter') {
            if (open && filtered[activeIndex]) {
              event.preventDefault();
              choose(filtered[activeIndex]);
              return;
            }
            onEnterFallback?.(event);
          }
          if (event.key === 'Escape') setOpen(false);
        }}
        placeholder={placeholder}
        className="w-full bg-white border border-slate-200 rounded-lg px-4 py-2 text-slate-900 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-sm"
        autoComplete="off"
      />

      {selected ? (
        <div className="mt-1 text-[11px] font-bold text-emerald-700">
          تم اختيار: {partyName(selected)}
        </div>
      ) : emptyLabel ? (
        <div className="mt-1 text-[11px] font-bold text-slate-500">{emptyLabel}</div>
      ) : null}

      {open && (
        <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
          {filtered.length ? (
            filtered.map((option, index) => {
              const name = partyName(option) || 'بدون اسم';
              const meta = [option.phone || option.mobile, option.code, option.address].filter(Boolean).join(' | ');
              return (
                <button
                  key={option.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(option)}
                  className={`block w-full px-3 py-2 text-right hover:bg-indigo-50 ${
                    index === activeIndex ? 'bg-indigo-50' : 'bg-white'
                  }`}
                >
                  <div className="font-bold text-slate-900">{name}</div>
                  {meta ? <div className="mt-0.5 text-xs text-slate-500">{meta}</div> : null}
                </button>
              );
            })
          ) : (
            <div className="px-3 py-3 text-sm font-semibold text-slate-500">لا توجد نتائج مطابقة</div>
          )}
        </div>
      )}
    </div>
  );
}
