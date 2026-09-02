export function shouldDeferServerRestart(healthPayload) {
  return healthPayload?.agentBusy === true;
}
