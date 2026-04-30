'use client';

import React from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: React.ReactNode;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  return (
    <div className="bg-white rounded-lg border border-border p-8 text-center">
      {icon && (
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface flex items-center justify-center">
          {icon}
        </div>
      )}
      <h3 className="text-lg font-medium text-text mb-2">{title}</h3>
      <p className="text-sm text-text-secondary max-w-sm mx-auto mb-4">{description}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-[#C42A52] transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
