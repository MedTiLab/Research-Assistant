function parseVersion(value) {
  const match = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(String(value || ''));
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Shared version comparison for desktop distribution update checks.
export function isUpdateAvailable(currentVersion, latestVersion) {
  const current = parseVersion(currentVersion);
  const latest = parseVersion(latestVersion);
  if (!current || !latest) {
    return false;
  }

  for (let i = 0; i < 3; i += 1) {
    if (latest[i] > current[i]) return true;
    if (latest[i] < current[i]) return false;
  }
  return false;
}

export async function fetchLatestRelease(baseUrl) {
  const response = await fetch(`${String(baseUrl).replace(/\/$/, '')}/api/local-kernel/public-releases`, {
    headers: { Origin: 'https://app.medtimehelp.com' },
  });
  if (!response.ok) {
    throw new Error(`releases check failed: ${response.status}`);
  }
  return response.json();
}
