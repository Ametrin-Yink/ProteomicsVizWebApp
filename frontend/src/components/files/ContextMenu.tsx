'use client';

import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36);

  return (
    <div
      ref={ref}
      className="fixed z-50 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
      data-testid="context-menu"
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => {
            if (!item.disabled) {
              item.action();
              onClose();
            }
          }}
          disabled={item.disabled}
          className={cn(
            'w-full text-left px-3 py-1.5 text-sm transition-colors',
            item.danger
              ? 'text-error hover:bg-error/5'
              : 'text-text hover:bg-surface',
            item.disabled && 'opacity-40 cursor-not-allowed',
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
};

export default ContextMenu;
