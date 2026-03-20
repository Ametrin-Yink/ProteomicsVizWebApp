/**
 * Root Layout
 * 
 * Global layout with SessionManager sidebar and Toast provider.
 */

import type { Metadata, Viewport } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

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
  description: 'Analyze and visualize proteomics data with our powerful 9-step processing pipeline. From raw PSM data to differential expression and pathway analysis.',
  keywords: ['proteomics', 'bioinformatics', 'data analysis', 'visualization', 'mass spectrometry'],
  authors: [{ name: 'ProteomicsViz Team' }],
  openGraph: {
    title: 'ProteomicsViz - Proteomics Analysis Platform',
    description: 'Analyze and visualize proteomics data with our powerful 9-step processing pipeline.',
    type: 'website',
  },
};

// Viewport configuration
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#E73564',
};

// Root layout props
interface RootLayoutProps {
  children: React.ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en" className={plusJakartaSans.variable}>
      <head>
        {/* Preconnect to improve performance */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased font-sans">
        {/* Toast Provider Container - rendered by individual pages using useToast hook */}
        {children}
      </body>
    </html>
  );
}
