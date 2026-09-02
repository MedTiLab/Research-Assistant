import type { LocalKernelGateState } from '../../state/localKernelStore';

export const shouldShowLocalKernelWorkspace = ({
  isRequired,
  state,
  hasConnected,
}: {
  isRequired: boolean;
  state: LocalKernelGateState;
  hasConnected: boolean;
}) => (
  !isRequired
  || state === 'not-required'
  || state === 'connected'
  || (hasConnected && state === 'probing')
);
