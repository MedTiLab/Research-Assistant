export function shouldImportLoginShellEnvironment(env = process.env, platform = process.platform) {
  if (platform === 'win32'
    || env.MEDHELP_DISABLE_LOGIN_SHELL_ENV_IMPORT === '1'
    || env.MEDHELP_LOGIN_SHELL_ENV_IMPORT === '1') {
    return false;
  }

  // npm already supplies the launching environment. Re-running interactive
  // shell startup files can block on version managers or terminal-only commands.
  return Boolean(env.MEDHELP_LOGIN_SHELL)
    || env.MEDHELP_ENABLE_LOGIN_SHELL_ENV_IMPORT === '1'
    || !env.npm_lifecycle_event;
}
