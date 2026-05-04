import type { ComponentType } from 'react';
import { ChartScatter, Activity, Spline } from 'lucide-react';

export interface VisualizationModule {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
  /** Templates this module supports. Empty/missing = all templates. */
  supportedTemplates?: string[];
}

export const VISUALIZATION_MODULES: VisualizationModule[] = [
  {
    id: 'volcano',
    label: 'Volcano Plot',
    href: '/analysis/visualization',
    icon: ChartScatter,
    description: 'Differential expression volcano plot and protein table',
    supportedTemplates: ['multi_condition_comparison'],
  },
  {
    id: 'qc',
    label: 'QC Plots',
    href: '/analysis/visualization/qc',
    icon: Activity,
    description: 'Quality control plots for proteomics analysis',
    supportedTemplates: ['multi_condition_comparison'],
  },
  {
    id: 'gsea',
    label: 'GSEA Analysis',
    href: '/analysis/visualization/gsea',
    icon: Spline,
    description: 'Gene Set Enrichment Analysis results',
    supportedTemplates: ['multi_condition_comparison'],
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
