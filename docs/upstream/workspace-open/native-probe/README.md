# Workspace Open verification fixture

This is a prebuilt custom-editor test fixture for the adjacent nine-file upstream proposal. It is **not a Terraphim product release, a marketplace submission, or a claim that the released Nimbalyst SDK exposes the proposed API**. No native install or chooser interaction has yet been performed.

The fixture registers only `*.open-probe`. Its visible Open button calls `host.openWorkspaceFile()`, while the standard SDK lifecycle loads/edits the probe buffer and reports dirty state. Results and sampled public host/buffer state appear visibly. Observe the real host tab bar separately; no private tab-store, Electron IPC, raw CDP, backend or mock is used. No AI request or remote runtime asset is included.

The source was typechecked and built against the actual patched upstream SDK. The real SDK bundle validator and compiled component-export checks pass. `provenance.json` records exact identities, and `payload-manifest.json` hashes this packet. `dist/` is deliberately committed so the normal GitHub installer does not run a build script or require an MCP credential.

## Supported installer boundary

After this fixture is reviewed and present on the repository's default branch, the ordinary Settings > Extensions > Install from GitHub URL is:

```text
https://github.com/terraphim/nimbalyst-terraphim/tree/main/docs/upstream/workspace-open/native-probe
```

The inspected host installer accepts a subdirectory but **ignores the URL's ref**: it always shallow-clones default HEAD, then sparse-checks out the subdirectory. A verification-branch or commit URL does not pin the downloaded source. Verify the current default HEAD and compare installed file hashes after the actual UI install. Before this packet reaches main, that URL must not be claimed usable.

The installer first checks the latest non-prerelease GitHub release for an asset whose filename starts with `native-probe` and ends with `.nimext` or `.zip`. No such asset may shadow the committed-fixture route. This fixture does not create a release. When cloning, the installer requires a manifest ID and committed `dist/`, then installs under the normal app userData/extensions directory and records source `github-url`. Under the task's supported `NIMBALYST_USER_DATA_DIR`, that is the fresh isolated profile, not a hardcoded home extension directory.

## Native launch remains held

Normal legal onboarding must be completed appropriately; no `PLAYWRIGHT` or completed-onboarding flags are allowed. The Windsurf native-control lease has priority.

Ordinary `App.tsx` startup reads the user's MCP configuration for its Figma migration check. That service can migrate/write the global configuration if the primary file is absent or lacks a defined `mcpServers` key. Isolated Nimbalyst userData does not redirect that service. Before any local verification, inspect only existence/JSON/key-presence booleans and preserve the files. In the reviewed verification environment, the primary has that defined key and the legacy file is absent, so the inspected startup read does not enter migration. No configuration values are included in this packet. Do not launch a provider session, copy production configuration, edit global files, or use the separate MCP bootstrap. The ordinary GitHub installer needs none of those actions.

## Rebuild for review

Use Node24.22.0 and the prepared upstream checkout at `b5d994092c27ebe1f6a402c61351081b0dd52c56` with the adjacent exact nine-file patch. Follow the adjacent proposal README's frozen-install/SDK build prerequisites. In a disposable copy of this fixture, link `node_modules` to that prepared upstream checkout's `node_modules`, then run its actual `tsc --noEmit` and `vite build`. Validate `dist/` using that compiled SDK's `validateExtensionBundle`, and inspect the compiled `components.WorkspaceOpenProbe` export. Do not replace the actual SDK with stubs or claim this build as native acceptance.

Actual proof must observe cancel, successful new/previous-tab admission, retained dirty buffers and owned refusal cases through the native chooser, with saved bytes and readbacks retained. Even a passing development-host check qualifies only the proposed Open patch; upstream acceptance/release and Terraphim's three-platform all41/release admission remain separate.
