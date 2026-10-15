# Release the qualified native package

The repository currently has an empty `release/qualified.json`. The publication workflow refuses an unlisted version. Component CI, an installable development archive, and a native trial are separate results; none alone admits a stable release.

## Candidate and native evidence

The three component jobs still run their normal checks. Ubuntu seals its original compiled archive, its complete sidecar and `candidate.json` into `qualified-input-<source>-<attempt>`. The seal does not rebuild the editor. Only a completed successful **whole** component run qualifies this input. Record the immutable artifact ID, API digest, source/run/attempt and archive SHA-256 before native trials. Different rerun artifacts are not interchangeable.

Use this exact artifact on macOS, Windows and Linux. Windows dispatch retains its historical route when `shared_artifact` is empty. To consume the shared archive, provide all four optional fields: artifact ID, exact attempt, `sha256:` artifact digest and original archive filename, together with the existing source/run/package digest. It safely downloads and verifies the same archive and writes the existing `input-receipt.json` used by the unchanged native harness. The trial still refuses Terms/authentication barriers and retains failures; no onboarding acceptance is automated.

The current manifest is `0.1.0-dev.1`, and the package validator deliberately restricts its known manifest/permissions. A publishable stable identity must be reviewed **before** building and qualifying that future candidate. Never edit the manifest, notices or archive after native qualification to make a dev package appear stable.

## Admission record

After the finite required behaviors pass, add an entry to `release/qualified.json` and sanitized evidence under `release/evidence/<version>/` through a reviewed source PR. Keep credentials, private machine paths, normal-user documents and profiles out of this repository. The existing original requirement IDs are fixed in `scripts/release/admission.py`:41 unique rows on each host, plus explicit lifecycle clauses. Each row binds an actual output/capture, observed outcome and scenario. Input fixtures cannot be marked as results. Broad component-suite success or another OS's output cannot substitute for a missing row.

The record binds:

- Exact stable version/tag/source, candidate run/attempt/artifact ID/digest, archive hash/size, manifest hash and sorted complete file inventory.
- One actual-application receipt per `macos`, `windows`, `linux`, with real app version/architecture, identical candidate identity, unchanged installation/post-run file manifests,41 verified rows and the required lifecycle clauses.
- The separately qualified external provider, or its actual default-disabled/refusal evidence. CLI synthesis does not qualify the native provider.
- Independent semantic review matching the source/archive and all three receipt hashes.
- Actual synonym-search baseline0 and shared-graph passages, paired synthesis, configured provider/model, and bound saved outputs; the60–90second British-female-narrated story with readable captions, MP4/VTT/example ZIP and actual verification outputs.

References are relative paths, exact byte counts and SHA-256 hashes. The validator checks completeness and actual referenced bytes. It cannot replace the independent review of what an application did. Constructed unit-test records are validator inputs only and never enter the production registry.

## Protected CI publication

The approved release environment must already exist and have a selected **exact tag** deployment policy. This workflow does not create or modify it. Existing reviewer/custom rules remain enforced by GitHub; no new mandatory human or self-review restriction is imposed. A missing or unprotected environment refuses publication before the write job is scheduled.

Dispatch `release.yml` on the intended immutable stable tag, specifying the later reviewed main commit containing the admission data. The workflow checks out only `github.workflow_sha`, never that input commit. It verifies the workflow ref/tag/source, both source and admission ancestry on canonical main, and identical publication code in the tag and admission commit. It reads the fixed registry/evidence paths from the admission commit as data. This resolves the ordering between an earlier built candidate and later native evidence without rebuilding or retagging.

The admission job has read-only permissions. The protected publication job gets only the required repository `contents:write`/`actions:read` scope through the short-lived `GITHUB_TOKEN`. It re-downloads and revalidates the original artifact and evidence, then uploads that original archive, sidecar, qualification summary and checksums. No developer PAT, arbitrary checkout, `pull_request_target`, external publisher, local binary upload or tag-triggered automatic publication is used.

A retry never replaces existing assets. A complete existing release is verified anonymously without another upload. A partial, extra or mismatched release fails closed for investigation; there is no clobber/delete/rebuild route. Per-tag runs are serialized without cancellation. Actual unauthenticated response hashes and bytes are retained in CI, including failures.

After publication, the approved native GitHub URL installer checks and critical save/reopen/history/export/search replay remain mandatory per OS. Central catalogue admission is independently controlled by Nimbalyst maintainers; a GitHub release does not prove it. Keep the update/downgrade behavior explicit until tested.

## Local verification

Run the ordinary component build/package first, then:

```sh
python3 -W error -m unittest discover -s tests/release -v
actionlint .github/workflows/component-ci.yml .github/workflows/native-windows.yml .github/workflows/release.yml
```

For a read-only check against an already retained real archive, set `NIMBALYST_TEST_CANDIDATE` to its path; the original adjacent `.json` sidecar must exist. Tests use temporary files and a loopback HTTP server. The extra-member test derives a deliberately invalid archive from those actual bytes and preserves the original. These checks are release-infrastructure tests, not native-host or public-release acceptance.
