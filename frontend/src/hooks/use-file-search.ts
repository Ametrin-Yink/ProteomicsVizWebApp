'use client';
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';

type BaseEntry = { name: string; type?: string; path: string };

interface UseFileSearchOptions<T extends BaseEntry> { entries: T[]; fileType?: 'csv' | 'txt' | 'all' | 'csv-only'; }

interface UseFileSearchResult<T extends BaseEntry> {
  searchQuery: string; setSearchQuery: (q: string) => void;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  filteredEntries: T[]; isSearching: boolean;
}

export function useFileSearch<T extends BaseEntry>({ entries, fileType = 'all' }: UseFileSearchOptions<T>): UseFileSearchResult<T> {
  const [searchQuery, setSearchQueryState] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setSearchQuery = useCallback((q: string) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setSearchQueryState(q);
    setDebouncedQuery(q);
  }, []);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQueryState(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setDebouncedQuery(value);
    }, 300);
  }, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const isSearching = searchQuery !== debouncedQuery;

  const filteredEntries = useMemo(() => {
    const folders = entries.filter(e => e.type === 'folder');
    let files = entries.filter(e => e.type !== 'folder');

    if (fileType === 'csv-only' || fileType === 'csv') {
      files = files.filter(e => e.type === 'csv' || e.type === 'tsv');
    } else if (fileType === 'txt') {
      files = files.filter(e => e.type === 'txt');
    }

    let result = [...folders, ...files] as T[];
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      result = result.filter((e) => e.name.toLowerCase().includes(q));
    }
    return result;
  }, [entries, fileType, debouncedQuery]);

  return { searchQuery, setSearchQuery, handleSearchChange, filteredEntries, isSearching };
}
