# Proposed workspace Open — actual macOS development-host results

The actual Nimbalyst 0.81.7 development host ran the reviewed nine-file proposal and exact public verification fixture identified in identities.json. Normal onboarding was completed by the user; the probe used ordinary UI and Settings GitHub installation, with no provider session, mocked Electron API, private IPC or synthetic concurrency. All 13 installed payload files matched public fixture source a76c5340. This is proposed-API development verification only.

| Case | Actual result | Selected actual evidence |
|---|---|---|
| Optional public API and native chooser | PASS: visible Open button invokes the real native chooser. | [Native chooser](07-native-chooser.png) |
| Cancel, saved origin | PASS: cancelled outcome; original tab/buffer retained. Earlier sentinel had already autosaved, so this is explicitly a saved-origin case. | [Cancel](08-cancel-result-readable.png) |
| New text tab | PASS: decision.md created/activated in actual host tab bar; original buffer retained on return. | [New tab](09-new-tab-opened.png) |
| Outside-workspace input | PASS: selected owned external input refused; no tab added. | [Refusal](11-outside-refusal.png) |
| NUL-containing Markdown | PASS: unavailable/not-text refusal; no tab added. | [Refusal](12-nul-refusal.png) |
|4MiB+1 Markdown | PASS: selected oversized input refused; no tab added. | [Refusal](13-oversized-refusal.png) |
| Genuine unsaved state | PASS: real file0444/directory0555 refusal blocks autosave; dirty marker/localDirty true and79-byte sentinel buffer remain while disk stays 53 bytes. | [Blocked save](15-readonly-after-save-failure.png), [dirty readback](19-dirty-origin-after-new-tab.png), [baseline input](14-readonly-disk.json) |
| Cancel with unsaved edits | PASS: cancelled outcome preserves dirty buffer and disk baseline. | [Actual capture](16-readonly-dirty-cancel.png) |
| Already-open dirty destination | PASS: existing dirty target activated without replacing its unsaved buffer. | [Actual capture](18-existing-dirty-target-retained.png), [disk baseline](18-retained-dirty-disk.json) |
| New tab from dirty origin | PASS: second.open-probe added; origin before/after localDirty true and same 79-byte buffer on return. | [Full dirty/new-tab readback](19-dirty-origin-after-new-tab.png) |
| Recovery after actual save refusal | PASS: after only owned permissions were restored, normal autosave persisted 79 bytes and cleared dirty before later Cmd+S. | [Recovered UI](20-after-permission-recovery.png), [actual output](20-retained-recovered.saved.open-probe), [hash/causation](20-recovery-output-readback.json) |
| Origin changes while chooser pending | NOT_RUN: chooser was window-modal and no supported same-window tab-switch route was demonstrated while pending. | No fabricated concurrency |

The recovered output is 79 bytes/SHA256 960fef7397a1779cd77baddeb14077d0cd86e24a382c8d8696036bdd143b38ad; the readonly baseline is 53 bytes/SHA256 43316e66c64c9fe664312013f6910bf93f0fb7bb7791361eb880e3f0dd248162. Normal View zoom/sidebar controls made full readbacks visible; screenshots were not edited. A temporary input label containing UNSAVED does not establish dirty state: saved-origin and independently proved readonly-dirty cases remain distinct.

All 11 observed finite cases pass in this macOS development host. One modal-origin case remains untested. Upstream authorship/DCO, accepted/released SDK and host support, actual Windows/Linux native checks and Terraphim product all 41/release admission remain separate gates. The owned development process was closed after evidence collection; no product release is claimed.
