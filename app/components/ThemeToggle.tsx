'use client';

import { useEffect, useState } from 'react';

// Stays in sync with the pre-paint script in app/layout.tsx.
export const THEME_STORAGE_KEY = 'preflight-theme';

type Theme = 'system' | 'light' | 'dark';

function isTheme(value: string | null): value is Theme {
  return value === 'system' || value === 'light' || value === 'dark';
}

function apply(theme: Theme) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

const OPTIONS: { value: Theme; label: string; icon: React.ReactNode }[] = [
  {
    value: 'system',
    label: 'System theme',
    icon: (
      <>
        <rect x="2.5" y="3" width="11" height="8" rx="1" />
        <path d="M6 13.5h4" />
      </>
    ),
  },
  {
    value: 'light',
    label: 'Light theme',
    icon: (
      <>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1v1.5M8 13.5V15M15 8h-1.5M2.5 8H1M12.9 3.1l-1 1M4.1 11.9l-1 1M12.9 12.9l-1-1M4.1 4.1l-1-1" />
      </>
    ),
  },
  {
    value: 'dark',
    label: 'Dark theme',
    icon: <path d="M13.2 9.6A5.7 5.7 0 0 1 6.4 2.8a5.7 5.7 0 1 0 6.8 6.8Z" />,
  },
];

export function ThemeToggle() {
  // Always starts at 'system' so the server and first client render agree. The
  // stored preference is read in the effect below; the page itself is already
  // showing the right theme by then, courtesy of the pre-paint script.
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_STORAGE_KEY);
    } catch {
      // Storage unavailable: stay on 'system'.
    }
    if (isTheme(stored)) setTheme(stored);
  }, []);

  // On 'system', follow the OS if it changes while the tab is open.
  useEffect(() => {
    if (theme !== 'system') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [theme]);

  function choose(next: Theme) {
    setTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Preference won't survive a reload, but the current page still follows it.
    }
    apply(next);
  }

  return (
    <div
      aria-label="Theme"
      className="sunken flex items-center gap-0.5 rounded-md border border-line p-0.5"
    >
      {OPTIONS.map((option) => {
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            onClick={() => choose(option.value)}
            className={
              'flex h-6 w-6 items-center justify-center rounded transition-colors ' +
              (active
                ? 'bg-[var(--seg-active)] text-ink shadow-[var(--lift)]'
                : 'text-faint hover:text-muted')
            }
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              className="h-3.5 w-3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              {option.icon}
            </svg>
          </button>
        );
      })}
    </div>
  );
}
