'use client';

import React, { useState, useEffect } from 'react';
import { FileDown } from 'lucide-react';
import { ExportModal } from './ExportModal';

interface ExportButtonProps {
  sessionId: string;
  pipeline?: string;
}

export default function ExportButton({ sessionId, pipeline }: ExportButtonProps) {
  const [showModal, setShowModal] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [isCompleted, setIsCompleted] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        if (!res.ok) return;
        const session = await res.json();
        if (cancelled) return;
        setIsCompleted(session.state === 'completed');
        setSessionName(session.name || '');
      } catch {} finally {
        if (!cancelled) setChecked(true);
      }
    }
    if (sessionId) check();
    return () => { cancelled = true; };
  }, [sessionId]);

  // Don't render at all until we've checked session state
  if (!checked || !isCompleted) return null;

  if (pipeline === 'ptm') {
    return (
      <a
        data-testid="download-ptm-results-btn"
        href={`/api/sessions/${encodeURIComponent(sessionId)}/ptm/results/download`}
        download="ptm_results.zip"
        className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-white transition-colors hover:bg-primary-dark"
      >
        <FileDown className="h-4 w-4" />
        Download Results
      </a>
    );
  }

  return (
    <>
      <button
        data-testid="export-report-btn"
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
      >
        <FileDown className="w-4 h-4" />
        Export
      </button>
      {showModal && (
        <ExportModal
          sessionId={sessionId}
          sessionName={sessionName}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
