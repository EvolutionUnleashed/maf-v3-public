# Release security

This maintainer guide covers the Windows community handover. Recipients install the
application; they do not run npm, pnpm, Cargo, or build commands.

## Release boundary

The owner accepts unsigned, as-is distribution. A paid GitHub Code Security license,
private artifact attestations, or signing subscription is not required. This does not
waive dependency, integrity, functional, or installation failures.

The manual **Build Windows handover installer** workflow has two stages:

1. Build a candidate with reviewed dependencies, tests, production runtime, legal
   notices, SPDX SBOM, commit metadata, user instructions and SHA-256 checksums.
2. Download that candidate on a separate Windows runner with no checkout, npm install,
   or pre-existing application dependencies. Verify every checksum, then install,
   launch, test SQLite, reinstall, check persistence and uninstall/data retention.
   Only after success upload **MAF-V3-Windows-tested-&lt;commit&gt;** for handover.

The intermediate **windows-unsigned-&lt;commit&gt;** artifact is not installation-tested.
A failing smoke job must never be treated as a successful release. There is no automatic
GitHub Release publication or background updater.

Unsigned installers do not authenticate the publisher. Checksums detect byte changes,
but a checksum delivered beside a replaced executable is not independent proof of origin.
Use the owner's trusted handover channel. Explain expected unknown-publisher warnings,
and stop for malware detections or integrity errors. Smart App Control, S mode, and
managed-device policies can prohibit unsigned apps. Do not instruct users to disable
protection. See [Microsoft's documentation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

## Exact-version seven-day quarantine

Every direct and transitive npm version must have been published for at least 10,080
minutes before installation. The rule applies to the exact selected version, not a
package's latest publication or metadata modification. New unrelated releases do not
reset a frozen version's age. No age exclusions are permitted.

Before installation, the dependency-free lock verifier queries the official npm registry
and fails closed on missing/invalid publication dates, too-young versions, SHA-512
integrity drift, unapproved tarball origins, redirects, or unavailable metadata.
Its --report option emits a version-policy JSON report on success and exits nonzero
on any failed check. Evidence is time-specific; rerun live verification for each build.

pnpm-workspace.yaml also enforces minimumReleaseAge, strict missing-time handling,
trustLockfile: false, exact saves, frozen installs, no exotic transitive sources,
store integrity, and refusal to auto-repair node_modules when running scripts.
trustPolicy: no-downgrade retains only the reviewed historical exact-version exception
semver@6.3.1. This is not an age or integrity exception.

The pnpm 11.16.0 bootstrap is checked separately before download: exact reviewed npm
identity/publish date/integrity/tarball, seven-day age, official GitHub release identity,
and pinned native Linux/Windows archive size/SHA-256. The SHA-pinned setup action
validates downloaded bytes. No range, latest tag, or npm global install is required.

Only @tailwindcss/oxide, better-sqlite3, and esbuild may run reviewed lifecycle scripts.
New or unknown scripts fail installation. Never enable all builds or automatically
approve new scripts. Review a proposed package, exact version and script purpose first.

Seven days is a containment delay, not evidence that a dependency is safe. Continue
checking advisories and source changes; maintain credential hygiene during builds.

## Rust and native dependency controls

Cargo.lock is committed; builds/fetches use --locked. Dependency declarations use exact
registry pins, with no git/path/alternate registry dependencies. Rust is pinned to
1.97.1 for x86_64-pc-windows-msvc; the crate MSRV is 1.88 to accommodate patched time/plist.

The Cargo verifier checks all locked crates against crates.io: exact version, SHA-256,
at least seven days of publication age, and no yanked versions. Missing or invalid
metadata fails. Requests respect crates.io's rate limit. Only the local application
may omit a registry source/checksum. RustSec audit remains a free CI release gate.

plist 1.10.0, quick-xml 0.41.0 and time 0.3.47 replace the previously flagged parser
dependencies. This is an upgrade, not an advisory suppression. Review future advisories
against both the complete lockfile and the Windows target's reachable dependencies.

## Windows packaging integrity

Tauri uses the repository-local tool cache. security/tauri-tools.json pins official
HTTPS URLs, sizes and SHA-256 for NSIS 3.11, nsis_tauri_utils 0.5.3 and the embedded
Microsoft WebView2 bootstrapper. The preparer checks permitted redirect hosts, hashes
the extracted tree, and verifies Microsoft's signature. Run -VerifyOnly after bundling
to reject any changed, removed or added cache file. Do not substitute mutable URLs.

The bundled official Node 24.18.0 archive is SHA-256 pinned; node.exe retains its OpenJS
Foundation Authenticode signature. Never re-sign or mutate runtime files after preparing
the integrity manifest. The native build embeds that manifest's hash, which binds the
app tree, Node binary, native SQLite/canvas modules and legal notices. Startup verifies
it and refuses changed files or symlinks. This integrity binding is not a publisher signature.

desktop-prepare.mjs packages the application without depending on the source checkout.
The isolated runtime smoke test exercises native SQLite, canvas, the local PDF worker
and actual PDF extraction with network disabled and ambient loader overrides removed.
The finished NSIS installer targets the current user and includes its own Node runtime.

## Legal notices and user data

security-generate-notices.mjs works offline on the installed frozen pnpm store and fetched
Cargo sources, including target-specific crates. It checks identities and legal-file
paths, retains license text, and fails on missing sources or legal metadata.
Its --check mode verifies deterministic output.

The installer includes LICENSE.txt, THIRD-PARTY-NOTICES.txt and Node's complete license.
An identical notice is inside the integrity-bound runtime. Both copies must match.
Esbuild legal comments are preserved.

The installation smoke uses only a fresh account/state. It checks the first-run window,
embedded database migration and seeded workspace, records a QA marker, and proves
restart/reinstall preserve it. It hashes durable data before uninstall and checks that
uninstall retains it unchanged. Refuse to run against pre-existing user state.
Only explicitly identified generated QA data may be cleaned up.

## Maintainer commands

Use the pinned pnpm and Rust versions on a Windows x64 build host with Visual C++ tools
and Windows SDK. End users need none of these tools.

```powershell
node scripts/security-verify-bootstrap.mjs
node scripts/security-verify-config.mjs
node scripts/security-verify-lock.mjs
node scripts/security-verify-cargo-lock.mjs
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm desktop:release
# On a fresh Windows account/machine, never over a user's installation:
.\scripts\desktop-install-smoke.ps1 -InstallerPath "<exact setup.exe>" -AllowUnsigned
```

desktop:release defaults to unsigned. It checks/tests/builds and always prepares the
current runtime. Its historical -SkipPrepare flag no longer skips preparation.
A signing config is optional, explicit, and requires valid resulting signatures.
Never expose signing credentials to pull requests or dependency-install scripts.

## Actions and handover checklist

- Pin every third-party action to a full commit SHA; never use pull_request_target
  to execute contributor code.
- Use read-only content access, no persisted checkout credentials, no signing secrets
  or privileged shared caches for builds. RustSec may write its check result only.
- Resolve action updates through official upstream metadata and inspect source.
- Review manifest/lock/configuration diffs before downloading changed dependencies.
- Pass npm/Cargo verification, advisory audits, type checks, tests, production build,
  isolated runtime smoke, native checks/tests and clean installation tests.
- Include the tested setup.exe, QUICK-START.md, LICENSE, notices, BUILD-INFO.txt,
  SHA256SUMS, and CI-generated SPDX SBOM.
- Report which providers were tested live versus mocked. Without provider credentials,
  tests establish protocol/error handling, not that every paid account/model will work.
- Give the owner the exact commit and verification results. Do not label failed checks
  as harmless Windows publisher warnings.

## References

- [pnpm dependency policy](https://pnpm.io/settings)
- [RustSec advisories](https://rustsec.org/)
- [crates.io data access](https://crates.io/data-access)
- [Tauri bundler source](https://github.com/tauri-apps/tauri/tree/tauri-cli-v2.11.4/crates/tauri-bundler)
- [GitHub secure use of Actions](https://docs.github.com/en/actions/reference/security/secure-use)
