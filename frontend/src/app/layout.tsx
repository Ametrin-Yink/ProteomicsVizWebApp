/**
 * New Root Layout - Amica-style Design
 * 
 * Three-panel layout:
 * 1. Top navigation bar (dark)
 * 2. Left sidebar (30% - file operations)
 * 3. Right content area (70% - main content)
 */

import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import { TopNavigation } from '@/components/layout/TopNavigation';
import { SidebarProvider } from '@/components/layout/SidebarContext';

// Load Plus Jakarta Sans font
const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

// Metadata
export const metadata: Metadata = {
  title: 'ProteomicsViz - Proteomics Analysis Platform',
  description: 'Analyze and visualize proteomics data with our powerful 9-step processing pipeline.',
  keywords: ['proteomics', 'bioinformatics', 'data analysis', 'visualization'],
};

// Viewport configuration
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#2d3748',
};

interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased font-sans bg-white">
        <SidebarProvider>
          {/* Top Navigation Bar */}
          <TopNavigation />
          
          {/* Main Layout Container */}
          <div className="flex h-screen pt-14">
            {children}
          </div>
        </SidebarProvider>
      </body>
    </html>
  );
}
