'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { FileDown, X, Eye, RotateCcw, Loader2 } from 'lucide-react';
import { reportsApi } from '@/lib/api-client';

interface PlotlyGraphDiv {
  data: unknown[];
  layout: Record<string, unknown>;
}

declare global {
  interface Window {
    Plotly?: {
      toImage: (el: HTMLElement, opts: { format: string; width: number; height: number; scale: number }) => Promise<string>;
      newPlot: (el: HTMLElement, data: unknown[], layout: Record<string, unknown>, config?: Record<string, unknown>) => Promise<void>;
      purge: (el: HTMLElement) => void;
    };
  }
}

interface PDFExportProps {
  sessionId: string;
}

type PDFStatus = 'idle' | 'generating' | 'ready' | 'error';

/** Wait for an element to appear inside a container. */
function waitForElement(
  root: Document | Element,
  selector: string,
  timeoutMs: number,
): Promise<Element | null> {
  return new Promise((resolve) => {
    const el = root.querySelector(selector);
    if (el) { resolve(el); return; }

    const start = Date.now();
    const timer = setInterval(() => {
      const found = root.querySelector(selector);
      if (found) { clearInterval(timer); resolve(found); return; }
      if (Date.now() - start > timeoutMs) { clearInterval(timer); resolve(null); }
    }, 200);
  });
}

/** Deep-clone a layout and apply fonts for PDF readability.
 *
 * Scale math (all plots use same 15pt source fonts):
 *   Grid (500px capture → 314px in PDF): 62.8% → 15 × 0.628 = ~9.4pt
 *   Full-width (1000px capture → 664px in PDF): 66.4% → 15 × 0.664 = ~10pt
 * Both land near body text size (9.5pt).
 */
function cloneLayoutWithFonts(layout: Record<string, unknown>): Record<string, unknown> {
  const l = JSON.parse(JSON.stringify(layout));

  // Chart title (top-level)
  if (l.title && typeof l.title === 'object') {
    (l.title as Record<string, unknown>).font = { family: 'Arial, sans-serif', size: 15, color: '#111827' };
  }

  // Global font
  l.font = { family: 'Arial, sans-serif', size: 15, color: '#111827' };

  // Apply fonts to all axes
  const axes = ['xaxis', 'yaxis', 'xaxis2', 'yaxis2', 'xaxis3', 'yaxis3', 'xaxis4', 'yaxis4'];
  for (const key of axes) {
    if (l[key]) {
      const ax = l[key] as Record<string, unknown>;
      ax.tickfont = { family: 'Arial, sans-serif', size: 13, color: '#111827' };
      ax.titlefont = { family: 'Arial, sans-serif', size: 14, color: '#111827' };
      if (typeof ax.title === 'object' && ax.title !== null) {
        (ax.title as Record<string, unknown>).font = { family: 'Arial, sans-serif', size: 14, color: '#111827' };
      }
    }
  }

  // Legend
  if (l.legend) {
    (l.legend as Record<string, unknown>).font = { family: 'Arial, sans-serif', size: 12, color: '#111827' };
  }

  // Annotations
  if (Array.isArray(l.annotations)) {
    for (const ann of l.annotations) {
      if (ann && typeof ann === 'object') {
        (ann as Record<string, unknown>).font = { family: 'Arial, sans-serif', size: 13, color: '#111827' };
      }
    }
  }

  l.margin = { ...(l.margin as object || {}), t: 50, b: 80, l: 80, r: 40 };
  return l;
}

/** Create a hidden div, plot with enhanced fonts, capture, and clean up. */
async function capturePlotWithFonts(
  Plotly: typeof window.Plotly,
  data: unknown[],
  layout: Record<string, unknown>,
  /** Use 1000px for full-width plots, 500px for 2-column grid plots. */
  size: 'full' | 'grid' = 'grid',
): Promise<string | null> {
  const isFull = size === 'full';
  const w = isFull ? 1000 : 500;
  const h = Math.round(w * 0.625);
  const container = document.createElement('div');
  container.style.cssText = `position:absolute;left:-9999px;top:-9999px;width:${w}px;height:${h}px;`;
  document.body.appendChild(container);

  try {
    const enhancedLayout = cloneLayoutWithFonts(layout);
    await Plotly!.newPlot(container, data, enhancedLayout, { staticPlot: true });
    await new Promise(r => setTimeout(r, 800));
    const img = await Plotly!.toImage(container, {
      format: 'png', width: w, height: h, scale: 1,
    });
    return img;
  } catch (err) {
    console.error('Failed to capture plot with fonts:', err);
    return null;
  } finally {
    Plotly?.purge(container);
    container.remove();
  }
}

/** Capture a Plotly chart as base64 PNG from an iframe using off-screen clone. */
async function capturePlotFromIframe(
  iframe: HTMLIFrameElement,
  containerSelector: string,
): Promise<string | null> {
  const doc = iframe.contentDocument;
  if (!doc) return null;

  const container = await waitForElement(doc, containerSelector, 30000);
  if (!container) return null;

  const plotlyEl = await waitForElement(container, '.js-plotly-plot', 15000);
  if (!plotlyEl || !iframe.contentWindow?.Plotly) return null;

  try {
    const Plotly = iframe.contentWindow.Plotly;
    const gd = plotlyEl as unknown as PlotlyGraphDiv;
    if (!gd || !gd.data || !gd.layout) return null;

    return await capturePlotWithFonts(Plotly, gd.data, gd.layout);
  } catch (err) {
    console.error('Failed to capture plot from iframe:', err);
    return null;
  }
}

/** Capture ALL Plotly charts matching a selector from an iframe. */
async function _captureAllFromIframe(
  iframe: HTMLIFrameElement,
  containerSelector: string,
): Promise<string[]> {
  const doc = iframe.contentDocument;
  if (!doc) return [];

  const containers = await waitForElement(doc, containerSelector, 30000);
  if (!containers) return [];

  const images: string[] = [];
  const allContainers = doc.querySelectorAll(containerSelector);
  if (!iframe.contentWindow?.Plotly) return images;

  for (let i = 0; i < allContainers.length; i++) {
    const plotlyEl = allContainers[i].querySelector('.js-plotly-plot') as HTMLElement;
    if (!plotlyEl) continue;
    try {
      const Plotly = iframe.contentWindow.Plotly;
      const gd = plotlyEl as unknown as PlotlyGraphDiv;
      if (!gd || !gd.data || !gd.layout) continue;

      const img = await capturePlotWithFonts(Plotly, gd.data, gd.layout);
      if (img) images.push(img);
    } catch (err) {
      console.error('Failed to capture plot in _captureAllFromIframe:', err);
    }
  }
  return images;
}

function removeIframe(iframe: HTMLIFrameElement | null) {
  if (iframe && iframe.parentNode) {
    iframe.parentNode.removeChild(iframe);
  }
}

export default function PDFExport({ sessionId }: PDFExportProps) {
  const [status, setStatus] = useState<PDFStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [reportId, setReportId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleExport = useCallback(async () => {
    setStatus('generating');
    setProgress(0);
    setErrorMessage('');
    setReportId(null);

    const images: Record<string, string[]> = {};
    const baseUrl = window.location.origin;

    try {
      // 1. Capture volcano plot from the current page (clone to off-screen div, don't mutate)
      const volcanoContainer = document.querySelector('[data-testid="volcano-plot"]');
      if (volcanoContainer && window.Plotly) {
        const plotlyEl = volcanoContainer.querySelector('.js-plotly-plot') as HTMLElement;
        if (plotlyEl) {
          try {
            const gd = plotlyEl as unknown as PlotlyGraphDiv;
            if (gd.data && gd.layout) {
              const img = await capturePlotWithFonts(window.Plotly, gd.data, gd.layout, 'full');
              if (img) images['volcano_plot'] = [img];
            }
          } catch (err) {
            console.error('Failed to capture volcano plot:', err);
          }
        }
      }
      setProgress(15);

      // 2. Capture QC plots from hidden iframe
      const qcIframe = document.createElement('iframe');
      qcIframe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1280px;height:800px;';
      qcIframe.src = `${baseUrl}/analysis/visualization/qc?session_id=${sessionId}`;
      document.body.appendChild(qcIframe);

      try {
        await new Promise<void>((resolve) => {
          qcIframe.onload = () => resolve();
          setTimeout(() => resolve(), 30000);
        });
        setProgress(35);

        const qcSelectors: Record<string, string> = {
          'qc_pca': '[data-testid="pca-plot"]',
          'qc_pvalue': '[data-testid="pvalue-plot"]',
          'qc_psm_cv': '[data-testid="psm-cv-plot"]',
          'qc_protein_cv': '[data-testid="protein-cv-plot"]',
          'qc_psm_intensity': '[data-testid="psm-intensity-plot"]',
          'qc_protein_intensity': '[data-testid="protein-intensity-plot"]',
          'qc_completeness': '[data-testid="completeness-plot"]',
          'qc_psm_completeness': '[data-testid="psm-completeness-plot"]',
        };

        for (const [key, selector] of Object.entries(qcSelectors)) {
          const img = await capturePlotFromIframe(qcIframe, selector);
          if (img) images[key] = [img];
        }
        setProgress(55);
      } finally {
        removeIframe(qcIframe);
      }

      // 3. Capture GSEA dashboard from hidden iframe
      const gseaIframe = document.createElement('iframe');
      gseaIframe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1280px;height:800px;';
      gseaIframe.src = `${baseUrl}/analysis/visualization/gsea?session_id=${sessionId}`;
      document.body.appendChild(gseaIframe);

      try {
        await new Promise<void>((resolve) => {
          gseaIframe.onload = () => resolve();
          setTimeout(() => resolve(), 30000);
        });
        setProgress(75);

        const gseaImg = await capturePlotFromIframe(gseaIframe, '[data-testid="gsea-overview"]');
        if (gseaImg) images['gsea_dashboard'] = [gseaImg];
        setProgress(85);
      } finally {
        removeIframe(gseaIframe);
      }

      // 4. Read current filter settings
      let filters = { foldChange: 1, pValue: 0.05, adjPValue: 1, s0: 0.1 };
      try {
        const saved = localStorage.getItem('volcano_filters');
        if (saved) filters = JSON.parse(saved);
      } catch {}

      // 5. Send to backend
      const response = await reportsApi.generate(sessionId, {
        fold_change: filters.foldChange,
        p_value: filters.pValue,
        adj_p_value: filters.adjPValue,
        s0: filters.s0,
        images,
      });
      setProgress(100);
      setReportId(response.report_id);
      setStatus('ready');
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error occurred';
      setStatus('error');
      setErrorMessage(msg);
    }
  }, [sessionId]);

  const handleDownload = useCallback(async () => {
    if (!reportId) return;

    try {
      // Link directly to download endpoint — server Content-Disposition triggers file save
      const downloadUrl = `/api/sessions/${sessionId}/reports/${reportId}/download`;
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Download failed');
    }
  }, [sessionId, reportId]);

  const handlePreview = useCallback(async () => {
    if (!reportId) return;

    try {
      const blob = await reportsApi.download(sessionId, reportId);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setShowPreview(true);
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Preview failed');
    }
  }, [sessionId, reportId]);

  const handleClosePreview = useCallback(() => {
    setShowPreview(false);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  const handleRetry = useCallback(() => {
    setStatus('idle');
    setErrorMessage('');
    handleExport();
  }, [handleExport]);

  if (status === 'idle') {
    return (
      <button
        data-testid="export-pdf-btn"
        onClick={handleExport}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
      >
        <FileDown className="w-4 h-4" />
        Export PDF
      </button>
    );
  }

  if (status === 'generating') {
    return (
      <div data-testid="pdf-generating" className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-4 py-2 bg-info/5 text-secondary rounded-lg">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Generating PDF...</span>
        </div>
        <div data-testid="pdf-progress" className="text-sm text-text-muted">
          {progress}%
        </div>
        <button
          data-testid="cancel-pdf-btn"
          onClick={() => { setStatus('idle'); setProgress(0); }}
          className="flex items-center gap-1 px-3 py-1 text-sm text-error hover:text-error transition-colors"
        >
          <X className="w-4 h-4" />
          Dismiss
        </button>
      </div>
    );
  }

  if (status === 'ready') {
    return (
      <div data-testid="pdf-ready" className="flex items-center gap-2">
        <button
          data-testid="download-pdf-btn"
          onClick={handleDownload}
          className="flex items-center gap-2 px-4 py-2 bg-success text-white rounded-lg hover:bg-success/90 transition-colors"
        >
          <FileDown className="w-4 h-4" />
          Download PDF
        </button>
        <button
          data-testid="preview-pdf-btn"
          onClick={handlePreview}
          className="flex items-center gap-2 px-4 py-2 bg-surface text-text rounded-lg hover:bg-border transition-colors"
        >
          <Eye className="w-4 h-4" />
          Preview
        </button>
        <button
          data-testid="retry-pdf-btn"
          onClick={() => { setStatus('idle'); setReportId(null); handleExport(); }}
          className="flex items-center gap-2 px-4 py-2 bg-surface text-text rounded-lg hover:bg-border transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Regenerate
        </button>

        {showPreview && previewUrl && (
          <div
            data-testid="pdf-preview-modal"
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
            onClick={handleClosePreview}
          >
            <div
              className="bg-background rounded-lg w-[90vw] h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="text-lg font-semibold">PDF Preview</h3>
                <button
                  data-testid="close-preview-btn"
                  onClick={handleClosePreview}
                  className="p-2 hover:bg-surface rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 p-4 bg-surface">
                <iframe
                  data-testid="pdf-viewer"
                  src={previewUrl}
                  className="w-full h-full rounded-lg shadow-sm"
                  title="PDF Preview"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div data-testid="pdf-error" className="flex items-center gap-4">
        <span className="text-error">PDF generation failed: {errorMessage}</span>
        <button
          data-testid="retry-pdf-btn"
          onClick={handleRetry}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  return null;
}
