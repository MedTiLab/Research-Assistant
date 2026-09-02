# Desktop source layout

The only product distribution is now the **bundled-frontend Desktop with local
accounts** for Windows and macOS. Users register and sign in against the loopback-only
account database, then the app automatically
connects to the Local Engine bundled with a running Desktop app. Standalone browser
Kernel packages and the hosted-frontend Desktop distribution are no longer released. See
[`docs/web-offline-version-relationship.zh-CN.md`](../docs/web-offline-version-relationship.zh-CN.md)
for the authoritative product boundaries and release order.

All current distributions continue to share application sources. Platform and
delivery packaging branch from that shared product rather than maintaining
separate business implementations.

```text
desktop/
├── common/   Shared Electron window and update helpers
├── online/   Shared modern Desktop main process and preload (historical directory name)
├── offline/  Offline-frontend mode entry and resource boundary policy
└── legacy/   Previous self-hosted desktop entry, kept for compatibility
```

`online/` must stay platform-neutral. Windows and macOS installer details belong
under `packaging/<platform>/` and `scripts/packaging/<platform>/`.

`npm run desktop:start` starts the bundled-frontend Desktop. `desktop:dist:mac`
and `desktop:dist:win` build the two supported installers. There are no public
commands for packaging a standalone browser Kernel or a hosted-frontend Desktop.

Legacy Desktop supports two Runtime lifecycle modes. The stable process
boundary is the default; the older in-process behavior remains available only
as a rollback switch:

- `MEDHELP_DESKTOP_RUNTIME_MODE=supervised` (default) starts the Server in an isolated
  `ELECTRON_RUN_AS_NODE` child process, waits for `/health`, records structured
  Runtime state, and applies bounded automatic restart backoff.
- `MEDHELP_DESKTOP_RUNTIME_MODE=embedded` explicitly restores the previous
  compatibility behavior for emergency rollback.

The Renderer receives Runtime state through the `medhelpDesktop` preload bridge;
it does not infer readiness from the child PID or port. Runtime output is stored
in `legacy-runtime.log` under the Desktop user-data directory.

The macOS and Windows Desktop variants use the same secured bundled Local Engine,
local account database, and compiled `dist/` assets, all served through loopback-only
servers inside Electron. Build it with `desktop:dist:mac` or `desktop:dist:win`.
Registration, login, user profiles, and conversation archives do not contact an
online account service.

## Desktop updates

Packaged Desktop builds check the cloud `/api/public-downloads` catalog
in the background. A compatible artifact is offered only when its version is
newer and the catalog includes a valid SHA-256 checksum. After the user clicks
the update action, Electron downloads and verifies the installer, exits the
bundled Local Engine, and hands installation to the platform updater.

- Windows uses the NSIS package in silent update mode. A per-machine install
  can still require the standard Windows UAC confirmation.
- macOS verifies the signed app inside the DMG, replaces the installed `.app`,
  and reopens it. macOS can request administrator authorization when the app is
  not writable by the current user.
