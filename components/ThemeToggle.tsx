'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('light') ? 'light' : 'dark',
  );

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  return (
    <button
      className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-violet hover:text-violet"
      onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
    >
      {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
    </button>
  );
}
