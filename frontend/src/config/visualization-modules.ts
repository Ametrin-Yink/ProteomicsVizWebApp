import type { ComponentType } from 'react';
import { ChartScatter, Activity, Spline } from 'lucide-react';

export interface VisualizationModule {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
}

export const VISUALIZATION_MODULES: VisualizationModule[] = [
  {
    id: 'volcano',
    label: 'Volcano Plot',
    href: '/analysis/visualization',
    icon: ChartScatter,
    description: 'Differential expression volcano plot and protein table',
  },
  {
    id: 'qc',
    label: 'QC Plots',
    href: '/analysis/visualization/qc',
    icon: Activity,
    description: 'Quality control plots for proteomics analysis',
  },
  {
    id: 'gsea',
    label: 'GSEA Analysis',
    href: '/analysis/visualization/gsea',
    icon: Spline,
    description: 'Gene Set Enrichment Analysis results',
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
