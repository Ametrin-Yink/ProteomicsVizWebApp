'use client';

import { useEffect, useState } from 'react';

import { useDebounce } from '@/hooks/use-debounce';
import { visualizationApi } from '@/lib/api-client';
import type { QCSampleMetric } from '@/types/api';

interface Props {
  apiPrefix: string;
}

export default function QCSampleHealthTable({ apiPrefix }: Props) {
  const [search, setSearch] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [previousCursors, setPreviousCursors] = useState<Array<string | undefined>>([]);
  const [page, setPage] = useState<{
    requestKey: string;
    items: QCSampleMetric[];
    nextCursor: string | null;
  }>({ requestKey: '', items: [], nextCursor: null });
  const debouncedSearch = useDebounce(search, 250);
  const requestKey = `${apiPrefix}\u0000${debouncedSearch}\u0000${cursor ?? ''}`;
  const loading = search !== debouncedSearch || page.requestKey !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    visualizationApi.getQCSamples(
      apiPrefix,
      debouncedSearch,
      cursor,
      controller.signal,
    ).then((page) => {
      setPage({
        requestKey,
        items: page.items,
        nextCursor: page.next_cursor,
      });
    }).catch((caught: unknown) => {
      if (caught instanceof Error && caught.name === 'AbortError') return;
      setPage({ requestKey, items: [], nextCursor: null });
    });
    return () => controller.abort();
  }, [apiPrefix, cursor, debouncedSearch, requestKey]);

  const showPrevious = previousCursors.length > 0;
  const { items, nextCursor } = page;

  return (
    <section className="mt-6 rounded-lg border border-border bg-background p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">Sample Health</h2>
          <p className="mt-1 text-xs text-text-muted">
            Exact per-sample metrics, shown 100 rows at a time
          </p>
        </div>
        <label className="text-xs font-medium text-text-secondary">
          Search samples
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setCursor(undefined);
              setPreviousCursors([]);
            }}
            placeholder="Sample, condition, or batch"
            className="mt-1 block w-64 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          />
        </label>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-border text-xs uppercase text-text-muted">
            <tr>
              <th className="px-3 py-2">Sample</th>
              <th className="px-3 py-2">Condition</th>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2 text-right">Present</th>
              <th className="px-3 py-2 text-right">Missing</th>
              <th className="px-3 py-2 text-right">Imputed</th>
              <th className="px-3 py-2 text-right">Imputed %</th>
              <th className="px-3 py-2 text-right">Median log2</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {!loading && items.map((item) => (
              <tr key={item.sample_id} className="text-text-secondary">
                <td className="px-3 py-2 font-medium text-text-primary">{item.sample_id}</td>
                <td className="px-3 py-2">{item.condition}</td>
                <td className="px-3 py-2">{item.batch ?? '—'}</td>
                <td className="px-3 py-2 text-right">{item.present_count.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{item.missing_count.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">{item.imputed_feature_count.toLocaleString()}</td>
                <td className="px-3 py-2 text-right">
                  {item.imputation_fraction == null ? '—' : `${(item.imputation_fraction * 100).toFixed(1)}%`}
                </td>
                <td className="px-3 py-2 text-right">
                  {item.median_log2_abundance == null ? '—' : item.median_log2_abundance.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="py-8 text-center text-sm text-text-muted">Loading sample metrics…</div>}
        {!loading && !items.length && <div className="py-8 text-center text-sm text-text-muted">No matching samples</div>}
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={!showPrevious || loading}
          onClick={() => {
            const previous = previousCursors.at(-1);
            setPreviousCursors((current) => current.slice(0, -1));
            setCursor(previous);
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary disabled:opacity-40"
        >
          Previous
        </button>
        <button
          type="button"
          disabled={!nextCursor || loading}
          onClick={() => {
            setPreviousCursors((current) => [...current, cursor]);
            setCursor(nextCursor ?? undefined);
          }}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-text-secondary disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </section>
  );
}
