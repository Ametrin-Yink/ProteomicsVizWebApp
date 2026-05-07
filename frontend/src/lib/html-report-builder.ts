import { VISUALIZATION_MODULES, getModuleById } from '@/config/visualization-modules';

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

/** Collect export state from all visualization modules. */
export async function captureAllStates(sessionId: string): Promise<{ data: ReportData; errors: string[] }> {
  const data: Record<string, unknown> = {};
  const tabs: { id: string; label: string }[] = [];
  const errors: string[] = [];

  for (const mod of VISUALIZATION_MODULES) {
    if (!mod.getExportState) continue;
    try {
      const state = await mod.getExportState(sessionId);
      if (state && state.data) {
        data[state.tabId] = state.data;
        tabs.push({ id: state.tabId, label: mod.label });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed to capture ${mod.label}: ${msg}`);
    }
  }

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
  return getModuleById(id)?.label ?? id;
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

  // Inject the user's current theme CSS custom property values
  let themeOverride = '';
  if (typeof window !== 'undefined') {
    const cs = getComputedStyle(document.documentElement);
    const vars = ['--primary','--primary-dark','--background','--surface',
      '--border','--text-primary','--text-secondary','--text-muted',
      '--success','--error','--warning','--shadow-sm','--shadow-md'];
    const decls = vars.map(v => `${v}: ${cs.getPropertyValue(v).trim()};`).join(' ');
    themeOverride = `<style id="theme-override">:root{${decls}}</style>`;
  }
  const finalHtml = template.replace('{{REPORT_DATA}}', JSON.stringify(reportData));
  const html = themeOverride ? finalHtml.replace('</head>', `${themeOverride}\n</head>`) : finalHtml;
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
