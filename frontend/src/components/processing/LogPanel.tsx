/**
 * LogPanel Component
 * Displays processing logs with auto-scroll to latest
 */

import React, { useRef, useEffect, useState } from 'react';
import { LogEntry, LogLevel } from '@/types/processing';
import { formatTimestamp } from '@/lib/utils';
import { cn } from '@/lib/utils';
import {
  Info,
  AlertTriangle,
  AlertCircle,
  Circle,
  Terminal,
  ChevronDown,
  ChevronUp,
  Download
} from 'lucide-react';

interface LogPanelProps {
  logs: LogEntry[];
  className?: string;
  maxHeight?: string;
}

const logLevelConfig: Record<LogLevel, {
  icon: React.ReactNode;
  dotColor: string;
  color: string;
  bgColor: string;
}> = {
  info: {
    icon: <Info className="w-3.5 h-3.5" />,
    dotColor: 'text-text-muted',
    color: 'text-text',
    bgColor: 'bg-surface',
  },
  warning: {
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    dotColor: 'text-warning',
    color: 'text-warning',
    bgColor: 'bg-warning/5',
  },
  error: {
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    dotColor: 'text-error',
    color: 'text-error',
    bgColor: 'bg-error/5',
  },
};

const LogEntryItem: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const config = logLevelConfig[entry.level];

  return (
    <div
      data-testid="log-entry"
      className={cn(
        'flex items-start gap-2 px-3 py-2 text-xs',
        config.bgColor,
        'border-b border-border/50'
      )}
    >
      <span className={cn('mt-0.5 flex-shrink-0', config.dotColor)}>
        <Circle className="w-2 h-2 fill-current" />
      </span>
      <span className={cn('mt-0.5 flex-shrink-0', config.color)}>
        {config.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-text-secondary">
          <span className="font-mono tabular-nums">
            {formatTimestamp(entry.timestamp)}
          </span>
          {entry.step && (
            <span className="px-1 py-0.5 bg-border/30 rounded text-text-secondary">
              Step {entry.step}
            </span>
          )}
        </div>
        <p className={cn('mt-0.5 break-words', config.color)}>
          {entry.message}
        </p>
      </div>
    </div>
  );
};

export const LogPanel: React.FC<LogPanelProps> = ({
  logs,
  className,
  maxHeight = '400px',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const hasInitiallyLoaded = useRef(false);

  const MAX_DISPLAY_LOGS = 50;
  const INITIAL_VISIBLE = 10;
  const hasOverflow = logs.length > MAX_DISPLAY_LOGS;
  const visibleLogs = showAll || !hasOverflow ? logs : logs.slice(-MAX_DISPLAY_LOGS);

  // On initial bulk load, only scroll to the most recent few lines
  useEffect(() => {
    if (logs.length > 0 && !hasInitiallyLoaded.current && scrollRef.current) {
      hasInitiallyLoaded.current = true;
      // If we have more than INITIAL_VISIBLE logs, scroll to show only the newest ones
      if (logs.length > INITIAL_VISIBLE) {
        const entryEl = scrollRef.current.querySelector('[data-testid="log-entry"]');
        if (entryEl) {
          const targetIndex = Math.max(0, logs.length - INITIAL_VISIBLE);
          const entries = scrollRef.current.querySelectorAll('[data-testid="log-entry"]');
          const target = entries[targetIndex];
          if (target) {
            target.scrollIntoView({ block: 'start' });
          }
        }
      } else {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }
  }, [logs.length, logs]);

  // Auto-scroll to bottom when new logs arrive (after initial load)
  useEffect(() => {
    if (isAutoScroll && scrollRef.current && hasInitiallyLoaded.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, isAutoScroll]);

  // Handle scroll event to disable auto-scroll if user scrolls up
  const handleScroll = () => {
    if (scrollRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setIsAutoScroll(isAtBottom);
    }
  };

  const handleScrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      setIsAutoScroll(true);
    }
  };

  const handleExportLogs = () => {
    const logText = logs
      .map(
        (log) =>
          `[${formatTimestamp(log.timestamp)}] [${log.level.toUpperCase()}]${
            log.step ? ` [Step ${log.step}]` : ''
          } ${log.message}`
      )
      .join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `processing-logs-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-testid="log-panel"
      className={cn(
        'rounded-lg border border-border overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface border-b border-border">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-text-muted" />
          <h3 className="font-semibold text-sm text-text">
            Activity
          </h3>
          <span className="px-2 py-0.5 bg-border/30 rounded-full text-xs text-text-secondary">
            {logs.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleExportLogs}
            className="p-1.5 text-text-secondary hover:text-text hover:bg-border/50 rounded-lg transition-colors"
            title="Export logs"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-text-secondary hover:text-text hover:bg-border/50 rounded-lg transition-colors"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Log content */}
      {isExpanded && (
        <>
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            className="overflow-y-auto font-mono"
            style={{ maxHeight }}
          >
            {visibleLogs.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-text-muted text-sm">
                <div className="flex flex-col items-center gap-2">
                  <Terminal className="w-6 h-6 opacity-50" />
                  <span>No logs yet. Waiting for processing to start...</span>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {visibleLogs.map((log) => (
                  <LogEntryItem key={log.id} entry={log} />
                ))}
              </div>
            )}
          </div>

          {/* Hidden logs indicator */}
          {hasOverflow && !showAll && (
            <button
              onClick={() => { setShowAll(true); handleScrollToBottom(); }}
              className="w-full py-2 px-4 bg-surface hover:bg-border/30 text-text-secondary text-xs font-medium transition-colors"
            >
              Show all {logs.length} logs ({logs.length - MAX_DISPLAY_LOGS} hidden)
            </button>
          )}

          {/* Scroll to bottom button */}
          {!isAutoScroll && logs.length > 0 && (
            <button
              onClick={handleScrollToBottom}
              className="w-full py-2 px-4 bg-surface hover:bg-border/30 text-text-secondary text-xs font-medium transition-colors flex items-center justify-center gap-1"
            >
              <ChevronDown className="w-3 h-3" />
              Scroll to latest
            </button>
          )}
        </>
      )}
    </div>
  );
};

export default LogPanel;
