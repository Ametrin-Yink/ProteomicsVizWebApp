"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { getTaskStatus, cancelTasks, type TaskStatus, type TaskInfo } from "@/lib/api";

function getCurrentSessionId(): string | null {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(/\/sessions\/([^/]+)/);
  return match ? match[1] : null;
}

const STATUS_STYLE: Record<string, string> = {
  running: "bg-blue-100 text-blue-700",
  queued: "bg-yellow-100 text-yellow-700",
};

function statusLabel(task: TaskInfo): string {
  if (task.status === "running") return "Running";
  if (task.status === "queued") return `Queued #${task.queue_position || "?"}`;
  return task.status;
}

function progressPct(task: TaskInfo): number {
  if (!task.progress || task.progress.total <= 0) return 0;
  return (task.progress.completed / task.progress.total) * 100;
}

export function TaskStatusBar() {
  const [status, setStatus] = useState<TaskStatus>({ tasks: [] });
  const [expanded, setExpanded] = useState(false);
  const lastPayload = useRef("");

  const fetchStatus = useCallback(async () => {
    try {
      const sessionId = getCurrentSessionId();
      if (!sessionId) return;
      const data = await getTaskStatus(sessionId);
      const payload = JSON.stringify(data);
      if (payload !== lastPayload.current) {
        lastPayload.current = payload;
        setStatus(data);
      }
    } catch {
      // silently ignore fetch errors
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleCancel = async () => {
    try {
      const sessionId = getCurrentSessionId();
      if (!sessionId) return;
      await cancelTasks(sessionId);
      fetchStatus();
    } catch {
      // silently ignore
    }
  };

  const activeTasks = status.tasks.filter(
    (t) => t.status === "running" || t.status === "queued"
  );

  if (activeTasks.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50">
      {expanded ? (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg p-4 min-w-[320px] max-w-[420px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
              Tasks ({activeTasks.length})
            </h3>
            <button
              onClick={() => setExpanded(false)}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              ✕
            </button>
          </div>
          {activeTasks.map((task, i) => (
            <div
              key={`${task.kind}-${task.started_at}-${i}`}
              className="mb-2 last:mb-0 p-2 bg-gray-50 dark:bg-gray-700/40 rounded"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate max-w-[200px]">
                  {task.label || task.kind}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLE[task.status] || "bg-red-100 text-red-700"}`}>
                  {statusLabel(task)}
                </span>
              </div>
              {task.progress && task.status === "running" && (
                <div className="mt-1 w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 h-1.5 rounded-full transition-all"
                    style={{ width: `${progressPct(task)}%` }}
                  />
                </div>
              )}
              {task.error && (
                <p className="text-xs text-red-500 mt-1 truncate">{task.error}</p>
              )}
            </div>
          ))}
          {activeTasks.some((t) => t.status === "running") && (
            <button
              onClick={handleCancel}
              className="mt-3 w-full text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded px-3 py-1"
            >
              Cancel All
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={() => setExpanded(true)}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full shadow-lg p-3 relative hover:bg-gray-50"
        >
          <svg className="w-5 h-5 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zm0-2a8 8 0 110-16 8 8 0 010 16zm-1-5h2v2h-2v-2zm0-8h2v6h-2V7z" />
          </svg>
          <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {activeTasks.length}
          </span>
        </button>
      )}
    </div>
  );
}
