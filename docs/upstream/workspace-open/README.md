# Proposed workspace Open for custom editors

This is a review packet for [Nimbalyst issue 1764](https://github.com/nimbalyst/nimbalyst/issues/1764). It contains an agent-prepared nine-file source proposal and actual test results. It is published in Terraphim's repository so maintainers and a human contributor can inspect the concrete change before an upstream contribution.

**It is not accepted upstream or shipped in Nimbalyst.** At verification time on 17 October 2026, the inspected app 0.81.7 and SDK 0.7.1 did not expose this capability. Terraphim's adapter still pins SDK 0.7.0, and its first native release remains held for the required qualification.

## Behavior proposed

An optional `EditorHost.openWorkspaceFile()` asks the existing desktop host to choose an existing workspace text file and add or activate its tab. It returns `opened`, `cancelled` or `refused`; `opened` confirms tab admission, not a disk save or completed editor initialization. Existing tabs and dirty buffers are retained. Already-open files activate without reload.

The existing sender/workspace and symlink boundaries remain authoritative. The proposal refuses unsupported binary content, directories, absent files, oversized files and an originating tab/workspace that changed during admission. Embedded, collaborative and older hosts leave the method absent. It adds no extension permission to call private Electron IPC.

## Source and reproducible checks

- [Exact patch](workspace-open.patch), SHA-256 `09c211cbd4e7ce08a327c541b4fb18c9a5ab3ed4105618e96ae12d3d3b0b03cc`.
- [Upstream base and nine resulting file hashes](source.json): main `b5d994092c27ebe1f6a402c61351081b0dd52c56`. The patch also applies to inspected v0.81.7 source `4fc0ce0f4d41239b323cf6b478153f445a912d0e`.
- [Actual verification receipt](verification.json) and [final sequential gate output](final-sequential-gate.log). Only the disposable absolute checkout path is normalized to `$CHECKOUT`; both raw and public log hashes are recorded.
- [Upstream MIT notice](NIMBALYST-LICENSE.txt) accompanies the proposal, which includes upstream context.

In a disposable upstream checkout at that base, use its pinned package manager and Node 24, apply the patch, install the unchanged frozen lockfile, and build the documented workspace dependencies. Runtime and memory-engine output must exist before the whole-workspace gate:

```sh
git checkout b5d994092c27ebe1f6a402c61351081b0dd52c56
git apply /path/to/workspace-open.patch
pnpm install --frozen-lockfile
pnpm run build:tracker-packages
pnpm --filter @nimbalyst/extension-sdk run build
pnpm --filter @nimbalyst/runtime run build
pnpm --dir packages/extensions/nimbalyst-memory/engine run build
pnpm typecheck && pnpm test:prepush
```

The tested runtime was Node 24.22.0 and pnpm 12.9.1. Upstream's `pnpm install` prepare hook ran `build:tracker-packages`; that explicit command is shown above so preparation is visible. The SDK build also ran before the focused tests. Build scripts regenerate declaration byproducts; keep those separate from this exact nine-file contribution. Tests need loopback access for real local HTTP servers.

To repeat the separate fifteen-test filesystem/tab-store check without upstream's shared test setup or module substitutes, copy the included, unchanged [focused configuration](focused-open.config.mts) into the disposable checkout and run it there:

```sh
mkdir -p .artifacts
cp /path/to/workspace-open/focused-open.config.mts .artifacts/focused-open.config.mts
pnpm exec vitest --run --config .artifacts/focused-open.config.mts
```

That configuration aliases actual upstream source modules, uses real filesystem/Tab-store behavior, and has no setup files or IPC/module mocks. It is a validation harness accompanying this packet, not part of the nine-file upstream implementation patch.

The final official sequential gate exited zero: **37 workspace typechecks passed; 17,806 tests passed, zero failed, 30 skipped across 2,096 files**. Fifteen focused real filesystem/tab-store tests, SDK build, Electron types and four changed-module lint checks also passed. Two existing TabEditor lint-rule configuration errors and upstream runtime/JSDOM diagnostics are retained; no zero-warning or clean whole-repository lint result is claimed.

The initial unprepared/sandboxed full run failed; after official builds and loopback access, the exact ten previously failing files passed 135 tests. That history is retained in the receipt rather than presenting its failure as an earlier success. The later final passing whole gate is a distinct run, with all nine reviewed patch-file hashes unchanged afterward.

## Contribution and release gates

This code was prepared with an agent. No upstream commit, contributor identity or personal `Signed-off-by` certificate is supplied. Nimbalyst's current contribution policy requires truthful authorship, a real-name DCO, normal review and green checks. A contributor must personally decide whether they can certify the DCO and how to represent authorship accurately; this packet does not impersonate that decision.

Actual native chooser/cancellation/refusal/dirty-tab verification remains outstanding. Maintainer agreement, normal upstream contribution and a released host/SDK with the supported API must precede Terraphim's three-platform native acceptance. All 41 editor requirements on actual macOS, Windows and Linux apps, reviewed admission, released-package installation and marketplace admission remain separate gates. The adapter's closed release registry is unchanged.
