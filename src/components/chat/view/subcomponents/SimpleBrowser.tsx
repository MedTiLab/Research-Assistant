import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Home,
  Loader2,
  RefreshCw,
  Search,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../../../lib/utils';
import { getDesktopRuntimeInfo } from '../../../../utils/desktopRuntime';
import {
  SIMPLE_BROWSER_HOME_URL,
  SIMPLE_BROWSER_LAST_URL_STORAGE_KEY,
  SIMPLE_BROWSER_NAVIGATE_EVENT,
  isSafeBrowserUrl,
  normalizeBrowserAddress,
} from '../../utils/simpleBrowser';

interface BrowserWebviewElement extends HTMLElement {
  src: string;
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
  loadURL: (url: string) => Promise<void>;
  reload: () => void;
  executeJavaScript: (code: string) => Promise<unknown>;
}

type WebviewNavigationEvent = Event & { url?: string; isMainFrame?: boolean; errorCode?: number };

function readInitialUrl() {
  if (typeof window === 'undefined') {
    return SIMPLE_BROWSER_HOME_URL;
  }

  const storedUrl = window.localStorage.getItem(SIMPLE_BROWSER_LAST_URL_STORAGE_KEY) || '';
  return isSafeBrowserUrl(storedUrl) ? storedUrl : SIMPLE_BROWSER_HOME_URL;
}

export default function SimpleBrowser() {
  const { t } = useTranslation('chat');
  const isDesktop = getDesktopRuntimeInfo().isDesktopShell;
  const initialUrl = useMemo(readInitialUrl, []);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [address, setAddress] = useState(initialUrl);
  const [isLoading, setIsLoading] = useState(true);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const webviewRef = useRef<BrowserWebviewElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const webHistoryRef = useRef([initialUrl]);
  const webHistoryIndexRef = useRef(0);

  const persistUrl = useCallback((url: string) => {
    if (!isSafeBrowserUrl(url)) {
      return;
    }
    setCurrentUrl(url);
    setAddress(url);
    window.localStorage.setItem(SIMPLE_BROWSER_LAST_URL_STORAGE_KEY, url);
  }, []);

  const updateDesktopNavigationState = useCallback(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    try {
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    } catch {
      setCanGoBack(false);
      setCanGoForward(false);
    }
  }, []);

  useEffect(() => {
    if (!isDesktop) {
      return undefined;
    }

    const webview = webviewRef.current;
    if (!webview) {
      return undefined;
    }

    const handleStartLoading = () => {
      setIsLoading(true);
      setLoadError(null);
    };
    const handleStopLoading = () => {
      setIsLoading(false);
      updateDesktopNavigationState();
    };
    const handleNavigation = (event: Event) => {
      const nextUrl = (event as WebviewNavigationEvent).url;
      if (nextUrl) {
        persistUrl(nextUrl);
      }
      updateDesktopNavigationState();
    };
    const handleLoadFailure = (event: Event) => {
      const failure = event as WebviewNavigationEvent;
      if (failure.errorCode === -3 || failure.isMainFrame === false) {
        return;
      }
      setIsLoading(false);
      setLoadError(t('sessionContext.browser.loadError'));
    };
    const handleDomReady = () => {
      void webview.executeJavaScript(`
        (() => {
          if (window.__medhelpSameViewLinksInstalled) return;
          window.__medhelpSameViewLinksInstalled = true;
          document.addEventListener('click', (event) => {
            const element = event.target instanceof Element ? event.target : null;
            const link = element?.closest('a[href][target="_blank"]');
            if (!link || event.defaultPrevented) return;
            const href = link.href;
            if (!/^https?:/i.test(href)) return;
            event.preventDefault();
            window.location.assign(href);
          }, true);
        })();
      `).catch(() => undefined);
    };

    webview.addEventListener('did-start-loading', handleStartLoading);
    webview.addEventListener('did-stop-loading', handleStopLoading);
    webview.addEventListener('did-navigate', handleNavigation);
    webview.addEventListener('did-navigate-in-page', handleNavigation);
    webview.addEventListener('did-fail-load', handleLoadFailure);
    webview.addEventListener('dom-ready', handleDomReady);

    return () => {
      webview.removeEventListener('did-start-loading', handleStartLoading);
      webview.removeEventListener('did-stop-loading', handleStopLoading);
      webview.removeEventListener('did-navigate', handleNavigation);
      webview.removeEventListener('did-navigate-in-page', handleNavigation);
      webview.removeEventListener('did-fail-load', handleLoadFailure);
      webview.removeEventListener('dom-ready', handleDomReady);
    };
  }, [isDesktop, persistUrl, t, updateDesktopNavigationState]);

  const navigate = useCallback((rawAddress: string, options?: { recordWebHistory?: boolean }) => {
    const nextUrl = normalizeBrowserAddress(rawAddress);
    setAddress(nextUrl);
    setCurrentUrl(nextUrl);
    setLoadError(null);
    setIsLoading(true);
    window.localStorage.setItem(SIMPLE_BROWSER_LAST_URL_STORAGE_KEY, nextUrl);

    if (isDesktop) {
      void webviewRef.current?.loadURL(nextUrl).catch(() => {
        setIsLoading(false);
        setLoadError(t('sessionContext.browser.loadError'));
      });
      return;
    }

    if (options?.recordWebHistory === false) {
      return;
    }
    const nextHistory = webHistoryRef.current.slice(0, webHistoryIndexRef.current + 1);
    nextHistory.push(nextUrl);
    webHistoryRef.current = nextHistory;
    webHistoryIndexRef.current = nextHistory.length - 1;
    setCanGoBack(webHistoryIndexRef.current > 0);
    setCanGoForward(false);
  }, [isDesktop, t]);

  useEffect(() => {
    const handleRequestedNavigation = (event: Event) => {
      const url = (event as CustomEvent<{ url?: unknown }>).detail?.url;
      if (typeof url === 'string' && isSafeBrowserUrl(url)) {
        navigate(url);
      }
    };

    window.addEventListener(SIMPLE_BROWSER_NAVIGATE_EVENT, handleRequestedNavigation);
    return () => window.removeEventListener(SIMPLE_BROWSER_NAVIGATE_EVENT, handleRequestedNavigation);
  }, [navigate]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate(address);
  };

  const handleBack = () => {
    if (isDesktop) {
      webviewRef.current?.goBack();
      return;
    }
    if (webHistoryIndexRef.current <= 0) {
      return;
    }
    webHistoryIndexRef.current -= 1;
    const nextUrl = webHistoryRef.current[webHistoryIndexRef.current];
    setCanGoBack(webHistoryIndexRef.current > 0);
    setCanGoForward(true);
    navigate(nextUrl, { recordWebHistory: false });
  };

  const handleForward = () => {
    if (isDesktop) {
      webviewRef.current?.goForward();
      return;
    }
    if (webHistoryIndexRef.current >= webHistoryRef.current.length - 1) {
      return;
    }
    webHistoryIndexRef.current += 1;
    const nextUrl = webHistoryRef.current[webHistoryIndexRef.current];
    setCanGoBack(true);
    setCanGoForward(webHistoryIndexRef.current < webHistoryRef.current.length - 1);
    navigate(nextUrl, { recordWebHistory: false });
  };

  const handleReload = () => {
    setLoadError(null);
    setIsLoading(true);
    if (isDesktop) {
      webviewRef.current?.reload();
      return;
    }
    const iframe = iframeRef.current;
    if (iframe) {
      iframe.src = currentUrl;
    }
  };

  const iconButtonClass = 'inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35';
  const webviewAttributes = {
    partition: 'persist:medhelp-simple-browser',
    webpreferences: 'contextIsolation=yes,nodeIntegration=no,sandbox=yes',
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <form onSubmit={handleSubmit} className="flex flex-shrink-0 items-center gap-1 border-b border-border/60 bg-card/80 px-2 py-2">
        <button type="button" onClick={handleBack} disabled={!canGoBack} className={iconButtonClass} title={t('sessionContext.browser.back')}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button type="button" onClick={handleForward} disabled={!canGoForward} className={iconButtonClass} title={t('sessionContext.browser.forward')}>
          <ArrowRight className="h-4 w-4" />
        </button>
        <button type="button" onClick={handleReload} className={iconButtonClass} title={t('sessionContext.browser.reload')}>
          <RefreshCw className={cn('h-3.5 w-3.5', isLoading && 'animate-spin')} />
        </button>
        <button type="button" onClick={() => navigate(SIMPLE_BROWSER_HOME_URL)} className={iconButtonClass} title={t('sessionContext.browser.home')}>
          <Home className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center rounded-lg border border-border/70 bg-background px-2 shadow-sm focus-within:border-primary/45 focus-within:ring-2 focus-within:ring-primary/10">
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            className="h-8 min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            placeholder={t('sessionContext.browser.placeholder')}
            aria-label={t('sessionContext.browser.addressLabel')}
            spellCheck={false}
          />
          <button type="submit" className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" title={t('sessionContext.browser.go')}>
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}
          className={iconButtonClass}
          title={t('sessionContext.browser.openExternal')}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      </form>

      <div className="relative min-h-0 flex-1 bg-white">
        {isLoading && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 h-0.5 overflow-hidden bg-primary/15">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        )}
        {loadError && (
          <div className="absolute inset-x-3 top-3 z-20 flex items-center gap-2 rounded-lg border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-lg backdrop-blur">
            <span className="min-w-0 flex-1">{loadError}</span>
            <button type="button" onClick={handleReload} className="rounded-md border border-border px-2 py-1 text-foreground hover:bg-accent">
              {t('sessionContext.browser.tryAgain')}
            </button>
          </div>
        )}

        {isDesktop ? (
          <webview
            ref={(element) => {
              webviewRef.current = element as unknown as BrowserWebviewElement | null;
            }}
            src={initialUrl}
            className="h-full w-full"
            {...webviewAttributes}
          />
        ) : (
          <iframe
            ref={iframeRef}
            src={currentUrl}
            title={t('sessionContext.browser.title')}
            className="h-full w-full border-0"
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
            referrerPolicy="no-referrer"
            onLoad={() => setIsLoading(false)}
          />
        )}

        {!isDesktop && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-background/95 to-transparent px-3 pb-2 pt-6 text-center text-[10px] text-muted-foreground">
            {t('sessionContext.browser.embedNotice')}
          </div>
        )}
        {isLoading && !currentUrl && (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
