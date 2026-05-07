/**
 * Top Navigation Bar
 * Dark background navigation with logo and links
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FlaskConical } from 'lucide-react';
import { cn } from '@/lib/utils';

const navLinks = [
  { href: '/', label: 'Home', id: 'home' },
  { href: '/reports', label: 'Reports', id: 'reports' },
  { href: '/about', label: 'About', id: 'about' },
];

export const TopNavigation: React.FC = () => {
  const pathname = usePathname();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-foreground text-white h-14 shadow-md">
      <div className="flex items-center h-full px-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-8" data-testid="app-logo">
          <FlaskConical className="w-6 h-6 text-secondary" />
          <span className="text-xl font-semibold tracking-tight" data-testid="app-name">
            ProteomicsViz
          </span>
        </Link>

        {/* Navigation Links */}
        <div className="flex items-center gap-1">
          {navLinks.map((link) => {
            const isActive = pathname === link.href || pathname.startsWith(link.href + '/');

            return (
              <Link
                key={link.id}
                href={link.href}
                className={cn(
                  'px-4 py-2 text-sm font-medium rounded-md transition-colors',
                  isActive
                    ? 'bg-foreground/80 text-white'
                    : 'text-text-muted hover:bg-foreground/60 hover:text-white'
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default TopNavigation;
