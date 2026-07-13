'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { ChevronRight, ChevronDown, Folder, FolderOpen } from 'lucide-react';
import { fileLibraryApi } from '@/lib/api-client';
import { cn } from '@/lib/utils';

interface FolderTreeProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string, name: string) => void;
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
}) => {
  const [rootNodes, setRootNodes] = useState<TreeNode[]>([]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

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
    }).catch(() => {});
  }, []);

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
    }
  }, [expandedPaths, rootNodes]);

  const renderNode = (node: TreeNode, depth: number): React.ReactNode => {
    const isExpanded = expandedPaths.has(node.path);
    const isActive = currentPath === node.path;

    return (
      <div key={node.path}>
        <div
          className={cn(
            'flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm transition-colors',
            isActive
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-text-secondary hover:bg-surface hover:text-text',
          )}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={() => {
            onNavigate(node.path);
            toggleExpand(node);
          }}
          onContextMenu={(e) => onContextMenu(e, node.path, node.name)}
        >
          {isExpanded ? (
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
    <div className="py-1" data-testid="folder-tree">
      {/* Root link */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm transition-colors',
          currentPath === ''
            ? 'bg-primary/10 text-primary font-medium'
            : 'text-text-secondary hover:bg-surface hover:text-text',
        )}
        style={{ paddingLeft: '8px' }}
        onClick={() => onNavigate('')}
      >
        <Folder className="w-4 h-4 flex-shrink-0" />
        <span className="truncate">File Library</span>
      </div>
      {rootNodes.map(node => renderNode(node, 1))}
    </div>
  );
};

export default FolderTree;
