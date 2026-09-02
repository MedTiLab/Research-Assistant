const bridge = window.medhelpDesktop;
const indicator = document.getElementById('indicator');
const title = document.getElementById('status-title');
const message = document.getElementById('status-message');
const diagnostics = document.getElementById('diagnostics');
const actions = document.getElementById('actions');
const restartRuntimeButton = document.getElementById('restart-runtime');

const busyStatuses = new Set(['discovering', 'starting', 'stopping']);
const failureStatuses = new Set(['error', 'missing', 'degraded', 'stopped']);
const titles = {
  disabled: 'Runtime 未启用',
  discovering: '正在检查桌面环境',
  starting: '正在启动 Runtime',
  running: 'Runtime 已就绪',
  degraded: 'Runtime 部分能力不可用',
  stopping: '正在停止 Runtime',
  stopped: 'Runtime 已停止',
  error: 'Runtime 启动或运行失败',
  missing: '找不到 Runtime 资源',
};

function renderStatus(status) {
  if (!status) return;
  const isBusy = busyStatuses.has(status.status);
  const isFailure = failureStatuses.has(status.status);
  title.textContent = titles[status.status] || '正在准备桌面环境';
  message.textContent = status.message || '桌面外壳仍然可用，可以重试或查看诊断信息。';
  indicator.className = `indicator${isBusy ? ' busy' : ''}${isFailure ? ' error' : ''}`;
  actions.classList.toggle('visible', isFailure);
  restartRuntimeButton.disabled = isBusy || status.recoverable === false;
  diagnostics.hidden = !status.diagnosticsPath;
  diagnostics.textContent = status.diagnosticsPath ? `日志：${status.diagnosticsPath}` : '';
}

restartRuntimeButton.addEventListener('click', async () => {
  restartRuntimeButton.disabled = true;
  try {
    renderStatus(await bridge?.restartRuntime?.());
  } catch (error) {
    renderStatus({ status: 'error', message: error?.message || String(error), recoverable: true });
  } finally {
    restartRuntimeButton.disabled = false;
  }
});

document.getElementById('open-diagnostics').addEventListener('click', () => {
  void bridge?.openRuntimeDiagnostics?.();
});
document.getElementById('restart-app').addEventListener('click', () => {
  void bridge?.restartApp?.();
});

bridge?.onRuntimeStatus?.(renderStatus);
bridge?.getRuntimeStatus?.().then(renderStatus).catch((error) => {
  renderStatus({ status: 'error', message: error?.message || String(error), recoverable: true });
});
