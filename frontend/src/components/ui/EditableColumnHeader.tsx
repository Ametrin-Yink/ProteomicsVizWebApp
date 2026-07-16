'use client';
import { useState, useRef, useEffect } from 'react';
import { X, Pencil } from 'lucide-react';

interface EditableColumnHeaderProps {
  name: string;
  onRename: (newName: string) => void;
  onRemove?: () => void;
  canRemove?: boolean;
}

export function EditableColumnHeader({ name, onRename, onRemove, canRemove = true }: EditableColumnHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) onRename(trimmed);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input ref={inputRef} type="text" value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setIsEditing(false); }}
        className="px-1 py-0.5 text-xs font-medium bg-surface border border-primary rounded w-full min-w-[80px]"
        aria-label={`Rename column "${name}"`} />
    );
  }

  return (
    <div className="flex items-center gap-1 group" role="group" aria-label={`Column: ${name}`}>
      <button onClick={() => { setEditValue(name); setIsEditing(true); }}
        className="text-xs font-medium text-text-primary hover:text-primary transition-colors cursor-pointer flex items-center gap-1"
        title={`Rename column "${name}"`} aria-label={`Rename column "${name}"`}>
        {name}
        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
      </button>
      {canRemove && onRemove && (
        <button onClick={onRemove}
          className="column-remove-btn p-0.5 rounded hover:bg-error/10 text-text-muted hover:text-error transition-colors opacity-0 group-hover:opacity-100"
          title={`Remove column "${name}"`} aria-label={`Remove column "${name}"`}>
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
