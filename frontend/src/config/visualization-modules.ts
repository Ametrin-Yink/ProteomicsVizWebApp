import type { ComponentType } from 'react';
import type { VolcanoFilters, GSEADatabase, GSEAData } from '@/types/api';
import { ChartScatter, Activity, Spline, GitCompare, ChartNetwork, Dna, ScrollText } from 'lucide-react';
import { visualizationApi, getDataSource, sessionApiPrefix } from '@/lib/api-client';
import { buildVolcanoExport } from '@/lib/figures/volcano-figure';
import { buildQcExport } from '@/lib/figures/qc-figures';
import { buildGseaExport } from '@/lib/figures/gsea-figures';
import { buildCompareExport } from '@/lib/figures/compare-figure';
import { buildBioNetExport } from '@/lib/figures/bionet-graph';
import { formatGroup } from '@/lib/utils';

/** Serialized state produced by each visualization module for the HTML report. */
export interface ExportState {
  /** Which tab this data belongs to (matches module id). */
  tabId: string;
  /** Arbitrary serializable data — structure defined per module. */
  data: Record<string, unknown>;
}

export interface VisualizationModule {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
  /** Templates this module supports. Empty/missing = all templates. */
  supportedTemplates?: string[];
  /** Capture current visualization state for HTML export. null = skip this tab. */
  getExportState?: (sessionId: string, session?: Awaited<ReturnType<typeof getDataSource>>) => Promise<ExportState | null>;
}

/** Cast any object to Record<string, unknown> for the serialized export data. */
function toRecord<T>(obj: T): Record<string, unknown> {
  return obj as unknown as Record<string, unknown>;
}

function firstComparison(config: { comparisons?: Array<{ group1: Record<string, string>; group2: Record<string, string> }>; treatment?: string; control?: string } | undefined): { key: string; label: string } {
  if (config?.comparisons?.length) {
    const c = config.comparisons[0];
    const g1 = formatGroup(c.group1);
    const g2 = formatGroup(c.group2);
    return { key: `${g1}_vs_${g2}`, label: `${g1} vs ${g2}` };
  }
  if (config?.treatment && config?.control) {
    return { key: `${config.treatment}_vs_${config.control}`, label: `${config.treatment} vs ${config.control}` };
  }
  return { key: '', label: 'Treatment vs Control' };
}

export const VISUALIZATION_MODULES: VisualizationModule[] = [
  {
    id: 'volcano',
    label: 'Volcano Plot',
    href: '/analysis/visualization',
    icon: ChartScatter,
    description: 'Differential expression volcano plot and protein table',
    supportedTemplates: ['multi_condition_comparison'],
    getExportState: async (sessionId, session) => {
      const s = session || await getDataSource(sessionApiPrefix(sessionId));
      const comp = firstComparison(s?.config);
      const deData = await visualizationApi.getDEResults(sessionApiPrefix(sessionId), { per_page: 20000, comparison: comp.key || undefined });

      let filters: VolcanoFilters = { foldChange: 1, pValue: 0.05, adjPValue: 1, s0: 0.1 };
      if (s?.volcano_filters) {
        filters = { ...filters, ...s.volcano_filters };
      } else {
        try { const stored = localStorage.getItem('volcano_filters'); if (stored) filters = { ...filters, ...JSON.parse(stored) }; } catch {}
      }

      let markedList: string[] = [];
      const m = s.markers;
      if (Array.isArray(m)) markedList = m as string[];
      else if (m && typeof m === 'object') markedList = (m as Record<string, string[]>)[comp.key] || [];

      const exportData = buildVolcanoExport(deData.results, filters, comp.label, markedList);
      return { tabId: 'volcano', data: toRecord(exportData) };
    },
  },
  {
    id: 'qc',
    label: 'QC Plots',
    href: '/analysis/visualization/qc',
    icon: Activity,
    description: 'Quality control plots for proteomics analysis',
    supportedTemplates: ['multi_condition_comparison'],
    getExportState: async (sessionId, session) => {
      const [qcData, s] = await Promise.all([visualizationApi.getQCData(sessionApiPrefix(sessionId)), session || getDataSource(sessionApiPrefix(sessionId))]);
      const conditions = new Set<string>();
      s?.config?.comparisons?.forEach(c => {
        Object.keys(c.group1 || {}).forEach(k => conditions.add(k));
        Object.keys(c.group2 || {}).forEach(k => conditions.add(k));
      });
      if (s?.config?.treatment) conditions.add(s.config.treatment);
      if (s?.config?.control) conditions.add(s.config.control);
      const exportData = buildQcExport({ data: qcData, conditionList: Array.from(conditions), selectedComparison: '' });
      return { tabId: 'qc', data: toRecord(exportData) };
    },
  },
  {
    id: 'gsea',
    label: 'GSEA Analysis',
    href: '/analysis/visualization/gsea',
    icon: Spline,
    description: 'Gene Set Enrichment Analysis results',
    supportedTemplates: ['multi_condition_comparison'],
    getExportState: async (sessionId) => {
      const ALL_DBS: GSEADatabase[] = ['go_bp', 'go_mf', 'go_cc', 'kegg', 'reactome'];
      const status = await visualizationApi.getGSEAStatus(sessionApiPrefix(sessionId)).catch(() => null);
      const dbsToFetch = ALL_DBS.filter(db => status?.databases?.[db] === 'completed');
      if (dbsToFetch.length === 0) return null;

      const results = await Promise.all(dbsToFetch.map(async db => {
        try { const data = await visualizationApi.getGSEAData(sessionApiPrefix(sessionId), db, { per_page: 10000 }); return data.results?.length ? { db, data } : null; }
        catch { return null; }
      }));
      const gseaData: Record<string, GSEAData> = {};
      for (const r of results) { if (r) gseaData[r.db] = r.data; }
      if (Object.keys(gseaData).length === 0) return null;
      const exportData = buildGseaExport(gseaData);
      return { tabId: 'gsea', data: toRecord(exportData) };
    },
  },
  {
    id: 'compare',
    label: 'Compare',
    href: '/analysis/visualization/compare',
    icon: GitCompare,
    description: 'Protein and comparison correlation analysis',
    supportedTemplates: ['multi_condition_comparison'],
    getExportState: async (sessionId, session) => {
      const data = await visualizationApi.getComparisonCorrelationData(sessionApiPrefix(sessionId));
      if (!data?.similarity_matrix) return null;
      const s = session || await getDataSource(sessionApiPrefix(sessionId));
      const comps = s?.config?.comparisons || [];
      const label = comps.length ? comps.map(c => `${formatGroup(c.group1)} vs ${formatGroup(c.group2)}`).join(', ') : 'Comparison Correlation';
      const exportData = buildCompareExport(data, label);
      return { tabId: 'compare', data: toRecord(exportData) };
    },
  },
  {
    id: 'bionet',
    label: 'BioNet',
    href: '/analysis/visualization/bionet',
    icon: ChartNetwork,
    description: 'Protein-protein interaction network from INDRA database',
    supportedTemplates: ['multi_condition_comparison'],
    getExportState: async (sessionId, session) => {
      const subnetwork = await visualizationApi.getBioNetSubnetwork(sessionApiPrefix(sessionId));
      if (!subnetwork || !subnetwork.nodes?.length) return null;
      const s = session || await getDataSource(sessionApiPrefix(sessionId));
      let keyTargets: string[] = [];
      const m = s.markers;
      if (Array.isArray(m)) keyTargets = m as string[];
      else if (m && typeof m === 'object') { const perComp = m as Record<string, string[]>; keyTargets = perComp[Object.keys(perComp)[0] || ''] || []; }
      const exportData = buildBioNetExport(subnetwork.nodes, subnetwork.edges, keyTargets, 0.05, 0.5, undefined);
      return { tabId: 'bionet', data: toRecord(exportData) };
    },
  },
];

/** Derive the active module from a pathname by matching against the config. */
export function getActiveModuleId(pathname: string): string {
  for (const mod of VISUALIZATION_MODULES) {
    if (mod.id === 'volcano') continue;
    if (pathname === mod.href || pathname.startsWith(mod.href + '/')) {
      return mod.id;
    }
  }
  return 'volcano';
}

export function getModuleById(id: string): VisualizationModule | undefined {
  return VISUALIZATION_MODULES.find((m) => m.id === id);
}

/** PTM-specific visualization modules that link to placeholder pages. */
export const PTM_VISUALIZATION_MODULES: VisualizationModule[] = [
  {
    id: 'volcano',
    label: 'Volcano',
    href: '/analysis/visualization/ptm-placeholder?tab=volcano',
    icon: ChartScatter,
    description: 'PTM differential expression volcano plot',
  },
  {
    id: 'qc',
    label: 'QC',
    href: '/analysis/visualization/ptm-placeholder?tab=qc',
    icon: Activity,
    description: 'PTM quality control plots',
  },
  {
    id: 'site-abundance',
    label: 'Site Abundance',
    href: '/analysis/visualization/ptm-placeholder?tab=site-abundance',
    icon: Dna,
    description: 'PTM site-level abundance analysis',
  },
  {
    id: 'results',
    label: 'Results',
    href: '/analysis/visualization/ptm-placeholder?tab=results',
    icon: ScrollText,
    description: 'PTM analysis results table',
  },
  {
    id: 'bionet',
    label: 'BioNet',
    href: '/analysis/visualization/ptm-placeholder?tab=bionet',
    icon: ChartNetwork,
    description: 'PTM protein-protein interaction network',
  },
];

/**
 * Return the set of visualization modules appropriate for the given pipeline.
 * - 'ptm': shows only PTM-relevant tabs (placeholder content)
 * - 'msqrob2' or 'msstats' or undefined/null: shows all existing tabs
 */
export function getModulesForPipeline(pipeline?: string | null): VisualizationModule[] {
  if (pipeline === 'ptm') {
    return PTM_VISUALIZATION_MODULES;
  }
  return VISUALIZATION_MODULES;
}

/**
 * Filter visualization modules by template.
 * Modules with empty/missing supportedTemplates are available for all templates.
 * If no module matches the template, return ALL modules (fallback for unknown templates).
 */
export function getModulesForTemplate(template: string): VisualizationModule[] {
  const matched = VISUALIZATION_MODULES.filter((mod) => {
    if (!mod.supportedTemplates || mod.supportedTemplates.length === 0) return true;
    return mod.supportedTemplates.includes(template);
  });
  // Fallback: if no module matched, return all modules for unknown templates
  return matched.length > 0 ? matched : VISUALIZATION_MODULES;
}
