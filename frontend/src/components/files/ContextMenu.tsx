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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!menuRef.current) return;
      const buttons = menuRef.current.querySelectorAll<HTMLButtonElement>('button');
      if (buttons.length === 0) return;

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIndex = Array.from(buttons).findIndex(
          (btn) => btn === document.activeElement
        );
        let nextIndex: number;
        if (currentIndex === -1) {
          nextIndex = e.key === 'ArrowDown' ? 0 : buttons.length - 1;
        } else if (e.key === 'ArrowDown') {
          nextIndex = (currentIndex + 1) % buttons.length;
        } else {
          nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
        }
        buttons[nextIndex].focus();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  // Auto-focus first menu item on mount
  useEffect(() => {
    if (menuRef.current) {
      const firstButton = menuRef.current.querySelector<HTMLButtonElement>('button');
      if (firstButton) {
        firstButton.focus();
      }
    }
  }, []);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36);

  return (
    <div
      ref={ref}
      role="menu"
      aria-orientation="vertical"
      className="fixed z-50 bg-background border border-border rounded-lg shadow-lg py-1 min-w-[180px]"
      style={{ left: adjustedX, top: adjustedY }}
      data-testid="context-menu"
    >
      <div ref={menuRef}>
        {items.map((item, i) => (
          <button
            key={i}
            role="menuitem"
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
    </div>
  );
};

export default ContextMenu;
