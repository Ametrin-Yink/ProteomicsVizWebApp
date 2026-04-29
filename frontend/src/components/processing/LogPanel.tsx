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
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  info: {
    icon: <Info className="w-3.5 h-3.5" />,
    color: 'text-slate-700 dark:text-slate-300',
    bgColor: 'bg-slate-50 dark:bg-slate-900/30',
    borderColor: 'border-slate-300 dark:border-slate-700',
  },
  warning: {
    icon: <AlertTriangle className="w-3.5 h-3.5" />,
    color: 'text-amber-700 dark:text-amber-400',
    bgColor: 'bg-amber-50/50 dark:bg-amber-950/20',
    borderColor: 'border-amber-300 dark:border-amber-800',
  },
  error: {
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    color: 'text-red-700 dark:text-red-400',
    bgColor: 'bg-red-50/50 dark:bg-red-950/20',
    borderColor: 'border-red-300 dark:border-red-800',
  },
};

const LogEntryItem: React.FC<{ entry: LogEntry }> = ({ entry }) => {
  const config = logLevelConfig[entry.level];

  return (
    <div
      data-testid="log-entry"
      className={cn(
        'flex items-start gap-2 px-3 py-2 text-xs border-l-2',
        config.bgColor,
        config.borderColor
      )}
    >
      <span className={cn('mt-0.5 flex-shrink-0', config.color)}>
        {config.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
          <span className="font-mono tabular-nums">
            {formatTimestamp(entry.timestamp)}
          </span>
          {entry.step && (
            <span className="px-1 py-0.5 bg-zinc-200 dark:bg-zinc-700 rounded text-zinc-600 dark:text-zinc-400">
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

  const MAX_DISPLAY_LOGS = 50;
  const hasOverflow = logs.length > MAX_DISPLAY_LOGS;
  const visibleLogs = showAll || !hasOverflow ? logs : logs.slice(-MAX_DISPLAY_LOGS);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (isAutoScroll && scrollRef.current) {
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
        'rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden',
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 dark:bg-zinc-900/50 border-b border-zinc-200 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-zinc-500" />
          <h3 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
            Activity
          </h3>
          <span className="px-2 py-0.5 bg-zinc-200 dark:bg-zinc-800 rounded-full text-xs text-zinc-600 dark:text-zinc-400">
            {logs.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleExportLogs}
            className="p-1.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors"
            title="Export logs"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-800 rounded-lg transition-colors"
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
              <div className="flex items-center justify-center h-32 text-zinc-400 text-sm">
                <div className="flex flex-col items-center gap-2">
                  <Terminal className="w-6 h-6 opacity-50" />
                  <span>No logs yet. Waiting for processing to start...</span>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
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
              className="w-full py-2 px-4 bg-zinc-50 dark:bg-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-500 dark:text-zinc-400 text-xs font-medium transition-colors"
            >
              Show all {logs.length} logs ({logs.length - MAX_DISPLAY_LOGS} hidden)
            </button>
          )}

          {/* Scroll to bottom button */}
          {!isAutoScroll && logs.length > 0 && (
            <button
              onClick={handleScrollToBottom}
              className="w-full py-2 px-4 bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-400 text-xs font-medium transition-colors flex items-center justify-center gap-1"
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
