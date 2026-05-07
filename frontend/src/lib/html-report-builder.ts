import { exportStateRegistry, type ExportState } from '@/config/visualization-modules';

export interface ReportData {
  report: { name: string; session_name: string; created_at: string };
  tabs: { id: string; label: string }[];
  [tabId: string]: unknown;
}

export class ExportError extends Error {
  constructor(message: string, public readonly moduleName?: string) {
    super(message);
    this.name = 'ExportError';
  }
}

/** Collect export state from all registered visualization modules. */
export async function captureAllStates(sessionId: string): Promise<{ data: ReportData; errors: string[] }> {
  const modules = Array.from(exportStateRegistry.entries());
  const data: Record<string, unknown> = {};
  const tabs: { id: string; label: string }[] = [];
  const errors: string[] = [];

  for (const [id, getState] of modules) {
    try {
      const state = await getState(sessionId);
      if (state && state.data) {
        data[state.tabId] = state.data;
        tabs.push({ id: state.tabId, label: getModuleLabel(state.tabId) });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ExportError(`Failed to capture ${getModuleLabel(id)}: ${msg}`, getModuleLabel(id));
    }
  }

  // Sort tabs to match the order in VISUALIZATION_MODULES
  const { VISUALIZATION_MODULES } = await import('@/config/visualization-modules');
  const order = VISUALIZATION_MODULES.map((m) => m.id);
  tabs.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return {
    data: {
      report: { name: '', session_name: '', created_at: new Date().toISOString() },
      tabs,
      ...data,
    },
    errors,
  };
}

function getModuleLabel(id: string): string {
  const labels: Record<string, string> = {
    volcano: 'Volcano Plot', qc: 'QC Plots', gsea: 'GSEA Analysis',
    compare: 'Compare', bionet: 'BioNet',
  };
  return labels[id] || id;
}

/** Build a self-contained ZIP blob from report data. */
export async function buildZipBlob(
  reportData: ReportData,
  reportName: string,
  sessionName: string,
): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  // Populate metadata
  reportData.report.name = reportName;
  reportData.report.session_name = sessionName;
  reportData.report.created_at = new Date().toISOString();

  // Read template and replace placeholder
  const templateResponse = await fetch('/report-template.html');
  const template = await templateResponse.text();
  const html = template.replace('{{REPORT_DATA}}', JSON.stringify(reportData));
  zip.file('index.html', html);

  // Bundle assets
  const assets = zip.folder('assets');
  if (!assets) throw new ExportError('Failed to create assets folder');

  // Read Plotly and Cytoscape from public dir
  const [plotlyRes, cyRes] = await Promise.all([
    fetch('/plotly.min.js'),
    fetch('/cytoscape.min.js'),
  ]);
  if (!plotlyRes.ok || !cyRes.ok) throw new ExportError('Failed to load JS library assets');

  assets.file('plotly.min.js', await plotlyRes.blob());
  assets.file('cytoscape.min.js', await cyRes.blob());

  // Write data.json
  assets.file('data.json', JSON.stringify(reportData, null, 2));

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

/** Trigger browser download of a blob as a ZIP file. */
export function downloadZip(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^a-zA-Z0-9_-]/g, '_') + '.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
