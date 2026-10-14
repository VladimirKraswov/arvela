# Reliability and product development — 2026-10-15

User approved all six improvements. Preserve running owner sessions, installed app,
external engines, GPU and private data. Work in source and isolated fixtures;
The owner subsequently authorized an overnight installation. Installation/publication remain separate acceptance boundaries.

## Deliverables and acceptance

1. Durable app-owned operation journal: SQLite native storage, explicit transitions,
   pre-POST durability, restart recovery without automatic duplicate delivery,
   visible history and reconciliation using public engine APIs. Keep engine
   transcripts in their own stores and attachment blobs outside preferences.
2. Performance: selective immutable snapshots, frame-batched streaming notifications,
   immediate interaction/error delivery, lazy heavy screens and measured regression
   budgets for large synthetic sessions.
3. Fault acceptance: executable interruption/storage/network/navigation scenarios
   in CI, with retained drafts/files and no duplicate POST as assertions.
4. Attention center: deduplicated current problems across chats, precise causes,
   navigation and working recovery actions, including uncertain delivery.
5. Skill quality: revision-bound baseline/candidate trials, explicit verified
   outcomes, comparison, guarded promotion and rollback through existing common
   skill ownership/CAS. No automatic rewriting based on untrusted history.
6. Updates: stable/preview channels, signed Tauri artifacts, background download,
   idle installation gate, app-data backup/recovery, repeatable release manifest
   tooling. Never manufacture an available update when the feed is absent.

## Evidence

Source acceptance: 808 frontend tests passed, 6 existing opt-in skips; 113 native tests passed and one OS-vault skip before the final artifact-verification test was added. Strict Clippy, TypeScript/Vite, dependency boundaries and whitespace checks passed. Final native acceptance and installation receipts are appended below.

Actual installed Pi CLI 0.85.1 with a synthetic loopback provider and isolated home:
Full wrote outside the fixture project without a prompt; Ask received two positive
confirmations; pending follow-up text was recovered; abort completed in 3 ms.
This does not call a cloud or local inference model. Real isolated Chromium proved
Full picker, Stop after OpenCode reconnect, journal-to-draft recovery, candidate
creation and the update UI. Ten thousand reducer text deltas took 4.9 ms and one
subscriber notification on this machine. Initial JS is 1,347,277 bytes before
compression (earlier baseline about 1,433 KB); settings load separately. This is
synthetic receipt/render evidence, not a model-speed claim.

## Use and recovery boundaries

- The header's attention button lists waiting requests/errors from loaded chats and
  a private delivery journal. Unconfirmed delivery is never replayed automatically.
  OpenCode reconciliation requires the exact original user-message ID. Pi cannot
  prove that ID through its public history; inspect that chat before resubmitting.
  Confirmed deliveries release their extra attachment copies. Uncertain/unsent
  copies remain private until recovered; original engine histories are unchanged.
- Settings → Quality of skills snapshots a user-owned common skill, including its
  helper files, and stages only a proposed SKILL.md. Hub/bundled immutable packages
  must first be copied to a user source. Trials start as drafts in new chats: choose
  the desired engine/model and send deliberately. Record a result from that chat
  after completion. Evidence requires an actual successful read of the exact skill,
  known model, measured duration and complete usage. Promotion requires three paired
  cases covering OpenCode and Pi with equal case/model/engine in each pair, verified
  candidate success, no extra errors, and at most 20% time/token regression.
  Source/snapshot revisions are checked again before applying or rolling back.
  In-progress promotion receipts recover after a crash. No owner skill was promoted,
  no live model comparison or automatic training is claimed by this release.
- Settings → Updates has stable/preview feeds. Download can happen during work;
  installation waits for UI and native engine idle checks. New native sends are
  blocked while backing up/installing. The updater checks a pinned public key **and
  signed version**, rejects unsigned/modified/version-substituted archives and caps
  downloads at 512 MiB. Missing feeds/network failure remain errors, not “up to date”.
- Backups in app-data `update-backups` contain preferences, drafts, queues and binary
  attachment copies (128 MiB limit). Before install the private operation SQLite
  journal is copied consistently; on Mac the current app bundle is also retained.
  Restore first backs up current data, merges attachment blobs without deleting new
  files, restores preferences and marks restored queue entries uncertain. The live
  delivery journal is never rolled back, protecting against duplicate sends.
  Agent transcripts, project files, model credentials and browser cookies remain in
  their existing stores; this is not a full computer or engine backup. Previous Mac
  binaries can be restored manually from the saved Arvela.app after quitting.
- Ordinary Quit stops this app's Pi process trees. It aborts OpenCode through public
  APIs only when the latest user turn matches the app's recorded ownership lease;
  it never kills an external server or a later foreign request. Unreachable aborts
  leave a private report in the attention center. Leases cover sends from this
  runtime; work started before installing this version has no ownership lease.
- General → Restart reloads the interface, keeping native agents/browser alive and
  reattaching actual status/dialogs. Replacing the binary requires idle installation;
  process/GPU jobs are not silently replayed.

## Repeatable signed release

Normal CI builds remain unsigned test packages. For a release, set
`TAURI_SIGNING_PRIVATE_KEY` (or use the CLI's private-key path) and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` through a private environment, then run
`npm run build:release:macos`. The public key is in `src-tauri/updater.pub`; the
private signing key must stay outside Git. Tauri generates `Arvela.app.tar.gz`
and its `.sig` with the version bound in the signature. Verify using
`ARVELA_VERIFY_ARTIFACT=/absolute/path/Arvela.app.tar.gz cargo test --manifest-path src-tauri/Cargo.toml verify_release_artifact -- --ignored`.
Generate the channel feed with `node scripts/update-feed.mjs stable darwin-aarch64 /absolute/path/Arvela.app.tar.gz`.
Publish that exact signed archive and signature to the matching GitHub release,
verify the downloaded bytes, then publish the feed. Preview follows the same flow
with `preview`; stable rejects prerelease versions. Public feeds never contain
private histories, backup data, model credentials or signing keys.

Updater signatures are separate from Apple code signing. This host has no Developer
ID identity; the Mac app is ad-hoc signed, so macOS may ask again for protected-folder
access. Catalog probes now use managed app data and disable extensions; real project
startup is bounded and reports folder/extension failure instead of hanging forever.
Windows/Linux live qualification was skipped at the owner's request.
