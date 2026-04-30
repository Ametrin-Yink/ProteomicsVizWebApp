/**
 * Session Card Component
 * 
 * Displays a single session with status and actions.
 */

'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import {
  MoreHorizontal,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  Trash2,
  Copy,
  FileText,
  Edit3,
  X,
  Check,
} from 'lucide-react';
import type { Session } from '@/types/session';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProgressBar } from '@/components/ui/Loading';

// Session card props
export interface SessionCardProps {
  session: Session;
  isActive?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
  onClone?: () => void;
  className?: string;
}

// Status configuration
const statusConfig: Record<Session['status'], { 
  icon: typeof Play; 
  color: string; 
  bgColor: string;
  label: string;
}> = {
  created: {
    icon: FileText,
    color: 'text-text-secondary',
    bgColor: 'bg-border/10',
    label: 'Created',
  },
  uploading: {
    icon: Clock,
    color: 'text-secondary',
    bgColor: 'bg-secondary/10',
    label: 'Uploading',
  },
  uploaded: {
    icon: CheckCircle2,
    color: 'text-success',
    bgColor: 'bg-success/5',
    label: 'Ready',
  },
  processing: {
    icon: Clock,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    label: 'Processing',
  },
  queued: {
    icon: Clock,
    color: 'text-warning',
    bgColor: 'bg-warning/5',
    label: 'Queued',
  },
  completed: {
    icon: CheckCircle2,
    color: 'text-success',
    bgColor: 'bg-success/5',
    label: 'Completed',
  },
  error: {
    icon: AlertCircle,
    color: 'text-error',
    bgColor: 'bg-error/5',
    label: 'Error',
  },
  cancelled: {
    icon: X,
    color: 'text-text-secondary',
    bgColor: 'bg-border/10',
    label: 'Cancelled',
  },
};

/**
 * Session Card component
 */
export const SessionCard: React.FC<SessionCardProps> = ({
  session,
  isActive = false,
  onClick,
  onDelete,
  onClone,
  className,
}) => {
  const [showActions, setShowActions] = React.useState(false);
  const status = statusConfig[session.status];
  const StatusIcon = status.icon;

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Card
      variant={isActive ? 'elevated' : 'default'}
      isInteractive
      isHoverable
      padding="md"
      className={cn(
        'relative cursor-pointer',
        isActive && 'ring-2 ring-primary ring-offset-2',
        className
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-text truncate">
            {session.name}
          </h4>
        </div>

        {/* Actions menu */}
        <div className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={(e) => {
              e.stopPropagation();
              setShowActions(!showActions);
            }}
          >
            <MoreHorizontal className="w-4 h-4" />
          </Button>

          {/* Dropdown */}
          {showActions && (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowActions(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-border z-50 py-1">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text hover:bg-surface"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClone?.();
                    setShowActions(false);
                  }}
                >
                  <Copy className="w-4 h-4" />
                  Duplicate
                </button>
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error hover:bg-error/5"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete?.();
                    setShowActions(false);
                  }}
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Status badge */}
      <div className="flex items-center gap-2 mt-3">
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium',
            status.bgColor,
            status.color
          )}
        >
          <StatusIcon className="w-3.5 h-3.5" />
          {status.label}
        </span>
        
        {session.uploadedFiles.length > 0 && (
          <span className="text-xs text-text-secondary">
            {session.uploadedFiles.length} files
          </span>
        )}
      </div>

      {/* Progress bar for processing */}
      {session.status === 'processing' && (
        <div className="mt-3">
          <ProgressBar
            progress={session.progress}
            size="sm"
            showPercentage={false}
            color="primary"
          />
          {session.currentStep && (
            <p className="text-xs text-text-secondary mt-1 truncate">
              Step: {session.currentStep.replace(/_/g, ' ')}
            </p>
          )}
        </div>
      )}

      {/* Error message */}
      {session.status === 'error' && session.errorMessage && (
        <p className="mt-3 text-xs text-error truncate">
          {session.errorMessage}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
        <span className="text-xs text-muted">
          {formatDate(session.createdAt)}
        </span>
        
        {session.status === 'completed' && session.results && (
          <span className="text-xs text-success font-medium">
            View Results
          </span>
        )}
      </div>
    </Card>
  );
};

// Mini session card for compact display
export interface MiniSessionCardProps {
  session: Session;
  isActive?: boolean;
  onClick?: () => void;
  onDelete?: () => void;
  onRename?: (newName: string) => void;
  isSelectMode?: boolean;
  isSelected?: boolean;
  onSelectChange?: (checked: boolean) => void;
  className?: string;
}

export const MiniSessionCard: React.FC<MiniSessionCardProps> = ({
  session,
  isActive = false,
  onClick,
  onDelete,
  onRename,
  isSelectMode = false,
  isSelected = false,
  onSelectChange,
  className,
}) => {
  const status = statusConfig[session.status];
  const StatusIcon = status.icon;
  const [isEditing, setIsEditing] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [editName, setEditName] = React.useState(session.name);
  const [showActions, setShowActions] = React.useState(false);

  const formatRelativeTime = (dateString: string): string => {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setEditName(session.name);
  };

  const handleCancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(false);
    setEditName(session.name);
  };

  const handleSaveEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (editName.trim() && editName.trim() !== session.name) {
      onRename?.(editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (editName.trim() && editName.trim() !== session.name) {
        onRename?.(editName.trim());
      }
      setIsEditing(false);
    } else if (e.key === 'Escape') {
      setIsEditing(false);
      setEditName(session.name);
    }
  };

  return (
    <div
      data-testid="session-item"
      data-session-id={session.id}
      className={cn(
        'flex items-center gap-3 p-3 rounded-lg',
        'transition-all duration-200',
        isSelectMode
          ? 'cursor-pointer hover:bg-surface'
          : 'cursor-pointer hover:bg-surface',
        isActive && !isSelectMode && 'bg-primary/5 ring-1 ring-primary',
        className
      )}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => { setShowActions(false); }}
    >
      {/* Checkbox or status icon */}
      {isSelectMode ? (
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onSelectChange?.(!isSelected);
          }}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelectChange?.(e.target.checked)}
            onClick={(e) => e.stopPropagation()}
            className="accent-primary w-4 h-4"
            data-testid="session-checkbox"
          />
        </div>
      ) : (
        <div
          onClick={onClick}
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
            status.bgColor
          )}
        >
          <StatusIcon className={cn('w-4 h-4', status.color)} />
        </div>
      )}

      <div
        className="flex-1 min-w-0"
        onClick={isSelectMode
          ? () => onSelectChange?.(!isSelected)
          : onClick
        }
      >
        {isEditing ? (
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={handleKeyDown}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 px-2 py-1 text-sm border border-secondary rounded focus:outline-none focus:ring-2 focus:ring-secondary/20"
              autoFocus
            />
            <button
              onClick={handleSaveEdit}
              className="p-1 text-success hover:bg-success/10 rounded transition-colors"
              title="Save"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleCancelEdit}
              className="p-1 text-muted hover:text-text-secondary hover:bg-surface rounded transition-colors"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <p data-testid="session-name" className="text-sm font-medium text-text line-clamp-2 break-words">
              {session.name}
            </p>
            <div className="flex items-center gap-2">
              <span data-testid="session-status" className={cn('text-xs', status.color)}>
                {status.label}
              </span>
              <span className="text-xs text-muted">
                {formatRelativeTime(session.createdAt)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Action buttons - hidden in select mode, shown on hover */}
      {!isEditing && !isSelectMode && (
        <div className={cn(
          'flex items-center gap-1 transition-opacity duration-150',
          showActions ? 'opacity-100' : 'opacity-0'
        )}>
          {onRename && (
            <button
              onClick={handleStartEdit}
              className="p-1.5 text-muted hover:text-secondary hover:bg-secondary/10 rounded transition-colors"
              title="Rename session"
              data-testid="session-rename-btn"
            >
              <Edit3 className="w-4 h-4" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
              className="p-1.5 text-muted hover:text-error hover:bg-error/5 rounded transition-colors"
              title="Delete session"
              data-testid="session-delete-btn"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-border p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-text mb-2">Delete Session</h3>
            <p className="text-sm text-text-secondary mb-4">Are you sure you want to delete this session? This action cannot be undone.</p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-white border border-border rounded-lg hover:bg-surface"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowDeleteConfirm(false); onDelete?.(); }}
                className="px-4 py-2 text-sm font-medium text-white bg-error rounded-lg hover:bg-error/90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Convenience exports
export default SessionCard;
