/**
 * Top Navigation Bar
 * Dark background navigation with logo, responsive links, and hamburger menu
 */

'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FlaskConical, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSidebar } from '@/components/layout/SidebarContext';

const navLinks = [
  { href: '/', label: 'Home', id: 'home' },
  { href: '/reports', label: 'Reports', id: 'reports' },
  { href: '/about', label: 'About', id: 'about' },
];

export const TopNavigation: React.FC = () => {
  const pathname = usePathname();
  const { toggleSidebar, isExpanded, isMobile } = useSidebar();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-foreground text-white h-14 shadow-md">
      <div className="flex items-center h-full px-4 lg:px-6">
        {/* Hamburger / Toggle Sidebar — visible on all screens */}
        <button
          onClick={toggleSidebar}
          className="flex items-center justify-center w-8 h-8 mr-2 rounded-md hover:bg-foreground/60 transition-colors lg:mr-4"
          aria-label={isExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
          data-testid="sidebar-toggle-btn"
        >
          {isExpanded && isMobile ? (
            <X className="w-5 h-5" />
          ) : (
            <Menu className="w-5 h-5" />
          )}
        </button>

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 mr-4 lg:mr-8" data-testid="app-logo">
          <FlaskConical className="w-5 h-5 lg:w-6 lg:h-6 text-secondary" />
          <span className="text-lg lg:text-xl font-semibold tracking-tight" data-testid="app-name">
            ProteomicsViz
          </span>
        </Link>

        {/* Navigation Links — hidden on small screens, icons-only on medium */}
        <div className="hidden lg:flex items-center gap-1">
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
