'use client';

import React, { useEffect, useState, useRef } from 'react';
import { Trash2, ExternalLink, Loader2, Check, X, Pencil } from 'lucide-react';
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const startRename = (r: ReportItem) => {
    setEditingId(r.report_id);
    setEditName(r.name);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveRename = async (reportId: string) => {
    if (!editName.trim()) return;
    try {
      const res = await fetch(`/api/reports/${reportId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      });
      if (!res.ok) throw new Error('Rename failed');
      setReports((prev) =>
        prev.map((r) => (r.report_id === reportId ? { ...r, name: editName.trim() } : r))
      );
      setEditingId(null);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Rename failed');
    }
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent, reportId: string) => {
    if (e.key === 'Enter') saveRename(reportId);
    if (e.key === 'Escape') cancelRename();
  };

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
    <div className="max-w-4xl mx-auto px-6 py-8">
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
                <th className="text-left px-4 py-3 text-sm font-semibold w-[40%]">Name</th>
                <th className="text-left px-4 py-3 text-sm font-semibold w-[40%]">Experiment</th>
                <th className="text-right px-4 py-3 text-sm font-semibold w-[20%]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.report_id} className="border-b border-border hover:bg-surface transition-colors">
                  <td className="px-4 py-3">
                    {editingId === r.report_id ? (
                      <div className="flex items-center gap-1">
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => handleRenameKeyDown(e, r.report_id)}
                          className="flex-1 px-2 py-1 text-sm border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary bg-surface"
                        />
                        <button
                          onClick={() => saveRename(r.report_id)}
                          className="p-1 hover:bg-success/10 rounded transition-colors text-success"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={cancelRename}
                          className="p-1 hover:bg-error/10 rounded transition-colors text-error"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{r.name}</span>
                        <button
                          onClick={() => startRename(r)}
                          className="p-0.5 hover:bg-border rounded transition-colors text-text-muted hover:text-text-primary"
                          title="Rename"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-text-secondary text-sm">{r.session_name}</td>
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
