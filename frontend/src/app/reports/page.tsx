'use client';

import React, { useEffect, useState } from 'react';
import { Download, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import { exportApi } from '@/lib/api-client';

interface ReportItem {
  report_id: string;
  name: string;
  session_id: string;
  session_name: string;
  created_at: string;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchReports = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await exportApi.listAll();
      setReports(data.reports);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reports');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReports(); }, []);

  const handleDelete = async (reportId: string) => {
    if (!confirm('Delete this report? This cannot be undone.')) return;
    try {
      await exportApi.delete(reportId);
      setReports((prev) => prev.filter((r) => r.report_id !== reportId));
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">Reports</h1>

      {loading && (
        <div className="flex items-center gap-3 text-text-secondary">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading reports...
        </div>
      )}

      {error && (
        <div className="p-4 bg-error/5 border border-error/20 rounded-lg text-error">{error}</div>
      )}

      {!loading && !error && reports.length === 0 && (
        <div className="text-center py-16 text-text-secondary">
          <p className="text-lg mb-2">No reports yet</p>
          <p className="text-sm">Complete an analysis and use the Export button to generate a report.</p>
        </div>
      )}

      {!loading && reports.length > 0 && (
        <div className="bg-background rounded-lg shadow-sm border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-4 py-3 text-sm font-semibold">Name</th>
                <th className="text-left px-4 py-3 text-sm font-semibold">Session</th>
                <th className="text-left px-4 py-3 text-sm font-semibold">Created</th>
                <th className="text-right px-4 py-3 text-sm font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.report_id} className="border-b border-border hover:bg-surface transition-colors">
                  <td className="px-4 py-3 font-medium">{r.name}</td>
                  <td className="px-4 py-3 text-text-secondary text-sm">{r.session_name}</td>
                  <td className="px-4 py-3 text-text-secondary text-sm">
                    {new Date(r.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <a
                        href={`/reports/${r.report_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-surface hover:bg-border rounded-lg transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" /> Open
                      </a>
                      <a
                        href={`/api/reports/${r.report_id}/download`}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm bg-surface hover:bg-border rounded-lg transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" /> ZIP
                      </a>
                      <button
                        onClick={() => handleDelete(r.report_id)}
                        className="flex items-center gap-1 px-3 py-1.5 text-sm text-error hover:bg-error/5 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
