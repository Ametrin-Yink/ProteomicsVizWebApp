'use client';
import { useState, useRef, useCallback, useMemo } from 'react';

interface FileEntry { name: string; file_type?: string; path: string; [key: string]: unknown; }

interface UseFileSearchOptions { entries: FileEntry[]; fileType?: 'csv' | 'txt' | 'all' | 'csv-only'; }

interface UseFileSearchResult {
  searchQuery: string; setSearchQuery: (q: string) => void;
  handleSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  filteredEntries: FileEntry[]; isSearching: boolean;
}

export function useFileSearch({ entries, fileType = 'all' }: UseFileSearchOptions): UseFileSearchResult {
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
    if (fileType === 'csv-only' || fileType === 'csv') result = result.filter(e => e.file_type === 'csv' || e.file_type === 'tsv');
    else if (fileType === 'txt') result = result.filter(e => e.file_type === 'txt');
    if (debouncedQuery.trim()) {
      const q = debouncedQuery.toLowerCase();
      result = result.filter(e => e.name.toLowerCase().includes(q));
    }
    return result;
  }, [entries, fileType, debouncedQuery]);

  return { searchQuery, setSearchQuery, handleSearchChange, filteredEntries, isSearching };
}
