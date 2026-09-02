# Packaging commands

Platform-specific build orchestration lives here:

```text
scripts/packaging/
├── package-desktop.mjs  Current-platform Desktop dispatcher
├── windows/             Windows Desktop packaging
├── macos/               macOS Desktop packaging
└── local-engine/        Internal/legacy packaging implementation; not a public distribution
```

Canonical npm commands:

- `npm run desktop:dist`
- `npm run desktop:dist:win`
- `npm run desktop:dist:mac`

The secure Local Engine is prepared as an internal input to these Desktop
builds. Standalone Kernel and hosted-frontend Desktop release commands have
been removed.
