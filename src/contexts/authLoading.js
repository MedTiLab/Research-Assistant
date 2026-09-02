// Only the first authentication check should replace the application with the
// blocking loading screen. Access-token rotation happens during normal app use
// and must remain a background revalidation.
export const shouldBlockAuthStatusCheck = (hasCompletedInitialAuthCheck) => (
  !hasCompletedInitialAuthCheck
);

// Auth revalidation returns a newly allocated config object even when none of
// its values changed. Preserve the previous reference so downstream effects do
// not mistake token rotation for a Kernel configuration change.
export const areEquivalentLocalKernelConfigs = (current, next) => {
  if (Object.is(current, next)) return true;
  if (current == null || next == null) return current === next;
  if (typeof current !== 'object' || typeof next !== 'object') return false;

  if (Array.isArray(current) || Array.isArray(next)) {
    if (!Array.isArray(current) || !Array.isArray(next) || current.length !== next.length) {
      return false;
    }
    return current.every((value, index) => areEquivalentLocalKernelConfigs(value, next[index]));
  }

  const currentKeys = Object.keys(current).sort();
  const nextKeys = Object.keys(next).sort();
  if (currentKeys.length !== nextKeys.length) return false;

  return currentKeys.every((key, index) => (
    key === nextKeys[index]
    && areEquivalentLocalKernelConfigs(current[key], next[key])
  ));
};
