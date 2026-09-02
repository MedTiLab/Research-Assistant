import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FileCheck2,
  Github,
  Globe2,
  Laptop,
  Loader2,
  MonitorDown,
  ShieldCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

type DownloadArtifact = {
  name: string;
  url: string;
  bytes: number;
  sha256: string | null;
  sha256Url: string | null;
  product: string;
  platform: 'windows' | 'macos' | 'linux' | 'other';
  architecture: string | null;
  version: string | null;
};

type DownloadCatalog = {
  medhelp: DownloadArtifact | null;
  medhelpDesktop: DownloadArtifact[];
  ccSwitch: DownloadArtifact[];
};

const MEDHELP_FALLBACK: DownloadArtifact = {
  name: 'MedHelp-Offline-1.1.19-win-x64.exe',
  url: '/api/public-downloads/object/downloads/MedHelp-Offline-1.1.19-win-x64.exe',
  bytes: 435078525,
  sha256: '8cfccbf251f3c48dfa44668ebed5f68e48a5e186966e108d6c78a8f358f78085',
  sha256Url: '/api/public-downloads/object/downloads/MedHelp-Offline-1.1.19-win-x64.exe.sha256',
  product: 'MedHelp Offline',
  platform: 'windows',
  architecture: 'x64',
  version: '1.1.19',
};

const MEDHELP_MAC_FALLBACK: DownloadArtifact = {
  name: 'MedHelp-Offline-1.1.19-mac-arm64.dmg',
  url: '/api/public-downloads/object/downloads/MedHelp-Offline-1.1.19-mac-arm64.dmg',
  bytes: 439891490,
  sha256: '8309c733fe237749b2325b1dffbb36c4a7b353b35c3325ea583552561b373227',
  sha256Url: '/api/public-downloads/object/downloads/MedHelp-Offline-1.1.19-mac-arm64.dmg.sha256',
  product: 'MedHelp Offline',
  platform: 'macos',
  architecture: 'arm64',
  version: '1.1.19',
};

const copy = {
  zh: {
    back: '返回接入方式',
    eyebrow: 'MedHelp 桌面应用',
    title: '下载 MedHelp 桌面 App',
    subtitle: '登录成功。请选择当前电脑对应的安装包；桌面 App 已内置本地引擎，安装后可直接进入工作台。',
    current: '当前版本',
    recommended: 'Windows 推荐',
    download: '下载安装包',
    checksum: 'SHA-256 校验文件',
    verified: '官方直链 · 登录后下载',
    requirements: 'Windows 10/11 · 64 位',
    macRecommended: 'macOS 推荐',
    macRequirements: 'macOS · Apple Silicon（M 系列）',
    macInstallTitle: 'macOS 安装提示',
    macInstallBody: '下载后打开 DMG，并将 MedHelp 拖入“应用程序”。若系统提示应用已损坏或无法验证，请打开“终端”运行：',
    copyCommand: '复制命令',
    ccTitle: 'CC Switch 下载',
    ccSubtitle: '从服务器上的 CC Switch 发布目录自动列出可用版本。',
    ccRepository: '查看 CC Switch GitHub Releases',
    loading: '正在读取可用版本…',
    empty: '暂时没有检测到 CC Switch 安装包。',
    loadFailed: 'CC Switch 版本列表暂时无法读取，请稍后刷新页面。',
    direct: '直接下载',
    footer: '下载文件由 app.medtimehelp.com 直接提供。',
  },
  en: {
    back: 'Back to setup options',
    eyebrow: 'MedHelp Desktop App',
    title: 'Download the MedHelp Desktop App',
    subtitle: 'You are signed in. Choose the installer for this computer; the desktop app includes the Local Engine and opens the workspace directly after installation.',
    current: 'Current release',
    recommended: 'Recommended for Windows',
    download: 'Download installer',
    checksum: 'SHA-256 checksum',
    verified: 'Official direct link · Sign-in required',
    requirements: 'Windows 10/11 · 64-bit',
    macRecommended: 'Recommended for macOS',
    macRequirements: 'macOS · Apple Silicon (M-series)',
    macInstallTitle: 'macOS installation note',
    macInstallBody: 'Open the DMG and drag MedHelp into Applications. If macOS reports that the app is damaged or cannot be verified, open Terminal and run:',
    copyCommand: 'Copy command',
    ccTitle: 'Download CC Switch',
    ccSubtitle: 'Available builds are read directly from the CC Switch release directory on this server.',
    ccRepository: 'View CC Switch GitHub Releases',
    loading: 'Loading available builds…',
    empty: 'No CC Switch installers are available right now.',
    loadFailed: 'The CC Switch build list is temporarily unavailable. Please refresh later.',
    direct: 'Direct download',
    footer: 'Files are served directly by app.medtimehelp.com.',
  },
};

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** exponent);
  return `${value.toFixed(exponent >= 2 ? 1 : 0)} ${units[exponent]}`;
}

function platformLabel(platform: DownloadArtifact['platform']) {
  if (platform === 'windows') return 'Windows';
  if (platform === 'macos') return 'macOS';
  if (platform === 'linux') return 'Linux';
  return 'Desktop';
}

function ArtifactCard({ artifact, directLabel }: { artifact: DownloadArtifact; directLabel: string }) {
  const details = [platformLabel(artifact.platform), artifact.architecture, formatBytes(artifact.bytes)].filter(Boolean);
  return (
    <article className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-lg hover:shadow-emerald-950/5">
      <div className="flex items-start justify-between gap-4">
        <div className="rounded-xl bg-slate-100 p-3 text-slate-700 group-hover:bg-emerald-50 group-hover:text-emerald-700">
          <Laptop className="h-5 w-5" />
        </div>
        {artifact.version && (
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">v{artifact.version}</span>
        )}
      </div>
      <h3 className="mt-5 break-words text-base font-semibold text-slate-900">{artifact.name}</h3>
      <p className="mt-2 text-sm text-slate-500">{details.join(' · ')}</p>
      <a
        href={artifact.url}
        download
        className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
      >
        <Download className="h-4 w-4" />
        {directLabel}
      </a>
    </article>
  );
}

export default function DownloadPage() {
  const { i18n } = useTranslation();
  const activeLanguage = i18n.resolvedLanguage || i18n.language || 'zh-CN';
  const strings = activeLanguage.startsWith('zh') ? copy.zh : copy.en;
  const [catalog, setCatalog] = useState<DownloadCatalog>({ medhelp: null, medhelpDesktop: [], ccSwitch: [] });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    document.title = `${strings.title} — MedHelp`;
    fetch('/api/public-downloads', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => setCatalog({
        medhelp: data?.medhelp || null,
        medhelpDesktop: Array.isArray(data?.medhelpDesktop) ? data.medhelpDesktop : [],
        ccSwitch: Array.isArray(data?.ccSwitch) ? data.ccSwitch : [],
      }))
      .catch((error) => {
        if (error?.name !== 'AbortError') setLoadFailed(true);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [strings.title]);

  const medhelp = catalog.medhelpDesktop.find((artifact) => artifact.platform === 'windows')
    || catalog.medhelp
    || MEDHELP_FALLBACK;
  const medhelpMac = catalog.medhelpDesktop.find((artifact) => artifact.platform === 'macos')
    || MEDHELP_MAC_FALLBACK;
  const medhelpDetails = useMemo(
    () => [strings.requirements, formatBytes(medhelp.bytes)].filter(Boolean).join(' · '),
    [medhelp.bytes, strings.requirements],
  );
  const macDetails = useMemo(
    () => [strings.macRequirements, formatBytes(medhelpMac.bytes)].filter(Boolean).join(' · '),
    [medhelpMac.bytes, strings.macRequirements],
  );
  const macXattrCommand = 'xattr -cr /Applications/MedHelp.app';

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-slate-900" style={{ colorScheme: 'light' }}>
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <Link to="/" className="flex items-center gap-3">
            <img src="/icons/medhelp-logo-transparent.png" alt="MedHelp" className="h-9 w-auto rounded-md" />
          </Link>
          <Link to="/" className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 transition hover:text-emerald-700">
            <ArrowLeft className="h-4 w-4" />
            {strings.back}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-12 sm:px-8 sm:py-16">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold text-emerald-700">
            <Globe2 className="h-4 w-4" />
            {strings.eyebrow}
          </div>
          <h1 className="mt-5 text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl">{strings.title}</h1>
          <p className="mt-4 text-lg leading-8 text-slate-600">{strings.subtitle}</p>
        </div>

        <div className="mt-10 grid items-stretch gap-6 lg:grid-cols-2">
          <section className="flex h-full flex-col overflow-hidden rounded-3xl border border-emerald-200 bg-white shadow-xl shadow-emerald-950/[0.06]">
            <div className="p-6 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">{strings.recommended}</span>
                <span className="text-sm font-medium text-slate-500">{strings.current} · v{medhelp.version}</span>
              </div>
              <div className="mt-5 flex items-start gap-3.5">
                <div className="rounded-xl bg-emerald-50 p-3 text-emerald-700"><MonitorDown className="h-7 w-7" /></div>
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-slate-950">{medhelp.product}</h2>
                  <p className="mt-1 text-sm text-slate-500">{medhelpDetails}</p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a
                  href={medhelp.url}
                  download
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-md shadow-emerald-600/15 transition hover:bg-emerald-700"
                >
                  <Download className="h-4 w-4" />
                  {strings.download}
                </a>
                {medhelp.sha256Url && (
                  <a href={medhelp.sha256Url} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-medium text-slate-500 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
                    <FileCheck2 className="h-4 w-4" />
                    {strings.checksum}
                  </a>
                )}
              </div>
            </div>
            <div className="mt-auto border-t border-emerald-100 bg-emerald-50/70 p-6 sm:p-7">
              <div className="flex items-center gap-3 text-emerald-800">
                <ShieldCheck className="h-5 w-5" />
                <span className="font-semibold">{strings.verified}</span>
              </div>
              {medhelp.sha256 && (
                <div className="mt-4 rounded-xl border border-emerald-200/80 bg-white/80 p-3.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">SHA-256</p>
                  <code className="mt-2 block break-all text-xs leading-5 text-slate-600">{medhelp.sha256}</code>
                </div>
              )}
              <div className="mt-4 flex items-center gap-2 break-all text-sm text-slate-600">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {medhelp.name}
              </div>
            </div>
          </section>

          <section className="flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-950/[0.04]">
            <div className="p-6 sm:p-7">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white">{strings.macRecommended}</span>
                <span className="text-sm font-medium text-slate-500">{strings.current} · v{medhelpMac.version}</span>
              </div>
              <div className="mt-5 flex items-start gap-3.5">
                <div className="rounded-xl bg-slate-100 p-3 text-slate-700"><Laptop className="h-7 w-7" /></div>
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-slate-950">{medhelpMac.product} for Mac</h2>
                  <p className="mt-1 text-sm text-slate-500">{macDetails}</p>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <a
                  href={medhelpMac.url}
                  download
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-md shadow-slate-900/10 transition hover:bg-slate-800"
                >
                  <Download className="h-4 w-4" />
                  {strings.download}
                </a>
                {medhelpMac.sha256Url && (
                  <a href={medhelpMac.sha256Url} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-medium text-slate-500 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700">
                    <FileCheck2 className="h-4 w-4" />
                    {strings.checksum}
                  </a>
                )}
              </div>
            </div>
            <div className="mt-auto border-t border-slate-200 bg-slate-50 p-6 sm:p-7">
              {medhelpMac.sha256 && (
                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">SHA-256</p>
                  <code className="mt-2 block break-all text-xs leading-5 text-slate-600">{medhelpMac.sha256}</code>
                </div>
              )}
              <div className="mt-4 flex items-center gap-2 break-all text-sm text-slate-600">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                {medhelpMac.name}
              </div>
              <h3 className="mt-6 font-semibold text-slate-900">{strings.macInstallTitle}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{strings.macInstallBody}</p>
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
                <code className="min-w-0 flex-1 overflow-x-auto text-xs text-slate-700">{macXattrCommand}</code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(macXattrCommand)}
                  className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-100"
                >
                  {strings.copyCommand}
                </button>
              </div>
            </div>
          </section>
        </div>

        <section className="mt-14">
          <h2 className="text-2xl font-bold text-slate-950">{strings.ccTitle}</h2>
          <p className="mt-2 text-slate-600">{strings.ccSubtitle}</p>
          <a
            href="https://github.com/farion1231/cc-switch/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 transition hover:text-emerald-800 hover:underline"
          >
            <Github className="h-4 w-4" />
            {strings.ccRepository}
          </a>

          {loading ? (
            <div className="mt-6 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              {strings.loading}
            </div>
          ) : catalog.ccSwitch.length > 0 ? (
            <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {catalog.ccSwitch.map((artifact) => (
                <ArtifactCard key={artifact.url} artifact={artifact} directLabel={strings.direct} />
              ))}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              {loadFailed ? strings.loadFailed : strings.empty}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-5 py-6 text-center text-sm text-slate-400">
        {strings.footer}
      </footer>
    </div>
  );
}
