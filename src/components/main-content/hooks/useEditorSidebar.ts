import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { AppTab, Project, ProjectSession } from '../../../types/app';
import { buildEditorResearchContext } from '../utils/editorResearchContext';
import type { DiffInfo, EditingFile, EditorSidebarMode } from '../types/types';

type UseEditorSidebarOptions = {
  activeTab: AppTab;
  selectedProject: Project | null;
  selectedSession?: ProjectSession | null;
  isMobile: boolean;
  initialWidth?: number;
};

export function useEditorSidebar({
  activeTab,
  selectedProject,
  selectedSession,
  isMobile,
  initialWidth = 600,
}: UseEditorSidebarOptions) {
  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [editorMode, setEditorMode] = useState<EditorSidebarMode>('preview');
  const [editorWidth, setEditorWidth] = useState(initialWidth);
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const resizeHandleRef = useRef<HTMLDivElement | null>(null);
  const projectRoot = selectedProject?.fullPath || selectedProject?.path || '';

  const handleFileOpen = useCallback(
    (filePath: string, diffInfo: DiffInfo | null = null) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const normalizedRoot = projectRoot.replace(/\\/g, '/').replace(/\/$/, '');
      const relativePath = normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)
        ? normalizedPath.slice(normalizedRoot.length + 1)
        : filePath;
      const fileName = normalizedPath.split('/').pop() || filePath;

      setEditingFile({
        name: fileName,
        path: relativePath,
        projectName: selectedProject?.name,
        diffInfo,
        researchContext: buildEditorResearchContext({
          activeTab,
          selectedSession,
          filePath: relativePath,
          diffInfo,
        }),
      });
      setEditorMode(isMobile ? 'edit' : 'preview');
    },
    [activeTab, isMobile, projectRoot, selectedProject?.name, selectedSession],
  );

  const handleCloseEditor = useCallback(() => {
    setEditingFile(null);
    setEditorExpanded(false);
    setEditorMode('preview');
  }, []);

  const handleToggleEditorExpand = useCallback(() => {
    setEditorExpanded((prev) => !prev);
  }, []);

  const handleStartEditing = useCallback(() => {
    setEditorMode('edit');
  }, []);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (isMobile) {
        return;
      }

      setIsResizing(true);
      event.preventDefault();
    },
    [isMobile],
  );

  useEffect(() => {
    let resizeShield: HTMLDivElement | null = null;

    const handleMouseMove = (event: globalThis.MouseEvent) => {
      if (!isResizing) {
        return;
      }

      const editorPanel = resizeHandleRef.current;
      const layoutContainer = editorPanel?.closest<HTMLElement>('[data-chat-layout-root]')
        ?? editorPanel?.parentElement;
      if (!layoutContainer) {
        return;
      }

      const containerRect = layoutContainer.getBoundingClientRect();
      const newWidth = containerRect.right - event.clientX;

      const minWidth = 300;
      const maxWidth = containerRect.width * 0.8;
      const nextWidth = Math.min(maxWidth, Math.max(minWidth, newWidth));
      setEditorWidth(nextWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      // Embedded previews such as PDF iframes own their document and otherwise
      // swallow mouse events as soon as the cursor crosses into the preview.
      resizeShield = document.createElement('div');
      resizeShield.setAttribute('aria-hidden', 'true');
      resizeShield.dataset.editorResizeShield = 'true';
      Object.assign(resizeShield.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '2147483647',
        cursor: 'col-resize',
        background: 'transparent',
      });
      document.body.appendChild(resizeShield);
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleMouseUp);
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleMouseUp);
      resizeShield?.remove();
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing]);

  return {
    editingFile,
    editorMode,
    editorWidth,
    editorExpanded,
    resizeHandleRef,
    handleFileOpen,
    handleCloseEditor,
    handleStartEditing,
    handleToggleEditorExpand,
    handleResizeStart,
  };
}
