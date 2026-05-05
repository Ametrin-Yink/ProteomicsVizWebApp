/**
 * EditableBadge Component
 * A click-to-edit inline badge for experiment/condition values
 */

'use client';

import React, { useState, useRef, useEffect } from 'react';

interface EditableBadgeProps {
  value: string;
  isEditing: boolean;
  onEdit: () => void;
  onSave: (value: string) => void;
  onCancel: () => void;
  colorClass: string;
  'data-testid'?: string;
}

export const EditableBadge: React.FC<EditableBadgeProps> = ({
  value,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  colorClass,
  'data-testid': testId,
}) => {
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSave(editValue.trim() || value);
    } else if (e.key === 'Escape') {
      setEditValue(value);
      onCancel();
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        data-testid={testId ? `${testId}-edit` : undefined}
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          onSave(editValue.trim() || value);
        }}
        className="w-28 px-2 py-0.5 bg-surface border border-primary rounded text-xs font-medium focus:outline-none"
      />
    );
  }

  return (
    <button
      data-testid={testId}
      onClick={onEdit}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors hover:opacity-80 cursor-pointer ${colorClass}`}
    >
      {value}
    </button>
  );
};

export default EditableBadge;
