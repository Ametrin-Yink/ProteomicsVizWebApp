/**
 * Session Manager Component
 *
 * Sidebar component for managing sessions.
 * Displays list of sessions and provides session actions.
 */

'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  ChevronRight,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Search,
  ListChecks,
  FileText,
  Clock,
  AlertCircle,
  Edit3,
  X,
  Check,
} from 'lucide-react';
import { MassSpecIcon } from '@/components/ui/MassSpecIcon';
import { useSessionStore, useSessions, useCurrentSession } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/ui-store';
import { useSidebar } from '@/components/layout/SidebarContext';
import { sessionsApi } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import type { Session } from '@/types/session';

// Session manager props
export interface SessionManagerProps {
  className?: string;
}

/**
 * Session Manager component
 */
export const SessionManager: React.FC<SessionManagerProps> = ({ className }) => {
  const router = useRouter();
  const sessions = useSessions();
  const sessionsList = React.useMemo(() => sessions || [], [sessions]);
  const currentSession = useCurrentSession();
  const sessionError = useSessionStore((state) => state.error);
  const { setCurrentSession, loadSessions, deleteSession, deleteSessions, updateSession } = useSessionStore();
  const { sidebar, setSidebarCollapsed } = useUIStore();
  const { isExpanded: sidebarExpanded, toggleSidebar } = useSidebar();

  const [activeTab, setActiveTab] = React.useState<'active' | 'completed'>('active');
  const [isScanning, setIsScanning] = React.useState(false);
  const [isSelectMode, setIsSelectMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = React.useState('');
  // Sync active tab to the current session's status
  React.useEffect(() => {
    if (!currentSession) return;
    if (currentSession.status === 'completed') {
      setActiveTab('completed');
    } else {
      setActiveTab('active');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession?.id, currentSession?.status]);

  // Load sessions on mount + poll every 30 seconds
  React.useEffect(() => {
    loadSessions();
    const interval = setInterval(loadSessions, 15_000);
    return () => clearInterval(interval);
  }, [loadSessions]);

  // Sort sessions by creation time (newest first)
  const sortedSessions = React.useMemo(() => {
    return [...sessionsList].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA; // Descending order (newest first)
    });
  }, [sessionsList]);

  // Group sessions by status category
  const groupedSessions = React.useMemo(() => {
    if (!Array.isArray(sortedSessions)) {
      return { active: [], completed: [] };
    }
    const active = sortedSessions.filter((s) =>
      ['created', 'uploading', 'uploaded', 'processing', 'queued', 'error', 'cancelled'].includes(s.status)
    );
    const completed = sortedSessions.filter((s) => s.status === 'completed');
    return { active, completed };
  }, [sortedSessions]);

  // Get sessions for the active tab
  const tabSessions = React.useMemo(() => {
    if (activeTab === 'active') return groupedSessions.active;
    return groupedSessions.completed;
  }, [activeTab, groupedSessions]);

  // Filter sessions by search query
  const filteredTabSessions = React.useMemo(() => {
    if (!searchQuery.trim()) return tabSessions;
    const query = searchQuery.toLowerCase();
    return tabSessions.filter((s) => s.name.toLowerCase().includes(query));
  }, [tabSessions, searchQuery]);

  // Handle session click
  const handleSessionClick = (session: Session) => {
    setCurrentSession(session);

    // Navigate based on session status
    if (session.status === 'created' || session.status === 'uploading' || session.status === 'uploaded') {
      // Resume in the new wizard flow
      router.push(`/new/upload?session=${session.id}`);
    } else if (session.status === 'completed') {
      router.push(`/analysis/visualization?session_id=${session.id}`);
    } else {
      // processing, error, cancelled → processing/log page
      router.push(`/analysis/processing?session_id=${session.id}`);
    }
  };

  // Handle delete session
  const handleDeleteSession = async (sessionId: string) => {
    try {
      // Delete from backend
      await sessionsApi.delete(sessionId);
      // Delete from local store
      deleteSession(sessionId);
      // Show success toast
      const { addToast } = useUIStore.getState();
      addToast('success', 'Session deleted successfully');
    } catch (error) {
      console.error('Failed to delete session:', error);
      // Show error toast
      const { addToast } = useUIStore.getState();
      addToast('error', error instanceof Error ? error.message : 'Failed to delete session');
    }
  };

  // Handle rename session
  const handleRenameSession = async (sessionId: string, newName: string) => {
    try {
      // Rename on backend
      await sessionsApi.rename(sessionId, newName);
      // Update local store
      updateSession(sessionId, { name: newName });
      // Show success toast
      const { addToast } = useUIStore.getState();
      addToast('success', 'Session renamed successfully');
    } catch (error) {
      console.error('Failed to rename session:', error);
      // Show error toast
      const { addToast } = useUIStore.getState();
      addToast('error', error instanceof Error ? error.message : 'Failed to rename session');
    }
  };

  // Handle refresh sessions
  const handleRefresh = async () => {
    setIsScanning(true);
    try {
      await loadSessions();
    } finally {
      setIsScanning(false);
    }
  };

  // Toggle select mode
  const toggleSelectMode = () => {
    setIsSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  };

  // Toggle single session selection
  const toggleSelect = (sessionId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(sessionId);
      } else {
        next.delete(sessionId);
      }
      return next;
    });
  };

  // Select all sessions in current tab (filtered)
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredTabSessions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredTabSessions.map((s) => s.id)));
    }
  };

  // Handle delete selected sessions
  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    const idsToDelete = Array.from(selectedIds);

    try {
      await sessionsApi.deleteMultiple(idsToDelete);
      deleteSessions(idsToDelete);
      setSelectedIds(new Set());
      setIsSelectMode(false);
      const { addToast } = useUIStore.getState();
      addToast('success', `${count} session${count > 1 ? 's' : ''} deleted`);
    } catch (error) {
      const { addToast } = useUIStore.getState();
      addToast('error', error instanceof Error ? error.message : 'Failed to delete sessions');
    }
  };

  // Responsive sidebar: collapsed (w-16) when !sidebarExpanded, expanded (w-80) when sidebarExpanded
  return (
    <>
      <div
        data-testid="session-panel"
        className={cn(
          'fixed left-0 top-14 bottom-0 z-30 bg-background border-r border-border',
          'flex flex-col transition-all duration-200',
          'overflow-hidden',
          sidebarExpanded ? 'w-80' : 'w-16',
          className
        )}
      >
        {sidebarExpanded ? (
          <>
            {/* Expanded content */}
            {/* Tabs */}
            <div className="px-4 pb-2 flex-shrink-0">
              <div className="flex gap-0.5 p-0.5 bg-surface rounded-lg">
                <button
                  className={cn(
                    'flex-1 flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs font-medium rounded-md transition-colors leading-tight',
                    activeTab === 'active'
                      ? 'bg-background text-primary shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  )}
                  onClick={() => setActiveTab('active')}
                >
                  <Loader2 className="w-3.5 h-3.5" />
                  Active ({groupedSessions.active.length})
                </button>
                <button
                  className={cn(
                    'flex-1 flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs font-medium rounded-md transition-colors leading-tight',
                    activeTab === 'completed'
                      ? 'bg-background text-primary shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  )}
                  onClick={() => setActiveTab('completed')}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Completed ({groupedSessions.completed.length})
                </button>
              </div>
            </div>

            {/* Search + Controls in one row */}
            <div className="px-4 pb-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search sessions..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-2 py-1.5 text-xs bg-surface border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-text-muted"
                  />
                </div>
                <button
                  onClick={handleRefresh}
                  disabled={isScanning}
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
                    'text-text-secondary hover:text-text-primary hover:bg-surface',
                    isScanning && 'opacity-60 cursor-not-allowed'
                  )}
                  title="Refresh sessions"
                  aria-label="Refresh sessions"
                  data-testid="refresh-sessions-btn"
                >
                  <RefreshCw className={cn('w-4 h-4', isScanning && 'animate-spin')} />
                </button>
                <button
                  onClick={toggleSelectMode}
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
                    isSelectMode
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-secondary hover:text-text-primary hover:bg-surface'
                  )}
                  title={isSelectMode ? 'Exit selection mode' : 'Select sessions'}
                  aria-label={isSelectMode ? 'Exit selection mode' : 'Select sessions'}
                  data-testid="select-mode-btn"
                >
                  <ListChecks className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Select All bar */}
            {isSelectMode && filteredTabSessions.length > 0 && (
              <div className="px-4 pb-2 flex items-center gap-2 flex-shrink-0">
                <input
                  type="checkbox"
                  checked={selectedIds.size === filteredTabSessions.length && filteredTabSessions.length > 0}
                  onChange={toggleSelectAll}
                  className="accent-primary w-4 h-4"
                  data-testid="select-all-checkbox"
                />
                <span className="text-xs text-text-secondary">Select All ({filteredTabSessions.length})</span>
              </div>
            )}

            {/* Sessions list */}
            <div data-testid="session-list" className="flex-1 overflow-y-auto px-4 pt-1 pb-4 space-y-1">
              {sessionsList.length === 0 ? (
                <div data-testid="no-sessions-message" className="text-center py-8">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface flex items-center justify-center">
                    <MassSpecIcon className="w-8 h-8 text-text-muted" />
                  </div>
                  <p className="text-sm text-text-secondary">
                    {sessionError ? 'Failed to load sessions' : 'No sessions yet'}
                  </p>
                  {sessionError && (<p className="text-xs text-error mt-1">{sessionError}</p>)}
                  <p className="text-xs text-text-muted mt-1">
                    {sessionError ? 'Click Refresh to retry' : 'Create your first analysis'}
                  </p>
                </div>
              ) : filteredTabSessions.length === 0 && searchQuery.trim() ? (
                <div className="text-center py-8">
                  <Search className="w-8 h-8 text-text-muted mx-auto mb-3" />
                  <p className="text-sm text-text-secondary">No sessions matching &ldquo;{searchQuery}&rdquo;</p>
                </div>
              ) : filteredTabSessions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-text-secondary">No {activeTab} sessions</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredTabSessions.map((session) => (
                    <MiniSessionCard
                      key={session.id}
                      session={session}
                      isActive={currentSession?.id === session.id}
                      isSelectMode={isSelectMode}
                      isSelected={selectedIds.has(session.id)}
                      onSelectChange={(checked) => toggleSelect(session.id, checked)}
                      onClick={() => !isSelectMode && handleSessionClick(session)}
                      onDelete={() => !isSelectMode && handleDeleteSession(session.id)}
                      onRename={(newName) => !isSelectMode && handleRenameSession(session.id, newName)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Bulk delete bar */}
            {isSelectMode && selectedIds.size > 0 && (
              <div className="p-4 border-t border-border bg-error/5 flex-shrink-0">
                <Button
                  variant="primary"
                  fullWidth
                  leftIcon={<Trash2 className="w-4 h-4" />}
                  onClick={handleDeleteSelected}
                  className="!bg-error hover:!bg-error/90"
                  data-testid="delete-selected-btn"
                >
                  Delete Selected ({selectedIds.size})
                </Button>
              </div>
            )}

            {/* Footer */}
            <div className="p-3 border-t border-border text-center flex-shrink-0">
              <a
                href="https://github.com/Ametrin-Yink"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-text-muted hover:text-primary transition-colors"
              >
                ProteomicsViz by Ametrin-Yink
              </a>
            </div>
          </>
        ) : (
          <>
            {/* Collapsed content — icon-only */}
            {/* Logo */}
            <div className="flex flex-col items-center pt-4 pb-2">
              <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-2">
                <MassSpecIcon className="w-5 h-5 text-white" />
              </div>
            </div>

            {/* Recent sessions */}
            <div className="flex-1 overflow-y-auto w-full px-2 space-y-2">
              {sortedSessions.slice(0, 5).map((session) => (
                <button
                  key={session.id}
                  onClick={() => handleSessionClick(session)}
                  className={cn(
                    'w-10 h-10 rounded-lg flex items-center justify-center mx-auto',
                    'transition-colors',
                    currentSession?.id === session.id
                      ? 'bg-primary/10 text-primary'
                      : 'hover:bg-surface text-text-secondary'
                  )}
                  title={session.name}
                >
                  <MassSpecIcon className="w-5 h-5" />
                </button>
              ))}
            </div>

            {/* Refresh button */}
            <div className="flex flex-col items-center py-2">
              <button
                onClick={handleRefresh}
                disabled={isScanning}
                className={cn(
                  'flex items-center justify-center w-10 h-10 rounded-lg transition-colors',
                  'text-text-secondary hover:bg-surface',
                  isScanning && 'opacity-60 cursor-not-allowed'
                )}
                title="Refresh sessions"
                aria-label="Refresh sessions"
              >
                <RefreshCw className={cn('w-4 h-4', isScanning && 'animate-spin')} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Spacer to push main content to the right */}
      <div className={sidebarExpanded ? 'w-80 flex-shrink-0' : 'w-16 flex-shrink-0'} aria-hidden="true" />
    </>
  );
};

// Convenience exports
export default SessionManager;

// ===================== Status Configuration =====================

const statusConfig: Record<Session['status'], {
  icon: typeof MassSpecIcon;
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

// ===================== Mini Session Card =====================

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
        'group relative flex items-center gap-3 p-3 rounded-lg',
        'transition-all duration-200',
        isSelectMode
          ? 'cursor-pointer hover:bg-surface'
          : 'cursor-pointer hover:bg-surface',
        isActive && !isSelectMode && 'bg-primary/5 ring-1 ring-primary',
        className
      )}
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
              className="p-1 text-text-muted hover:text-text-secondary hover:bg-surface rounded transition-colors"
              title="Cancel"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <>
            <p data-testid="session-name" className="text-sm font-medium text-text-primary line-clamp-2 break-words">
              {session.name}
            </p>
            <div className="flex items-center gap-2">
              <span data-testid="session-status" className={cn('text-xs', status.color)}>
                {status.label}
              </span>
              <span className="text-xs text-text-muted">
                {formatRelativeTime(session.createdAt)}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Action buttons - overlay on hover, no reserved space */}
      {!isEditing && !isSelectMode && (
        <div className={cn(
          'absolute right-2 bottom-1.5 flex items-center gap-1',
          'opacity-0 group-hover:opacity-100 transition-opacity duration-150',
          'bg-background/80 backdrop-blur-sm rounded-md px-1 py-0.5',
        )}>
          {onRename && (
            <button
              onClick={handleStartEdit}
              className="p-1.5 text-text-muted hover:text-secondary hover:bg-secondary/10 rounded transition-colors"
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
              className="p-1.5 text-text-muted hover:text-error hover:bg-error/5 rounded transition-colors"
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
          <div className="bg-background rounded-xl border border-border p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-text-primary mb-2">Delete Session</h3>
            <p className="text-sm text-text-secondary mb-4">Are you sure you want to delete this session? This action cannot be undone.</p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary bg-background border border-border rounded-lg hover:bg-surface"
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
