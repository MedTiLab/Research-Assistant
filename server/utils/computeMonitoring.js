function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundMb(value) {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function buildMemorySnapshot({
  totalMB,
  usedMB,
  availableMB,
  label = 'System Memory',
  displayMode = 'used',
}) {
  const safeTotalMB = roundMb(totalMB);
  const safeUsedMB = safeTotalMB > 0
    ? clamp(roundMb(usedMB), 0, safeTotalMB)
    : Math.max(0, roundMb(usedMB));
  const inferredAvailableMB = safeTotalMB > 0 ? safeTotalMB - safeUsedMB : 0;
  const safeAvailableMB = safeTotalMB > 0
    ? clamp(roundMb(Number.isFinite(availableMB) ? availableMB : inferredAvailableMB), 0, safeTotalMB)
    : Math.max(0, roundMb(availableMB));

  return {
    memTotalMB: safeTotalMB,
    memUsedMB: safeUsedMB,
    memAvailableMB: safeAvailableMB,
    memUtilPercent: safeTotalMB > 0 ? Math.round((safeUsedMB / safeTotalMB) * 100) : 0,
    memLabel: label,
    memDisplayMode: displayMode,
  };
}

export function parseLinuxFreeMemoryLine(memLine) {
  if (typeof memLine !== 'string' || !memLine.trim()) {
    return null;
  }

  const tokens = memLine.trim().split(/\s+/);
  if (tokens.length < 3 || !/^Mem:/i.test(tokens[0])) {
    return null;
  }

  const totalMB = parseInt(tokens[1], 10);
  const usedMB = parseInt(tokens[2], 10);
  const availableMB = parseInt(tokens[6], 10);

  if (!Number.isFinite(totalMB) || totalMB <= 0) {
    return null;
  }

  if (Number.isFinite(availableMB)) {
    return buildMemorySnapshot({
      totalMB,
      usedMB: totalMB - availableMB,
      availableMB,
    });
  }

  return buildMemorySnapshot({
    totalMB,
    usedMB: Number.isFinite(usedMB) ? usedMB : 0,
  });
}
