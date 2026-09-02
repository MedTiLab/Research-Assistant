function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export function isWebShellOnlyMode() {
  return isTruthyEnv(process.env.MEDHELP_WEB_SHELL_ONLY)
    || isTruthyEnv(process.env.WEB_SHELL_ONLY)
    || isTruthyEnv(process.env.REQUIRE_LOCAL_KERNEL);
}

export function getLocalKernelConfig() {
  return {
    required: isWebShellOnlyMode(),
    discovery: 'loopback-auto',
    distribution: 'desktop-only',
    desktopDownloadPath: '/download',
  };
}

export function buildLocalKernelRequiredPayload(extra = {}) {
  return {
    error: 'Open the MedHelp desktop app on this computer to run compute or data tasks.',
    code: 'LOCAL_KERNEL_REQUIRED',
    localKernel: getLocalKernelConfig(),
    ...extra,
  };
}

export function requireServerExecutionAllowed(req, res, next) {
  if (!isWebShellOnlyMode()) {
    return next();
  }

  return res.status(428).json(buildLocalKernelRequiredPayload({
    path: req.originalUrl || req.url,
  }));
}

export function sendLocalKernelRequired(writer, extra = {}) {
  const payload = buildLocalKernelRequiredPayload(extra);
  if (writer && typeof writer.send === 'function') {
    writer.send({
      type: 'local-kernel-required',
      ...payload,
    });
  }
  return payload;
}
