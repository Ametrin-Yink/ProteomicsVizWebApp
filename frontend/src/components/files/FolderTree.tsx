'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen, Loader2 } from 'lucide-react';
import { fileLibraryApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface FolderTreeProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, name: string) => void;
  /** Increment to force tree refresh (e.g. after folder create/delete) */
  refreshKey?: number;
}

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  loaded: boolean;
}

export const FolderTree: React.FC<FolderTreeProps> = ({
  currentPath,
  onNavigate,
  onContextMenu,
  refreshKey,
}) => {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [rootError, setRootError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [focusedPath, setFocusedPath] = useState<string>('');
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const treeRef = useRef<HTMLDivElement>(null);

  const findNodeByPath = useCallback((path: string, nodes: TreeNode[]): TreeNode | null => {
    for (const node of nodes) {
      if (node.path === path) return node;
      if (node.children.length > 0) {
        const found = findNodeByPath(path, node.children);
        if (found) return found;
      }
    }
    return null;
  }, []);

  // Load root-level folders on mount
  useEffect(() => {
    fileLibraryApi.listDirectory('').then(data => {
      const folders = data.entries
        .filter(e => e.type === 'folder')
        .map(e => ({
          name: e.name,
          path: e.path,
          children: [],
          loaded: false,
        }));
      setRootNodes(folders);
      setRootError(null);
    }).catch((err) => {
      console.error('Failed to load root folders:', err);
      setRootError('Failed to load folders');
    });
  }, [refreshKey, loadAttempt]);

  const toggleExpand = useCallback(async (node: TreeNode) => {
    const newExpanded = new Set(expandedPaths);
    if (newExpanded.has(node.path)) {
      newExpanded.delete(node.path);
      setExpandedPaths(newExpanded);
      return;
    }

    newExpanded.add(node.path);
    setExpandedPaths(newExpanded);

    // Lazy-load children
    if (!node.loaded) {
      setLoadingPaths(prev => new Set(prev).add(node.path));
      try {
        const data = await fileLibraryApi.listDirectory(node.path);
        const children = data.entries
          .filter(e => e.type === 'folder')
          .map(e => ({
            name: e.name,
            path: e.path,
            children: [],
            loaded: false,
          }));
        node.children = children;
        node.loaded = true;
        setRootNodes([...rootNodes]);
      } catch (err) {
        console.error('Failed to load children:', err);
        // Keep node collapsed so user can retry
        setExpandedPaths(prev => { const next = new Set(prev); next.delete(node.path); return next; });
      } finally {
        setLoadingPaths(prev => { const next = new Set(prev); next.delete(node.path); return next; });
      }
    }
  }, [expandedPaths, rootNodes]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const items = treeRef.current?.querySelectorAll('[role="treeitem"]');
    if (!items || items.length === 0) return;

    const currentIndex = Array.from(items).findIndex(
      item => item.getAttribute('data-path') === focusedPath
    );

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        const nextIndex = Math.min(currentIndex + 1, items.length - 1);
        const nextPath = items[nextIndex].getAttribute('data-path') || '';
        setFocusedPath(nextPath);
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        const prevIndex = Math.max(currentIndex - 1, 0);
        const prevPath = items[prevIndex].getAttribute('data-path') || '';
        setFocusedPath(prevPath);
        break;
      }
      case 'ArrowRight': {
        e.preventDefault();
        const node = findNodeByPath(focusedPath, rootNodes);
        if (node && !expandedPaths.has(focusedPath)) {
          toggleExpand(node);
        }
        break;
      }
      case 'ArrowLeft': {
        e.preventDefault();
        if (expandedPaths.has(focusedPath)) {
          const node = findNodeByPath(focusedPath, rootNodes);
          if (node) toggleExpand(node);
        } else {
          const parentPath = focusedPath.split('/').slice(0, -1).join('/');
          setFocusedPath(parentPath);
        }
        break;
      }
      case 'Enter': {
        e.preventDefault();
        onNavigate(focusedPath);
        break;
      }
    }
  }, [focusedPath, rootNodes, expandedPaths, onNavigate, toggleExpand, findNodeByPath]);

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const isActive = currentPath === node.path;

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm transition-colors min-h-[44px]',
            isActive
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-text-secondary hover:bg-surface hover:text-text',
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          role="treeitem"
          aria-expanded={isExpanded}
          aria-selected={isActive}
          aria-level={depth + 1}
          data-path={node.path}
          tabIndex={focusedPath === node.path ? 0 : -1}
          onClick={() => {
            onNavigate(node.path);
            setFocusedPath(node.path);
            toggleExpand(node);
          }}
          onContextMenu={(e) => onContextMenu(e, node.path, node.name)}
        >
          {loadingPaths.has(node.path) ? (
            <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin" />
          ) : isExpanded ? (
            <ChevronDown className="w-4 h-4 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 flex-shrink-0" />
          )}
          {isActive ? (
            <FolderOpen className="w-4 h-4 flex-shrink-0 text-primary" />
          ) : (
            <Folder className="w-4 h-4 flex-shrink-0" />
          )}
          <span className="truncate">{node.name}</span>
        </div>
        {isExpanded && node.children.map(child => renderNode(child, depth + 1))}
      </div>
    );
  };

  return (
    <div className="py-1" data-testid="folder-tree" role="tree" ref={treeRef} onKeyDown={handleKeyDown}>
      {/* Root link */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm transition-colors min-h-[44px]',
          currentPath === ''
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-text-secondary hover:bg-surface hover:text-text',
        )}
        style={{ paddingLeft: '8px' }}
        role="treeitem"
        aria-selected={currentPath === ''}
        aria-level={1}
        data-path=""
        tabIndex={focusedPath === '' ? 0 : -1}
        onClick={() => {
          onNavigate('');
          setFocusedPath('');
        }}
      >
        <Folder className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">File Library</span>
      </div>
      {rootError && (
        <div className="px-3 py-2 text-xs text-error">
          <p>{rootError}</p>
          <button onClick={() => { setRootError(null); setLoadAttempt(c => c + 1); }} className="underline">Retry</button>
        </div>
      )}
      {rootNodes.map(node => renderNode(node, 1))}
    </div>
  );
};

export default FolderTree;
