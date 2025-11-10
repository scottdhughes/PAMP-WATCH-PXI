'use client';

import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [mounted, setMounted] = useState(false);

  // Initialize theme from localStorage or default to dark
  useEffect(() => {
    setMounted(true);
    const savedTheme = localStorage.getItem('theme') as 'dark' | 'light' | null;
    const initialTheme = savedTheme || 'dark';
    setTheme(initialTheme);
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(initialTheme);
  }, []);

  // Update theme when it changes
  useEffect(() => {
    if (!mounted) return;

    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(theme);
    localStorage.setItem('theme', theme);
  }, [theme, mounted]);

  // Prevent flash of unstyled content
  if (!mounted) {
    return (
      <button className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200">
        Loading...
      </button>
    );
  }

  return (
    <button
      className="rounded-full border border-slate-700 px-4 py-2 text-sm text-slate-200 transition hover:border-violet hover:text-violet dark:text-slate-200 light:text-slate-700 light:border-slate-300"
      onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
    >
      {theme === 'dark' ? '☀️ Light Mode' : '🌙 Dark Mode'}
    </button>
  );
}
