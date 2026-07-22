'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw, TriangleAlert } from 'lucide-react';

import { processingApi } from '@/lib/api-client';

export default function ReprocessButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function replaceResults() {
    setSubmitting(true);
    setError(null);
    try {
      await processingApi.reprocess(sessionId);
      setOpen(false);
      router.push(`/analysis/processing?session_id=${encodeURIComponent(sessionId)}&reprocess=1`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Reprocess could not be started.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        data-testid="reprocess-btn"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface"
      >
        <RefreshCw className="h-4 w-4" />
        Reprocess
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="reprocess-heading"
            className="w-full max-w-lg rounded-xl border border-border bg-background p-6 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-warning/10 p-2">
                <TriangleAlert className="h-5 w-5 text-warning" />
              </div>
              <div>
                <h2 id="reprocess-heading" className="text-lg font-semibold text-text-primary">
                  Reprocess and replace results?
                </h2>
                <p className="mt-2 text-sm text-text-secondary">
                  A successful run permanently replaces this session&apos;s analysis results,
                  QC, abundance artifacts, and saved GSEA and BioNet outputs using the current workflow.
                </p>
                <p className="mt-2 text-sm text-text-secondary">
                  Associated reports will be regenerated. Existing report links keep the same URL,
                  but people using those links will see the refreshed content.
                </p>
                <p className="mt-2 text-sm text-text-secondary">
                  If processing fails or is cancelled, the current results and reports are preserved.
                </p>
              </div>
            </div>
            {error && (
              <p className="mt-4 rounded-lg border border-error/20 bg-error/5 p-3 text-sm text-error">
                {error}
              </p>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-secondary hover:bg-surface disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={replaceResults}
                className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white hover:bg-error/90 disabled:opacity-50"
              >
                {submitting ? 'Starting…' : 'Reprocess and Replace Results'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
