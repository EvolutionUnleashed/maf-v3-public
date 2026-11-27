# Security notes

## Intended boundary

MAF V3 is an account-free, single-workspace application. It is designed to bind to `127.0.0.1`, where only software on the same machine can reach it.

If you change `HOST` or publish the service through a reverse proxy, every person who can reach the app can use its configured providers, change local settings, read content, and incur provider spend. Put access control in front of the entire application before exposing it to a LAN or the internet. TLS alone does not restrict who can use it. The server refuses a non-loopback `HOST` unless `MAF_ALLOW_UNAUTHENTICATED_REMOTE=true` explicitly acknowledges this risk; that flag is not access control.

## Secrets

- API keys are stored only in the local application data, never browser storage.
- Saved keys are encrypted with AES-256-GCM.
- API responses never include a plaintext key.
- Desktop builds ignore generic ambient provider variables; deliberate `MAF_<CAPABILITY>_*` configuration still overrides saved settings. Source-server deployments also support generic provider variables.
- Never put keys in `VITE_*` variables, browser storage, source control, screenshots, or exported content.

For stable deployments, set `MAF_CONFIG_ENCRYPTION_KEY` through the host's secret manager. If it is omitted, preserve the generated `.config-encryption-key` alongside the encrypted settings during backups.

Changing the encryption key without first re-saving each secret makes the current encrypted settings unreadable. There is no recovery path without the old key.

The generated key file is co-located with the encrypted settings. This reduces accidental disclosure if only the settings file is copied, but it is not device-bound and does not protect against software running as the same operating-system user. When MAF performs work, it necessarily sends the capability's API key and relevant prompt, content, search query, or image prompt to the provider endpoint the user configured. That provider's privacy, retention, usage, and billing terms apply.

## Custom service URLs

Custom provider base URLs must use HTTPS. Plain HTTP is accepted only on loopback addresses for local development services. Embedded URL credentials and query strings are rejected.

## External content

Web pages and provider responses are untrusted input. Research is bounded, source text is separated from instructions, and fetched content is not allowed to redefine the task. Review generated claims and citations before publication.

## Media

Generated and uploaded media is copied into `MAF_DATA_DIR/media` and served from `/media`. Path traversal is rejected. When the app is exposed beyond loopback, protect media routes with the same upstream access control as the rest of the application.

## Operational checklist

- Keep `HOST=127.0.0.1` unless upstream access control is ready.
- Set provider-side spend limits and alerts.
- Back up the application data directory, including its SQLite database and encrypted settings.
- Move dependency updates through the seven-day quarantine and full release gate below.
- Run `pnpm security:verify`, `pnpm check`, `pnpm test`, and `pnpm build` before deploying changes.

## Dependency and release security

The installer is the supported end-user distribution. Recipients do not need Node.js,
npm, pnpm, Rust, or a compiler. npm packages are used only by maintainers in the
controlled build pipeline.

Maintainer installs are fail-closed:

- the exact pnpm package-manager bootstrap is verified for npm publish age, integrity,
  and pinned native Linux/Windows archive SHA-256 before download;
- every exact direct and transitive npm version must have been published at least
  10,080 minutes (seven full days) before installation;
- registry publish times, SHA-512 integrity, and npm registry origin are independently
  checked before `pnpm install`;
- missing or invalid registry time/integrity data fails the build;
- dependency lifecycle scripts are denied unless explicitly reviewed in
  `allowBuilds`; and
- GitHub Actions are pinned to immutable full commit SHAs.

The Tauri/Rust build follows the same fail-closed model: `Cargo.lock` is mandatory,
crate sources/checksums and seven-day publish age are independently verified before
fetch, builds use `--locked`, and RustSec advisories fail CI.

Windows packaging tools are also outside the npm and Cargo lockfiles. The build uses a
repository-local Tauri cache populated only from the exact reviewed URLs, byte sizes,
and SHA-256 values in `security/tauri-tools.json`. The complete extracted NSIS/WebView2
tree is hashed before and after bundling, and the Microsoft WebView2 bootstrapper must
have a valid Microsoft Authenticode signature. The bundled Node 24.18.0 executable must
retain the valid OpenJS Foundation signature from the SHA-256-pinned official archive.
It is never re-signed or otherwise changed after the runtime manifest is created.

The Windows installer also contains deterministic `THIRD-PARTY-NOTICES.txt` coverage
for every package in the frozen pnpm store and every crates.io package in `Cargo.lock`.
The notice is generated offline from fetched published sources, copied into the
application runtime, and checked by the runtime's SHA-256 manifest before startup.

The seven-day rule applies to the exact installed version. Publishing another version
or editing unrelated registry metadata does not reset its age. Mature versions still
must pass integrity, origin, advisory, and test checks. Age is not proof of safety.

The owner accepts unsigned Windows distribution for this as-is community handover.
Unknown-publisher warnings are expected; this is not an exclusion for malware findings,
broken functionality, unsafe downloads, or compromised dependencies. Users must obtain
the installer from Evolution Unleashed's trusted handover channel. Checksums detect file
changes but do not independently authenticate an unsigned publisher. Some Windows
Smart App Control or managed-device policies may block unsigned apps without an override;
users must not disable protection or ignore actual malware detections to install MAF.

Paid GitHub Code Security and private artifact attestations are not release requirements.
The manually triggered Windows build retains free dependency audits, exact-version
quarantine, checksum verification, tests, and a separate clean-install smoke job.
Only a successfully smoke-tested artifact is eligible for handover. Include SHA-256
checksums, third-party notices, license, source commit, and the quick-start guide.

MAF does not contain a background updater. A maintainer publishes each reviewed Windows
x64 update as a new installer, and the user chooses when to install it. The
clean-install release gate verifies in-place reinstall and data retention before release.

See [RELEASE-SECURITY.md](RELEASE-SECURITY.md) for the complete maintainer process.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting or a private security advisory for
this repository. Do not open a public issue that includes an exploit, API key, user
content, or other sensitive details. Revoke any exposed provider key immediately and
include only the minimum reproduction data needed to investigate.
