/**
 * New Root Layout - Amica-style Design
 *
 * Three-panel layout:
 * 1. Top navigation bar (dark)
 * 2. Left sidebar (30% - file operations)
 * 3. Right content area (70% - main content)
 */

import type { Metadata, Viewport } from 'next';
import './globals.css';
import { TopNavigation } from '@/components/layout/TopNavigation';
import { SidebarProvider } from '@/components/layout/SidebarContext';
import { TaskStatusBar } from '@/components/layout/TaskStatusBar';
import { ToastProvider } from '@/components/ui/ToastProvider';
import { ErrorBoundary } from '@/components/ui/ErrorBoundary';

// Metadata
export const metadata: Metadata = {
  title: 'ProteomicsViz - Proteomics Analysis Platform',
  description: 'Analyze and visualize proteomics data with our six-stage processing pipeline.',
  keywords: ['proteomics', 'bioinformatics', 'data analysis', 'visualization'],
  icons: {
    icon: '/favicon.svg',
  },
};

// Viewport configuration
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#2d3748',
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <head>
        {/* Fix Plotly tooltip issues:
            1. overflow:visible — prevent SVG from clipping tooltips near edges
            2. transition:none — prevent Tailwind transitions from animating tooltip from (0,0) */}
        <style>{`.js-plotly-plot .main-svg{overflow:visible!important}.js-plotly-plot .main-svg,.js-plotly-plot .main-svg *{transition:none!important}`}</style>
      </head>
      <body className="antialiased font-sans bg-background overflow-auto">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded"
        >
          Skip to main content
        </a>
        <SidebarProvider>
          {/* Top Navigation Bar */}
          <TopNavigation />

          {/* Main Layout Container */}
          <div id="main-content" className="flex h-screen pt-14">
            <ErrorBoundary>{children}</ErrorBoundary>
          </div>

          {/* Task Status Bar - bottom-right task monitor */}
          <TaskStatusBar />

          {/* Toast notifications */}
          <ToastProvider />
        </SidebarProvider>
      </body>
    </html>
  );
}
