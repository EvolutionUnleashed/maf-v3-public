# Windows handover verification

Verified locally on 15 September 2026. This records observed results, not a warranty
or a claim that every provider, model, or Windows configuration has been tested.

## Installer evidence

- Built the current-user Windows x64 NSIS installer with the pinned toolchain.
- Installed into a clean MAF application/data state on the maintainer's Windows PC.
- Launched the installed desktop window and its bundled Node backend successfully.
- Verified all SQLite migrations, the initial workspace, four BUILD sections and
  ten steps through the installed native SQLite module.
- Verified single-instance behavior and backend shutdown with the desktop window.
- Reinstalled and restarted; a database marker and durable workspace bytes persisted.
- Uninstalled; application files, Start shortcut and registration were removed,
  while durable workspace bytes were retained. Removed only generated QA data.
- Reinstalled for visual inspection: API Integrations is the first-run screen,
  provider/key guidance is visible, and an empty key produces an actionable error.
- Runtime integrity validation remained enabled throughout these tests.

The real installation test exposed and fixed Node startup failure on Tauri's
verbatim Windows paths (`\\?\C:\...`). A native regression test now checks the
process arguments, working directory, environment paths and loader-variable removal.

## Automated verification

- TypeScript check passed.
- 122 tests across 13 files passed, including real SQLite BUILD-to-Ideas-to-CREATE,
  repurposing, archive/restore, interrupted work, provider errors and key-edit state.
- Two Windows Rust tests passed; the native application compiled successfully.
- Production frontend/server build passed.
- Packaged runtime copied outside the repository passed SQLite, native canvas and
  real PDF text extraction checks with external network access prohibited.
- Real DOCX uploads exercised Mammoth and the patched XML parser; malformed and
  empty documents were rejected clearly.
- Development frontend routes and the package-script database migration passed
  using isolated local test data, without provider requests.
- All 459 locked npm versions passed live exact-version age, origin and integrity
  checks before installation. The pinned pnpm bootstrap passed equivalent checks.
- All 472 locked Cargo versions passed live age, checksum and non-yanked checks.
- The final npm audit reported no known vulnerabilities, including low severity.
- Generated and checked deterministic notices for 348 installed npm packages and
  472 Cargo versions. Verified official Node and WebView2 signatures and pinned
  bundler-tool checksums.
- Workflow YAML, PowerShell parsing, repository policy checks and whitespace checks
  passed. Release tests now fail independently rather than being masked by later
  successful commands.

The seven-day rule applies to the exact version being installed. Unrelated new
versions or registry metadata edits do not reset its age. Age is an additional
precaution, not proof that a dependency is safe.

## Limits and remaining external validation

- Provider adapters were tested with controlled responses, not paid customer API
  calls. No customer key was used. Each recipient must run Save & test with their
  own account, and check provider billing, available models and image permissions.
- Official documentation confirms the existing [GPT-5.6 Luna preset](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
  and [GPT Image 2 preset](https://developers.openai.com/api/docs/models/gpt-image-2).
  These remain editable; documentation does not establish any particular account's access.
- The local install test used a Windows PC with WebView2 already available, not a
  newly provisioned virtual machine. The manual GitHub Windows workflow provides
  a separate no-checkout installation job. Its result must be checked per build.
- Rust advisory dependencies were upgraded; the free GitHub RustSec job remains
  a separate release gate. Local source/compile checks do not replace that audit.
- This installer is unsigned. Normal publisher/reputation warnings are expected;
  malware detections, integrity errors and enforced device policies are not errors
  users should ignore. See QUICK-START.md.
- No macOS installer, automatic updater, hosted-data migration or offline AI model
  is included. Provider services can change after this handover.

The private-repository paid dependency-review workflow was removed. Free dependency
audits, age/integrity gates, tests and installation verification were retained.
