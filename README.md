# Terraphim for Nimbalyst — component development

This repository contains the in-progress components for a Nimbalyst editor that reuses Terraphim's Rust/WASM engine. There is no installable Nimbalyst extension or package release yet.

The components cover UTF-8 file admission, opted-in role storage, local recovery drafts, save/readback control, fresh clean/graph exports and an opaque frame using the released visual editor and graph Worker. Actual browser tests create alternatives, preserve undo/redo, save/reopen annotated Markdown and verify same-concept synonym exports. The parent Save barrier flushes queued frame edits before a verified save or export, including a second Save requested during an existing write. Parent controls provide Save, fresh-file export dialogs with cancellation/focus restoration, and recovery list/copy/explicit-discard even when editing is unavailable. Native host wiring, recovery restoration, role controls, optional AI alternatives and installed-app acceptance remain in progress.

## Run the component tests

Use Node 26.10.0 and npm. On macOS or Linux, or Bash on Windows:

```sh
npm ci --ignore-scripts --no-audit --no-fund
export PLAYWRIGHT_BROWSERS_PATH=.cache/browsers
npx --no-install playwright install --with-deps --only-shell chromium
mkdir -p .cache
curl --fail --location --output .cache/editor-candidate.tar.gz https://github.com/terraphim/terraphim-editor/releases/download/v0.1.0-rc.2/editor-candidate.tar.gz
npm run prepare:recovery-assets -- .cache/editor-candidate.tar.gz
npm run typecheck
npm run test:source
npm run test:recovery
```

The asset importer checks SHA-256 `daa104aecdca43df5ca6dcf36b420351be09784a8436ab61bd3fc9acb1504e73` before extracting the archive, then verifies all 132 manifest entries. The tests use real Chromium, IndexedDB, released Rust/WASM and temporary files. Their controller host adapter is a test boundary, not the installed Nimbalyst application.

The visual dependency builder verifies all released files before bundling local Shoelace modules and embedding the exact local font/icon bytes. Editor, graph Worker and Rust/WASM source stay unchanged; no CDN is used by the frame. The resulting source-component manifest is not a released native-package manifest.

The read-only component workflow runs these checks on Linux, macOS and Windows and retains actual logs and saved outputs. It does not build or publish a native extension. Every supported native app must install the eventual package and produce saved outputs for all 41 acceptance requirements before a release. The native Open action also depends on a [supported upstream capability](https://github.com/nimbalyst/nimbalyst/issues/1764), absent from released SDK 0.7.0. Track the remaining work in [NIM-10](https://github.com/terraphim/terraphim-editor/issues/6).

## Source and dependencies

`src/role-storage.ts` and `tests/role-storage.browser.test.ts` preserve the surviving original component. The remaining component implementation and test harness were reconstructed from the approved design. Historical local recovery records are not part of this source distribution.

- [Editor RC2](https://github.com/terraphim/terraphim-editor/releases/tag/v0.1.0-rc.2), source `25ad3b16a1bebab6edd767a7efd1ace7b25c82ad`, supplies the test engine. Its 132-file hash manifest is committed; the binary archive is downloaded during CI.
- `vendor/terraphim-host-bridge/` preserves unchanged public bridge source from that same commit, plus its MIT license and provenance. The bridge is a source dependency separate from the release archive.
- `docs/recovery/pinned-contracts/ProjectFileService.ts` is unchanged public Nimbalyst source from commit `df1aa3beb8cf9b41933b873903abb018fc9d1fc6`. Its SHA-256 is checked before transpilation. The adjacent MIT license preserves Nimbalyst's copyright notice.
- The npm lockfile pins `@nimbalyst/extension-sdk` 0.7.0, TypeScript 5.9.3, Playwright 1.62.1 and esbuild 0.28.2. The SDK is MIT licensed.

Terraphim code is available under the [MIT license](LICENSE). Third-party notices remain next to the vendored code.
