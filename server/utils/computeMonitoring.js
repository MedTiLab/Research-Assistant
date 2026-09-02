const MB = 1024 * 1024;

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

export function parseMacMemoryPressure(memoryPressureOutput, totalMB) {
  if (typeof memoryPressureOutput !== 'string' || !memoryPressureOutput.trim() || !Number.isFinite(totalMB) || totalMB <= 0) {
    return null;
  }

  const freePercentMatch = memoryPressureOutput.match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/i);
  if (!freePercentMatch) {
    return null;
  }

  const availablePercent = clamp(parseFloat(freePercentMatch[1]), 0, 100);
  const availableMB = Math.round(totalMB * (availablePercent / 100));

  return buildMemorySnapshot({
    totalMB,
    usedMB: totalMB - availableMB,
    availableMB,
    label: 'Memory Pressure',
    displayMode: 'available',
  });
}

export function parseMacVmStat(vmStatOutput, totalMB) {
  if (typeof vmStatOutput !== 'string' || !vmStatOutput.trim() || !Number.isFinite(totalMB) || totalMB <= 0) {
    return null;
  }

  const pageSizeMatch = vmStatOutput.match(/page size of (\d+) bytes/i);
  if (!pageSizeMatch) {
    return null;
  }

  const pageSize = parseInt(pageSizeMatch[1], 10);
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    return null;
  }

  const readPageCount = (label) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = vmStatOutput.match(new RegExp(`${escapedLabel}:\\s+(\\d+)\\.?`, 'i'));
    return match ? parseInt(match[1], 10) : 0;
  };

  const availablePages = [
    'Pages free',
    'Pages inactive',
    'Pages speculative',
    'Pages purgeable',
  ].reduce((sum, label) => sum + readPageCount(label), 0);

  const availableMB = Math.round((availablePages * pageSize) / MB);

  return buildMemorySnapshot({
    totalMB,
    usedMB: totalMB - availableMB,
    availableMB,
    label: 'Available Memory',
    displayMode: 'available',
  });
}

export function buildLocalMemorySnapshot({
  platform,
  totalMB,
  osFreeMB,
  linuxFreeMemoryLine,
  memoryPressureOutput,
  vmStatOutput,
}) {
  if (platform === 'linux') {
    const linuxSnapshot = parseLinuxFreeMemoryLine(linuxFreeMemoryLine);
    if (linuxSnapshot) {
      return linuxSnapshot;
    }
  }

  if (platform === 'darwin') {
    const pressureSnapshot = parseMacMemoryPressure(memoryPressureOutput, totalMB);
    if (pressureSnapshot) {
      return pressureSnapshot;
    }

    const vmStatSnapshot = parseMacVmStat(vmStatOutput, totalMB);
    if (vmStatSnapshot) {
      return vmStatSnapshot;
    }
  }

  return buildMemorySnapshot({
    totalMB,
    usedMB: roundMb(totalMB) - roundMb(osFreeMB),
    availableMB: roundMb(osFreeMB),
  });
}
