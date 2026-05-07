'use client';

import React, { useState, useCallback } from 'react';
import { X, Loader2, Link, Download, Copy, CheckCircle } from 'lucide-react';
import { captureAllStates, buildZipBlob, downloadZip, ExportError } from '@/lib/html-report-builder';
import { exportApi } from '@/lib/api-client';

interface ExportModalProps {
  sessionId: string;
  sessionName: string;
  onClose: () => void;
}

type ModalState = 'input' | 'generating' | 'weblink-ready' | 'error';

export function ExportModal({ sessionId, sessionName, onClose }: ExportModalProps) {
  const [name, setName] = useState(sessionName ? `${sessionName} Report` : '');
  const [state, setState] = useState<ModalState>('input');
  const [progressMsg, setProgressMsg] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [copied, setCopied] = useState(false);

  const handleGenerate = useCallback(async (mode: 'weblink' | 'zip') => {
    if (!name.trim()) return;
    setState('generating');
    setErrorMsg('');

    try {
      setProgressMsg('Capturing visualizations...');
      const { data } = await captureAllStates(sessionId);

      setProgressMsg(mode === 'zip' ? 'Assembling ZIP...' : 'Assembling archive...');
      const zipBlob = await buildZipBlob(data, name.trim(), sessionName);

      if (mode === 'zip') {
        setProgressMsg('Downloading...');
        downloadZip(zipBlob, name.trim());
        onClose();
      } else {
        setProgressMsg('Uploading to server...');
        const result = await exportApi.uploadWeblink(sessionId, zipBlob, name.trim());
        setResultUrl(`${window.location.origin}${result.weblink}`);
        setState('weblink-ready');
      }
    } catch (err) {
      const msg = err instanceof ExportError ? err.message : (err instanceof Error ? err.message : 'Unknown error');
      setErrorMsg(msg);
      setState('error');
    }
  }, [name, sessionId, sessionName, onClose]);

  const copyUrl = useCallback(async () => {
    try { await navigator.clipboard.writeText(resultUrl); setCopied(true); } catch {}
  }, [resultUrl]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-background rounded-lg w-[480px] max-w-[90vw] shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-semibold">Export Report</h3>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-lg transition-colors"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6">
          {state === 'input' && (
            <>
              <label className="block text-sm font-medium mb-2">Report Name</label>
              <input
                data-testid="report-name-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter report name..."
                className="w-full px-3 py-2 border border-border rounded-lg mb-6 focus:outline-none focus:ring-2 focus:ring-primary"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  data-testid="generate-weblink-btn"
                  disabled={!name.trim()}
                  onClick={() => handleGenerate('weblink')}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Link className="w-4 h-4" /> Generate Weblink
                </button>
                <button
                  data-testid="download-zip-btn"
                  disabled={!name.trim()}
                  onClick={() => handleGenerate('zip')}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-surface text-text-primary rounded-lg hover:bg-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Download className="w-4 h-4" /> Download ZIP
                </button>
              </div>
            </>
          )}

          {state === 'generating' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="text-text-secondary">{progressMsg}</p>
            </div>
          )}

          {state === 'weblink-ready' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <CheckCircle className="w-12 h-12 text-success" />
              <p className="font-semibold">Report ready!</p>
              <div className="flex items-center gap-2 w-full">
                <input
                  data-testid="weblink-url"
                  readOnly
                  value={resultUrl}
                  className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface"
                />
                <button
                  data-testid="copy-weblink-btn"
                  onClick={copyUrl}
                  className="flex items-center gap-1 px-3 py-2 bg-primary text-white rounded-lg text-sm"
                >
                  {copied ? <CheckCircle className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button onClick={onClose} className="px-4 py-2 bg-surface rounded-lg">Close</button>
            </div>
          )}

          {state === 'error' && (
            <div className="flex flex-col items-center gap-4 py-4">
              <p className="text-error font-semibold">Export failed</p>
              <p className="text-sm text-text-secondary text-center">{errorMsg}</p>
              <div className="flex gap-3">
                <button onClick={() => setState('input')} className="px-4 py-2 bg-surface rounded-lg">Back</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
