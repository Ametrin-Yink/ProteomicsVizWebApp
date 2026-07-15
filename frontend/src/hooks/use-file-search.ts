'use client';
import { useState, useRef, useCallback, useMemo } from 'react';

type BaseEntry = { name: string; file_type?: string; path: string };

interface UseFileSearchOptions<T extends BaseEntry> { entries: T[]; fileType?: 'csv' | 'txt' | 'all' | 'csv-only'; }

interface UseFileSearchResult<T extends BaseEntry> {
  searchQuery: string; setSearchQuery: (q: string) => void;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  filteredEntries: T[]; isSearching: boolean;
}

export function useFileSearch<T extends BaseEntry>({ entries, fileType = 'all' }: UseFileSearchOptions<T>): UseFileSearchResult<T> {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebouncedQuery(value), 300);
  }, []);

  const isSearching = searchQuery !== debouncedQuery;

  const filteredEntries = useMemo(() => {
    let result = entries;
    if (fileType === 'csv-only' || fileType === 'csv') result = result.filter((e) => e.file_type === 'csv' || e.file_type === 'tsv') as typeof result;
    else if (fileType === 'txt') result = result.filter((e) => e.file_type === 'txt') as typeof result;
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      result = result.filter((e) => e.name.toLowerCase().includes(q));
    }
    return result;
  }, [entries, fileType, debouncedQuery]);

  return { searchQuery, setSearchQuery, handleSearchChange, filteredEntries, isSearching };
}
