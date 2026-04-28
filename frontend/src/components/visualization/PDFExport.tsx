'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { FileDown, X, Eye, RotateCcw, Loader2 } from 'lucide-react';
import { reportsApi } from '@/lib/api-client';

declare global {
  interface Window {
    Plotly?: {
      toImage: (el: HTMLElement, opts: { format: string; width: number; height: number; scale: number }) => Promise<string>;
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

/** Increase Plotly font sizes before capturing as image. */
async function enhancePlotFonts(iframe: HTMLIFrameElement, plotlyEl: HTMLElement): Promise<void> {
  const Plotly = iframe.contentWindow!.Plotly;
  const gd = plotlyEl as any;
  if (!gd || !gd.layout) return;

  const layout = gd.layout;

  // Global font
  layout.font = { ...layout.font, size: 20 };

  // Axis fonts — use titlefont (the relayout-compatible alias)
  if (layout.xaxis) {
    layout.xaxis.tickfont = { ...layout.xaxis.tickfont, size: 16 };
    layout.xaxis.titlefont = { ...layout.xaxis.titlefont, size: 18 };
  }
  if (layout.yaxis) {
    layout.yaxis.tickfont = { ...layout.yaxis.tickfont, size: 16 };
    layout.yaxis.titlefont = { ...layout.yaxis.titlefont, size: 18 };
  }

  // Legend
  if (layout.legend) {
    layout.legend.font = { ...layout.legend.font, size: 15 };
  }

  // Margins
  layout.margin = { ...layout.margin, t: 50, b: 80, l: 80, r: 40 };

  // Trigger layout re-render using dotted paths (Plotly requires these for relayout)
  await Plotly.relayout(gd, {
    'font.size': 20,
    'xaxis.titlefont.size': 18,
    'yaxis.titlefont.size': 18,
    'xaxis.tickfont.size': 16,
    'yaxis.tickfont.size': 16,
    'legend.font.size': 15,
    'margin.t': 50,
    'margin.b': 80,
    'margin.l': 80,
    'margin.r': 40,
  });
  await new Promise(r => setTimeout(r, 800));
}

/** Same as enhancePlotFonts but for the main window (no iframe). */
async function enhancePlotFontsMain(plotlyEl: HTMLElement): Promise<void> {
  const Plotly = (window as any).Plotly;
  const gd = plotlyEl as any;
  if (!gd || !gd.layout) return;

  const layout = gd.layout;

  layout.font = { ...layout.font, size: 20 };

  if (layout.xaxis) {
    layout.xaxis.tickfont = { ...layout.xaxis.tickfont, size: 16 };
    layout.xaxis.titlefont = { ...layout.xaxis.titlefont, size: 18 };
  }
  if (layout.yaxis) {
    layout.yaxis.tickfont = { ...layout.yaxis.tickfont, size: 16 };
    layout.yaxis.titlefont = { ...layout.yaxis.titlefont, size: 18 };
  }

  if (layout.legend) {
    layout.legend.font = { ...layout.legend.font, size: 15 };
  }

  layout.margin = { ...layout.margin, t: 50, b: 80, l: 80, r: 40 };

  await Plotly.relayout(gd, {
    'font.size': 20,
    'xaxis.titlefont.size': 18,
    'yaxis.titlefont.size': 18,
    'xaxis.tickfont.size': 16,
    'yaxis.tickfont.size': 16,
    'legend.font.size': 15,
    'margin.t': 50,
    'margin.b': 80,
    'margin.l': 80,
    'margin.r': 40,
  });
  await new Promise(r => setTimeout(r, 800));
}

/** Capture a Plotly chart as base64 PNG from an iframe. */
async function capturePlotFromIframe(
  iframe: HTMLIFrameElement,
  containerSelector: string,
): Promise<string | null> {
  const doc = iframe.contentDocument;
  if (!doc) return null;

  // Wait for the container element to render
  const container = await waitForElement(doc, containerSelector, 30000);
  if (!container) return null;

  // Wait for the Plotly element INSIDE the container to render
  const plotlyEl = await waitForElement(container, '.js-plotly-plot', 15000);
  if (!plotlyEl || !iframe.contentWindow?.Plotly) return null;

  try {
    // Enhance fonts for PDF readability
    await enhancePlotFonts(iframe, plotlyEl as HTMLElement);
    return await iframe.contentWindow.Plotly.toImage(plotlyEl as HTMLElement, {
      format: 'png', width: 1600, height: 1000, scale: 2,
    });
  } catch {
    return null;
  }
}

/** Capture ALL Plotly charts matching a selector from an iframe. */
async function captureAllFromIframe(
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
      await enhancePlotFonts(iframe, plotlyEl);
      const img = await iframe.contentWindow!.Plotly.toImage(plotlyEl, {
        format: 'png', width: 1600, height: 1000, scale: 2,
      });
      images.push(img);
    } catch { /* skip failed captures */ }
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
      // 1. Capture volcano plot from the current page (already rendered)
      const volcanoContainer = document.querySelector('[data-testid="volcano-plot"]');
      if (volcanoContainer && (window as any).Plotly) {
        const plotlyEl = volcanoContainer.querySelector('.js-plotly-plot') as HTMLElement;
        if (plotlyEl) {
          try {
            await enhancePlotFontsMain(plotlyEl);
            const img = await (window as any).Plotly.toImage(plotlyEl, {
              format: 'png', width: 1600, height: 1000, scale: 2,
            });
            images['volcano_plot'] = [img];
          } catch { /* skip */ }
        }
      }
      setProgress(15);

      // 2. Capture QC plots from hidden iframe
      const qcIframe = document.createElement('iframe');
      qcIframe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1280px;height:800px;';
      qcIframe.src = `${baseUrl}/analysis/visualization/qc?session_id=${sessionId}`;
      document.body.appendChild(qcIframe);

      // Wait for iframe content to load
      await new Promise<void>((resolve) => {
        qcIframe.onload = () => resolve();
        setTimeout(() => resolve(), 30000); // safety timeout
      });
      setProgress(35);

      // Capture individual QC plots (all 8 plots from QC page)
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
      removeIframe(qcIframe);

      // 3. Capture GSEA dashboard from hidden iframe
      const gseaIframe = document.createElement('iframe');
      gseaIframe.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1280px;height:800px;';
      gseaIframe.src = `${baseUrl}/analysis/visualization/bioinformatics?session_id=${sessionId}`;
      document.body.appendChild(gseaIframe);

      await new Promise<void>((resolve) => {
        gseaIframe.onload = () => resolve();
        setTimeout(() => resolve(), 30000);
      });
      setProgress(75);

      // Capture GSEA dashboard bar chart (plot inside gsea-overview)
      const gseaImg = await capturePlotFromIframe(gseaIframe, '[data-testid="gsea-overview"]');
      if (gseaImg) images['gsea_dashboard'] = [gseaImg];
      setProgress(85);
      removeIframe(gseaIframe);

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
      const blob = await reportsApi.download(sessionId, reportId);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `proteomics-analysis-report-${sessionId.slice(0, 8)}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
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
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        <FileDown className="w-4 h-4" />
        Export PDF
      </button>
    );
  }

  if (status === 'generating') {
    return (
      <div data-testid="pdf-generating" className="flex items-center gap-4">
        <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Generating PDF...</span>
        </div>
        <div data-testid="pdf-progress" className="text-sm text-gray-600">
          {progress}%
        </div>
        <button
          data-testid="cancel-pdf-btn"
          onClick={() => { setStatus('idle'); setProgress(0); }}
          className="flex items-center gap-1 px-3 py-1 text-sm text-red-600 hover:text-red-800 transition-colors"
        >
          <X className="w-4 h-4" />
          Cancel
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
          className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
        >
          <FileDown className="w-4 h-4" />
          Download PDF
        </button>
        <button
          data-testid="preview-pdf-btn"
          onClick={handlePreview}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
        >
          <Eye className="w-4 h-4" />
          Preview
        </button>
        <button
          data-testid="retry-pdf-btn"
          onClick={() => { setStatus('idle'); setReportId(null); handleExport(); }}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
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
              className="bg-white rounded-lg w-[90vw] h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between p-4 border-b">
                <h3 className="text-lg font-semibold">PDF Preview</h3>
                <button
                  data-testid="close-preview-btn"
                  onClick={handleClosePreview}
                  className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 p-4 bg-gray-100">
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
        <span className="text-red-600">PDF generation failed: {errorMessage}</span>
        <button
          data-testid="retry-pdf-btn"
          onClick={handleRetry}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
          Retry
        </button>
      </div>
    );
  }

  return null;
}
