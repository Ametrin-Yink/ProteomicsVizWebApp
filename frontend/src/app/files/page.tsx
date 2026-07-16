'use client';

import React from 'react';
import { FileLibraryPage } from '@/components/files/FileLibraryPage';

export default function FilesPage() {
  return (
    <main className="flex-1 min-w-0">
      <h1 className="sr-only">File Library</h1>
      <FileLibraryPage />
    </main>
  );
}
