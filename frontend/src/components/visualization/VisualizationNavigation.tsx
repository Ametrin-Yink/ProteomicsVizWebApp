'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import ExportButton from '@/components/visualization/ExportButton';
import {
  getActiveModuleId,
  getModulesForManifest,
} from '@/config/visualization-modules';
import type { VisualizationManifest } from '@/types/api';

function buildTabHref(href: string, sessionId: string): string {
  const [path, query] = href.split('?');
  const params = new URLSearchParams(query || '');
  if (sessionId) params.set('session_id', sessionId);
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

export function VisualizationNavigation({
  manifest,
  sessionId,
}: {
  manifest: VisualizationManifest;
  sessionId: string;
}) {
  const pathname = usePathname();
  const activeTab = getActiveModuleId(pathname);
  const modules = getModulesForManifest(manifest);

  return (
    <div className="bg-background border-b border-border sticky top-0 z-10">
      <div className="mx-auto px-6">
        <div className="flex items-center justify-between py-2">
          <div className="flex items-center gap-1">
            {modules.map((module) => {
              const Icon = module.icon;
              const isActive = activeTab === module.id;

              if (!module.enabled) {
                return (
                  <span
                    key={module.id}
                    aria-disabled="true"
                    title={module.disabled_reason || undefined}
                    data-testid={`${module.id}-tab`}
                    className="flex cursor-not-allowed items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-text-muted opacity-45"
                  >
                    <Icon className="h-4 w-4" />
                    {module.label}
                  </span>
                );
              }

              return (
                <Link
                  key={module.id}
                  href={buildTabHref(module.href, sessionId)}
                  data-testid={`${module.id}-tab`}
                  className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-primary/5 text-primary'
                      : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {module.label}
                </Link>
              );
            })}
          </div>
          <ExportButton sessionId={sessionId} pipeline={manifest.pipeline} />
        </div>
      </div>
    </div>
  );
}
