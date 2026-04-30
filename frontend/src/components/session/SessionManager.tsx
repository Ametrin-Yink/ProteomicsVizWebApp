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
  Plus,
  ChevronRight,
  FlaskConical,
  Loader2,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Search,
  ListChecks,
} from 'lucide-react';
import { useSessionStore, useSessions, useCurrentSession } from '@/stores/sessionStore';
import { useUIStore } from '@/stores/uiStore';
import { sessionsApi } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';
import { MiniSessionCard } from './SessionCard';
import { SessionCreateDialog } from './SessionCreateDialog';
import type { Session, AnalysisTemplate } from '@/types/session';

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
  const { setCurrentSession, addSession, loadSessions, deleteSession, deleteSessions, updateSession } = useSessionStore();
  const { sidebar, setSidebarCollapsed } = useUIStore();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false);
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
    const interval = setInterval(loadSessions, 30_000);
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
      router.push(`/analysis?session=${session.id}`);
    } else if (session.status === 'completed') {
      router.push(`/analysis/visualization?session_id=${session.id}`);
    } else {
      // processing, error, cancelled → processing/log page
      router.push(`/analysis/processing?session_id=${session.id}`);
    }
  };

  // Handle create session
  const handleCreateSession = async (
    name: string,
    template: AnalysisTemplate
  ) => {
    try {
      // Create session via backend API
      const newSession = await sessionsApi.create(name, template);

      // Add to local store
      addSession(newSession);

      // Navigate to analysis page with session ID
      router.push(`/analysis?session=${newSession.id}`);
    } catch (error) {
      console.error('Failed to create session:', error);
      throw error;
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

  // Collapsed sidebar view
  if (sidebar.isCollapsed) {
    return (
      <>
        <div
          data-testid="session-panel"
          className={cn(
            'fixed left-0 top-0 h-full bg-background border-r border-border',
            'flex flex-col items-center py-4 z-40',
            'w-16',
            className
          )}
        >
          {/* Logo */}
          <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center mb-6">
            <FlaskConical className="w-5 h-5 text-white" />
          </div>

          {/* New session button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsCreateDialogOpen(true)}
            className="mb-4"
            title="New Analysis"
            data-testid="new-analysis-btn"
          >
            <Plus className="w-5 h-5" />
          </Button>

          {/* Recent sessions */}
          <div className="flex-1 overflow-y-auto w-full px-2 space-y-2">
            {sortedSessions.slice(0, 5).map((session) => (
              <button
                key={session.id}
                onClick={() => handleSessionClick(session)}
                className={cn(
                  'w-10 h-10 rounded-lg flex items-center justify-center',
                  'transition-colors',
                  currentSession?.id === session.id
                    ? 'bg-primary/10 text-primary'
                    : 'hover:bg-surface text-text-secondary'
                )}
                title={session.name}
              >
                <FlaskConical className="w-5 h-5" />
              </button>
            ))}
          </div>

          {/* Expand button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarCollapsed(false)}
            className="mt-auto"
          >
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        <SessionCreateDialog
          isOpen={isCreateDialogOpen}
          onClose={() => setIsCreateDialogOpen(false)}
          onCreate={handleCreateSession}
        />
      </>
    );
  }

  // Expanded sidebar view — fixed position to stay visible on scroll
  return (
    <>
      <div
        data-testid="session-panel"
        className={cn(
          'fixed left-0 top-14 bottom-0 z-30 w-80 bg-background border-r border-border',
          'flex flex-col',
          className
        )}
      >
        {/* New session button */}
        <div className="p-4 pb-1 space-y-1.5 flex-shrink-0">
          <Button
            variant="primary"
            fullWidth
            leftIcon={<Plus className="w-4 h-4" />}
            onClick={() => setIsCreateDialogOpen(true)}
            data-testid="new-analysis-btn"
          >
            New Analysis
          </Button>
        </div>

        {/* Tabs */}
        <div className="px-4 pb-2 flex-shrink-0">
          <div className="flex gap-0.5 p-0.5 bg-surface rounded-lg">
            <button
              className={cn(
                'flex-1 flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-xs font-medium rounded-md transition-colors leading-tight',
                activeTab === 'active'
                  ? 'bg-background text-primary shadow-sm'
                  : 'text-text-secondary hover:text-text'
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
                  : 'text-text-secondary hover:text-text'
              )}
              onClick={() => setActiveTab('completed')}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Completed ({groupedSessions.completed.length})
            </button>
          </div>
        </div>

        {/* Search + Controls */}
        <div className="px-4 pb-2 flex-shrink-0">
          {/* Search input */}
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search sessions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2 py-1.5 text-xs bg-surface border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary placeholder:text-text-muted"
            />
          </div>
          {/* Icon-only control buttons */}
          <div className="flex gap-1 justify-center">
            <button
              onClick={handleRefresh}
              disabled={isScanning}
              className={cn(
                'flex items-center justify-center w-8 h-8 rounded-md transition-colors',
                'text-text-secondary hover:text-text hover:bg-surface',
                isScanning && 'opacity-60 cursor-not-allowed'
              )}
              title="Refresh sessions"
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
                  : 'text-text-secondary hover:text-text hover:bg-surface'
              )}
              title={isSelectMode ? 'Exit selection mode' : 'Select sessions'}
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
            <span className="text-xs text-text-secondary">
              Select All ({filteredTabSessions.length})
            </span>
          </div>
        )}

        {/* Sessions list */}
        <div data-testid="session-list" className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {sessionsList.length === 0 ? (
            <div data-testid="no-sessions-message" className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-surface flex items-center justify-center">
                <FlaskConical className="w-8 h-8 text-muted" />
              </div>
              <p className="text-sm text-text-secondary">
                {sessionError ? 'Failed to load sessions' : 'No sessions yet'}
              </p>
              {sessionError && (
                <p className="text-xs text-error mt-1">
                  {sessionError}
                </p>
              )}
              <p className="text-xs text-muted mt-1">
                {sessionError ? 'Click Refresh Sessions to retry' : 'Create your first analysis'}
              </p>
            </div>
          ) : filteredTabSessions.length === 0 && searchQuery.trim() ? (
            <div className="text-center py-8">
              <Search className="w-8 h-8 text-text-muted mx-auto mb-3" />
              <p className="text-sm text-text-secondary">
                No sessions matching "{searchQuery}"
              </p>
            </div>
          ) : filteredTabSessions.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-text-secondary">
                No {activeTab} sessions
              </p>
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
            className="text-xs text-muted hover:text-primary transition-colors"
          >
            ProteomicsViz by Ametrin-Yink
          </a>
        </div>
      </div>

      {/* Spacer to push main content to the right of the fixed sidebar */}
      <div className="w-80 flex-shrink-0" aria-hidden="true" />

      {/* Create dialog */}
      <SessionCreateDialog
        isOpen={isCreateDialogOpen}
        onClose={() => setIsCreateDialogOpen(false)}
        onCreate={handleCreateSession}
      />
    </>
  );
};

// Convenience exports
export default SessionManager;
