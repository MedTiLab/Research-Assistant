const COMMON_RUNTIME_SUFFIX = '安装完成后点击“重新检测”。也可以暂时跳过，进入 MedHelp 后再配置。';

const GUIDANCE_BY_PLATFORM = {
  darwin: {
    ccSwitchDescription: '请先安装并启动一次 CC Switch，让它生成本机配置目录；如果已经安装，请重新安装或确认应用位于“应用程序”文件夹，然后重新检测。',
    pythonDescription: `当前未找到可用的 Python 3。请从 Python 官方网站下载安装程序。${COMMON_RUNTIME_SUFFIX}`,
    pythonDownloadUrl: 'https://www.python.org/downloads/macos/',
    pythonDownloadLabel: '打开 Python 官方下载页',
    pythonPlaceholder: '例如 /opt/homebrew/bin/python3',
    rDescription: `当前未找到可用的 R。请从 R 官方镜像下载安装程序。${COMMON_RUNTIME_SUFFIX}`,
    rDownloadUrl: 'https://cran.r-project.org/bin/macosx/',
    rDownloadLabel: '打开 R 官方下载页',
    rPlaceholder: '例如 /Library/Frameworks/R.framework/Resources/bin/R',
  },
  win32: {
    ccSwitchDescription: '请先安装并启动一次 CC Switch，让它生成本机配置目录；如果已经安装，请确认能从“开始”菜单正常启动，或重新安装后再检测。',
    pythonDescription: `当前未找到可用的 Python 3。请从 Python 官方网站下载 Windows 安装程序；安装时请启用“将 Python 添加到环境变量”选项。${COMMON_RUNTIME_SUFFIX}`,
    pythonDownloadUrl: 'https://www.python.org/downloads/windows/',
    pythonDownloadLabel: '打开 Python 官方下载页',
    pythonPlaceholder: '例如 C:\\Users\\你的用户名\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
    rDescription: `当前未找到可用的 R。请从 R 官方镜像下载 Windows 安装程序。${COMMON_RUNTIME_SUFFIX}`,
    rDownloadUrl: 'https://cran.r-project.org/bin/windows/base/',
    rDownloadLabel: '打开 R 官方下载页',
    rPlaceholder: '例如 C:\\Program Files\\R\\R-4.x.x\\bin\\R.exe',
  },
  linux: {
    ccSwitchDescription: '请先安装并启动一次 CC Switch，让它生成本机配置目录；如果已经安装，请确认应用可正常启动，或重新安装后再检测。',
    pythonDescription: `当前未找到可用的 Python 3。请参考 Python 官方下载说明完成安装。${COMMON_RUNTIME_SUFFIX}`,
    pythonDownloadUrl: 'https://www.python.org/downloads/source/',
    pythonDownloadLabel: '打开 Python 官方下载页',
    pythonPlaceholder: '例如 /usr/bin/python3',
    rDescription: `当前未找到可用的 R。请参考 R 官方说明选择对应的 Linux 发行版。${COMMON_RUNTIME_SUFFIX}`,
    rDownloadUrl: 'https://cran.r-project.org/bin/linux/',
    rDownloadLabel: '打开 R 官方下载页',
    rPlaceholder: '例如 /usr/bin/R',
  },
};

const GENERIC_GUIDANCE = {
  ccSwitchDescription: '请先安装并启动一次 CC Switch，让它生成本机配置目录；如果已经安装，请确认应用可正常启动，或重新安装后再检测。',
  pythonDescription: `当前未找到可用的 Python 3。请安装或重新安装。${COMMON_RUNTIME_SUFFIX}`,
  pythonDownloadUrl: 'https://www.python.org/downloads/',
  pythonDownloadLabel: '打开 Python 官方下载页',
  pythonPlaceholder: 'Python 3 可执行文件的完整路径',
  rDescription: `当前未找到可用的 R。请安装或重新安装。${COMMON_RUNTIME_SUFFIX}`,
  rDownloadUrl: 'https://cran.r-project.org/',
  rDownloadLabel: '打开 R 官方下载页',
  rPlaceholder: 'R 可执行文件的完整路径',
};

export function getEnvironmentSetupGuidance(platform) {
  const normalizedPlatform = String(platform || '').trim().toLowerCase();
  return GUIDANCE_BY_PLATFORM[normalizedPlatform] || GENERIC_GUIDANCE;
}
