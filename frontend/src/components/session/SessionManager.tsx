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
  FolderOpen,
  History,
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
  const { setCurrentSession, addSession, loadSessions, deleteSession, updateSession } = useSessionStore();
  const { sidebar, setSidebarCollapsed } = useUIStore();

  const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'all' | 'recent'>('all');
  const [, setIsLoading] = React.useState(false);

  // Load sessions from backend on mount
  React.useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Sort sessions by creation time (newest first)
  const sortedSessions = React.useMemo(() => {
    return [...sessionsList].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      return dateB - dateA; // Descending order (newest first)
    });
  }, [sessionsList]);

  // Filter sessions based on active tab
  const filteredSessions = React.useMemo(() => {
    if (!Array.isArray(sortedSessions)) return [];
    if (activeTab === 'recent') {
      return sortedSessions.slice(0, 5);
    }
    return sortedSessions;
  }, [sortedSessions, activeTab]);

  // Group sessions by status
  const groupedSessions = React.useMemo(() => {
    if (!Array.isArray(filteredSessions)) {
      return { active: [], completed: [], other: [] };
    }
    const active = filteredSessions.filter((s) =>
      ['created', 'uploading', 'uploaded', 'processing'].includes(s.status)
    );
    const completed = filteredSessions.filter((s) => s.status === 'completed');
    const other = filteredSessions.filter((s) =>
      ['error', 'cancelled'].includes(s.status)
    );
    return { active, completed, other };
  }, [filteredSessions]);

  // Handle session click
  const handleSessionClick = (session: Session) => {
    setCurrentSession(session);
    
    // Navigate based on session status, always include session ID
    if (session.status === 'created' || session.status === 'uploading') {
      router.push(`/analysis?session=${session.id}`);
    } else if (session.status === 'completed') {
      router.push(`/analysis/visualization?session_id=${session.id}`);
    } else {
      router.push(`/analysis?session=${session.id}`);
    }
  };

  // Handle create session
  const handleCreateSession = async (
    name: string,
    description: string,
    template: AnalysisTemplate
  ) => {
    setIsLoading(true);

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
    } finally {
      setIsLoading(false);
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

  // Collapsed sidebar view
  if (sidebar.isCollapsed) {
    return (
      <>
        <div
          data-testid="session-panel"
          className={cn(
            'fixed left-0 top-0 h-full bg-white border-r border-[#e2e8f0]',
            'flex flex-col items-center py-4 z-40',
            'w-16',
            className
          )}
        >
          {/* Logo */}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#E73564] to-[#00ADEF] flex items-center justify-center mb-6">
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
                    ? 'bg-[#E73564]/10 text-[#E73564]'
                    : 'hover:bg-[#f8f9fc] text-[#64748b]'
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

  // Expanded sidebar view
  return (
    <>
      <div
        data-testid="session-panel"
        className={cn(
          'relative h-full bg-white border-r border-[#e2e8f0]',
          'flex flex-col',
          'w-80',
          className
        )}
      >
        {/* New session button */}
        <div className="p-4">
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
        <div className="px-4 pb-2">
          <div className="flex gap-1 p-1 bg-[#f8f9fc] rounded-lg">
            <button
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                activeTab === 'all'
                  ? 'bg-white text-[#E73564] shadow-sm'
                  : 'text-[#64748b] hover:text-[#1a1a2e]'
              )}
              onClick={() => setActiveTab('all')}
            >
              <FolderOpen className="w-4 h-4" />
              All ({sessionsList.length})
            </button>
            <button
              className={cn(
                'flex-1 flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors',
                activeTab === 'recent'
                  ? 'bg-white text-[#E73564] shadow-sm'
                  : 'text-[#64748b] hover:text-[#1a1a2e]'
              )}
              onClick={() => setActiveTab('recent')}
            >
              <History className="w-4 h-4" />
              Recent
            </button>
          </div>
        </div>

        {/* Sessions list */}
        <div data-testid="session-list" className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
          {sessionsList.length === 0 ? (
            <div data-testid="no-sessions-message" className="text-center py-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#f8f9fc] flex items-center justify-center">
                <FlaskConical className="w-8 h-8 text-[#94a3b8]" />
              </div>
              <p className="text-sm text-[#64748b]">
                {sessionError ? 'Failed to load sessions' : 'No sessions yet'}
              </p>
              {sessionError && (
                <p className="text-xs text-red-500 mt-1">
                  {sessionError}
                </p>
              )}
              <p className="text-xs text-[#94a3b8] mt-1">
                {sessionError ? 'Try refreshing the page' : 'Create your first analysis'}
              </p>
            </div>
          ) : (
            <>
              {/* Active sessions */}
              {groupedSessions.active.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                    Active
                  </h3>
                  <div className="space-y-2">
                    {groupedSessions.active.map((session) => (
                      <MiniSessionCard
                        key={session.id}
                        session={session}
                        isActive={currentSession?.id === session.id}
                        onClick={() => handleSessionClick(session)}
                        onDelete={() => handleDeleteSession(session.id)}
                        onRename={(newName) => handleRenameSession(session.id, newName)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Completed sessions */}
              {groupedSessions.completed.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    Completed
                  </h3>
                  <div className="space-y-2">
                    {groupedSessions.completed.map((session) => (
                      <MiniSessionCard
                        key={session.id}
                        session={session}
                        isActive={currentSession?.id === session.id}
                        onClick={() => handleSessionClick(session)}
                        onDelete={() => handleDeleteSession(session.id)}
                        onRename={(newName) => handleRenameSession(session.id, newName)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Other sessions */}
              {groupedSessions.other.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gray-500"></span>
                    Other
                  </h3>
                  <div className="space-y-2">
                    {groupedSessions.other.map((session) => (
                      <MiniSessionCard
                        key={session.id}
                        session={session}
                        isActive={currentSession?.id === session.id}
                        onClick={() => handleSessionClick(session)}
                        onDelete={() => handleDeleteSession(session.id)}
                        onRename={(newName) => handleRenameSession(session.id, newName)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer - Settings removed for now */}
        <div className="p-4 border-t border-[#e2e8f0] text-center text-xs text-[#94a3b8]">
          ProteomicsViz Analysis Platform
        </div>
      </div>

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
