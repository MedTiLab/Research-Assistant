import type { SessionProvider } from '../types/app';
import ClaudeLogo from './ClaudeLogo';
import CodexLogo from './CodexLogo';
import LocalGpuLogo from './LocalGpuLogo';
import PiLogo from './PiLogo';

type SessionProviderLogoProps = {
  provider?: SessionProvider | string | null;
  className?: string;
};

export default function SessionProviderLogo({
  provider = 'claude',
  className = 'w-5 h-5',
}: SessionProviderLogoProps) {
  if (provider === 'codex') {
    return <CodexLogo className={className} />;
  }

  if (provider === 'local') {
    return <LocalGpuLogo className={className} />;
  }

  if (provider === 'pi') {
    return <PiLogo className={className} />;
  }

  return <ClaudeLogo className={className} />;
}
