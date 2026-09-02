export const PROJECT_FILE_MOVED_EVENT = 'project-file-moved';
export const PROJECT_FILE_DELETED_EVENT = 'project-file-deleted';

export type ProjectFileMovedDetail = {
  projectName: string;
  oldRelativePath: string;
  newRelativePath: string;
  oldAbsolutePath?: string | null;
  newAbsolutePath?: string | null;
  name: string;
};

export type ProjectFileDeletedDetail = {
  projectName: string;
  relativePath: string;
  absolutePath?: string | null;
  name: string;
};

export const dispatchProjectFileMoved = (detail: ProjectFileMovedDetail) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ProjectFileMovedDetail>(PROJECT_FILE_MOVED_EVENT, { detail }),
  );
};

export const dispatchProjectFileDeleted = (detail: ProjectFileDeletedDetail) => {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ProjectFileDeletedDetail>(PROJECT_FILE_DELETED_EVENT, { detail }),
  );
};
