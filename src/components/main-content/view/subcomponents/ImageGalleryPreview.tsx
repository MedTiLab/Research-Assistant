import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CirclePlus, FolderOpen, Image as ImageIcon, Loader2, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../ui/button';
import { api } from '../../../../utils/api';
import {
  PROJECT_FILE_DELETED_EVENT,
  PROJECT_FILE_MOVED_EVENT,
} from '../../../../utils/projectFileEvents';
import {
  collectProjectImageFiles,
  isTiffImageFileName,
  type ProjectImageFile,
} from '../../../../utils/projectImageGallery';

type ImageGalleryPreviewProps = {
  projectName: string;
  projectPath?: string;
  activePath?: string;
  onSelectImage: (image: ProjectImageFile) => void;
};

function normalizePath(value?: string | null) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function GalleryThumbnail({
  image,
  projectName,
  selected,
  onSelect,
}: {
  image: ProjectImageFile;
  projectName: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t } = useTranslation('codeEditor');
  const cardRef = useRef<HTMLButtonElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const element = cardRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setShouldLoad(true);
        observer.disconnect();
      }
    }, { rootMargin: '240px' });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!shouldLoad) {
      return undefined;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoadFailed(false);

    const loadThumbnail = async () => {
      try {
        const blob = await api.getFileContentBlob(
          projectName,
          image.absolutePath || image.relativePath,
          isTiffImageFileName(image.name) ? { format: 'preview' } : undefined,
        );
        if (cancelled) {
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setImageUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setLoadFailed(true);
        }
      }
    };

    void loadThumbnail();
    return () => {
      cancelled = true;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [image.absolutePath, image.relativePath, projectName, shouldLoad]);

  return (
    <button
      ref={cardRef}
      type="button"
      onClick={onSelect}
      className={`group min-w-0 overflow-hidden rounded-xl border bg-background text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
        selected
          ? 'border-primary ring-2 ring-primary/20'
          : 'border-border/70 hover:border-primary/45'
      }`}
      title={image.relativePath}
    >
      <div className="relative aspect-square overflow-hidden bg-[linear-gradient(135deg,hsl(var(--muted)/0.55),hsl(var(--background)))]">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={image.name}
            className="h-full w-full object-contain p-1 transition-transform duration-200 group-hover:scale-[1.025]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/65">
            {loadFailed ? (
              <div className="flex flex-col items-center gap-1 px-3 text-center">
                <AlertTriangle className="h-5 w-5" />
                <span className="text-[10px]">{t('imageGallery.thumbnailFailed')}</span>
              </div>
            ) : shouldLoad ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ImageIcon className="h-6 w-6" />
            )}
          </div>
        )}
        {selected ? (
          <span className="absolute right-2 top-2 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground shadow-sm">
            {t('imageGallery.current')}
          </span>
        ) : null}
        <span
          className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-full border border-white/50 bg-slate-700/40 text-white/90 shadow-sm backdrop-blur-sm transition-all group-hover:scale-105 group-hover:bg-slate-700/55"
          title={t('imageGallery.openImage')}
        >
          <CirclePlus className="h-4 w-4" />
        </span>
      </div>
      <div className="border-t border-border/60 px-2.5 py-2">
        <div className="truncate text-xs font-medium text-foreground">{image.name}</div>
      </div>
    </button>
  );
}

export default function ImageGalleryPreview({
  projectName,
  projectPath,
  activePath,
  onSelectImage,
}: ImageGalleryPreviewProps) {
  const { t } = useTranslation('codeEditor');
  const [images, setImages] = useState<ProjectImageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const loadImages = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await api.getFiles(projectName, { signal });
      if (!response?.ok) {
        throw new Error(`HTTP ${response?.status || 'unknown'}`);
      }
      const tree = await response.json().catch(() => []);
      if (signal?.aborted) {
        return;
      }
      setImages(collectProjectImageFiles(Array.isArray(tree) ? tree : [], projectPath));
    } catch (error) {
      if (!signal?.aborted) {
        setLoadError(true);
      }
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [projectName, projectPath]);

  useEffect(() => {
    const controller = new AbortController();
    void loadImages(controller.signal);
    return () => controller.abort();
  }, [loadImages]);

  useEffect(() => {
    const handleProjectFileChange = (event: Event) => {
      const detail = (event as CustomEvent<{ projectName?: string }>).detail;
      if (detail?.projectName === projectName) {
        void loadImages();
      }
    };

    window.addEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileChange);
    window.addEventListener(PROJECT_FILE_DELETED_EVENT, handleProjectFileChange);
    return () => {
      window.removeEventListener(PROJECT_FILE_MOVED_EVENT, handleProjectFileChange);
      window.removeEventListener(PROJECT_FILE_DELETED_EVENT, handleProjectFileChange);
    };
  }, [loadImages, projectName]);

  const imageGroups = useMemo(() => {
    const groups = new Map<string, ProjectImageFile[]>();
    images.forEach((image) => {
      const current = groups.get(image.folder) || [];
      current.push(image);
      groups.set(image.folder, current);
    });
    return Array.from(groups.entries());
  }, [images]);

  const normalizedActivePath = normalizePath(activePath);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/15">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-background/75 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <ImageIcon className="h-4 w-4 text-primary" />
            {t('imageGallery.title')}
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t('imageGallery.count', { count: images.length })}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          onClick={() => void loadImages()}
          disabled={loading}
          title={t('imageGallery.refresh')}
          aria-label={t('imageGallery.refresh')}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        {loading && images.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('imageGallery.scanning')}
          </div>
        ) : loadError ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center text-muted-foreground">
            <AlertTriangle className="h-7 w-7 text-destructive/75" />
            <p className="mt-3 text-sm font-medium text-foreground">{t('imageGallery.loadFailed')}</p>
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => void loadImages()}>
              {t('imageGallery.retry')}
            </Button>
          </div>
        ) : imageGroups.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-55" />
            <p className="mt-3 text-sm font-medium text-foreground">{t('imageGallery.empty')}</p>
            <p className="mt-1 max-w-sm text-xs leading-5">{t('imageGallery.emptyHint')}</p>
          </div>
        ) : (
          <div className="space-y-5">
            {imageGroups.map(([folder, folderImages]) => (
              <section key={folder}>
                <div className="mb-2 flex items-center gap-2 px-0.5 text-[11px] text-muted-foreground">
                  <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate" title={folder}>{folder}</span>
                  <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                    {folderImages.length}
                  </span>
                </div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3">
                  {folderImages.map((image) => (
                    <GalleryThumbnail
                      key={image.relativePath}
                      image={image}
                      projectName={projectName}
                      selected={normalizePath(image.relativePath) === normalizedActivePath}
                      onSelect={() => onSelectImage(image)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
