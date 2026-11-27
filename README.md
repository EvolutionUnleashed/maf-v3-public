# MAF V3

MAF V3 is a local content-strategy workspace. This is the archived source release,
provided as is, without updates or support. You can run it on your computer and
use your own AI provider account to research, plan and draft content.

Choose **Code → Download ZIP**, extract it, and follow the [quick start](QUICK-START.md)
to run the app in your browser. The download contains the source code and guides.
This archive has no desktop installer.

The 15 November 2026 dependency audit reported unresolved security advisories in the
locked dependencies. Keep the app on your own computer at its default loopback address.

## Copyright, licence and preview status

Copyright (c) 2026 **Evolution Unleashed and Stu Jordan**. Released under the
[MIT License](LICENSE). Copyright remains with the copyright holders. You may use,
modify and redistribute the software, including commercially, provided you retain
the copyright and permission notices in all copies or substantial portions. MIT
does not require separate promotional credit or permission to reuse the code.
Third-party components retain their own licences and notices.

This research preview is provided **AS IS**, without warranty or any promise of
support, continued maintenance, fitness for a particular purpose or uninterrupted
provider access. The MIT License disclaims liability to the extent permitted by
applicable law; nothing here overrides rights or liabilities that cannot legally
be excluded. You are responsible for provider charges, protecting your keys and
backups, and checking generated content before using it.

## API connections

Start with the [illustrated HTML setup guide](API-KEY-GUIDE.html) for beginner-friendly
key creation, setup, costs, privacy, troubleshooting and lost-key instructions.
Download that single file and double-click it to open in your browser. The guide works
offline; provider websites and AI features need internet. It never collects API keys.
An [editable text version](API-KEY-GUIDE.md) and a
[printable PDF](output/pdf/MAF-V3-API-Setup-and-Safety-Guide.pdf) are also included.

MAF uses bring-your-own-provider keys. Intelligence is required for BUILD and CREATE; web search and image generation are optional.

| Capability   | Supported providers                  | What to enter                                                                |
| ------------ | ------------------------------------ | ---------------------------------------------------------------------------- |
| Intelligence | OpenAI/compatible, Anthropic, Gemini | Provider, API key, and model; built-in presets fill standard endpoints       |
| Web search   | Tavily                               | Tavily API key                                                               |
| Images       | OpenAI/compatible, Gemini            | Provider, API key, and image model; built-in presets fill standard endpoints |

The Settings screen links directly to each provider's official key page and tests the saved connection. A custom OpenAI-compatible endpoint can also be used. Non-loopback custom endpoints must use HTTPS.

Stored copies of API keys stay in the local application data. They are encrypted with AES-256-GCM, are never returned to the interface after saving, and appear only as a short masked hint. During a request, the relevant key and task data are sent only to the configured provider endpoint over HTTPS. Provider privacy, retention, usage, and billing terms apply, so provider-side spend alerts are recommended.

## What is included

- BUILD workflow for market, audience, offer, brand, and strategy artifacts
- Standalone Idea Generator grounded in approved BUILD work
- CREATE workflow with an internal draft, adversarial review, refinement, and final-check pipeline
- Content library with immediate post-generation repurposing
- Optional Tavily research with source links
- Optional visual identity and platform images
- Encrypted local API settings and durable local media

The critic's review and score remain internal. Users see progress and the refined result, never the hidden review text.

## Local data and backups

When running from source, your private application data is in the `data` folder
inside the extracted project by default. It contains:

- `maf-v3.sqlite`, which stores BUILD artifacts and content;
- encrypted API settings and their local encryption key;
- uploaded files and generated images; and
- a local diagnostic log with sensitive lines redacted for support exports.

Close MAF V3 before copying the complete data folder as a backup. Preserve the folder as one unit. Losing the generated encryption key makes saved API settings unreadable, but does not expose those keys. The generated key is stored beside the encrypted settings, so this protects against casual disclosure or copying one file; it is not a defence against software already running as the same Windows user.

Back up the data folder before moving or replacing the extracted project.

## Research behavior

When Tavily is configured, BUILD Market Intelligence adds bounded web sources and requires linked citations. Search results are treated as untrusted reference text and cannot override MAF's instructions.

Without Tavily, BUILD synthesizes the information the user supplied. It labels that work as input-based synthesis and is instructed not to invent current market figures, trends, or citations.

## Provider spend

MAF has no internal credits or quotas. Connected providers bill the user directly. Some actions intentionally make several calls: CREATE uses drafting plus private review and refinement, repurposing runs once per selected platform, and a full Visual Identity tournament creates twelve images. The interface identifies this before running it, and Visual Identity can be skipped.

## Maintainer checks and Windows packaging

The original release process used the following checks for Windows packaging.
For a local browser session, use the [quick start](QUICK-START.md).

The repository pins exact dependency and tool versions. Before any dependency installation, the release gate independently confirms that every selected direct and transitive npm version has been published for at least seven full days, matches the npm registry's SHA-512 integrity, and comes from the allowed registry. Dependency lifecycle scripts are denied unless explicitly allowlisted.

The seven-day rule applies to each exact locked version, including transitive packages.
New versions or unrelated metadata edits do not reset an unchanged version's age.
This delay reduces exposure to newly compromised releases; it is not proof of safety.

```bash
node scripts/security-verify-bootstrap.mjs
node scripts/security-verify-config.mjs
node scripts/security-verify-lock.mjs
node scripts/security-verify-cargo-lock.mjs
pnpm install --frozen-lockfile
pnpm audit --audit-level=high
pnpm check
pnpm test
pnpm build
```

The Windows candidate workflow also prepares a SHA-256-pinned local Tauri NSIS and
WebView2 tool cache, verifies the official OpenJS signature on the bundled Node runtime,
and installs the finished candidate on a fresh Windows runner to prove the packaged
runtime, first-run window, SQLite migrations, and uninstaller work without source files
or a pre-existing `node_modules` directory.

The web server binds to `127.0.0.1` by default. The desktop shell additionally uses a random per-launch token and an HttpOnly session cookie so unrelated local web pages cannot call its API. See [SECURITY.md](SECURITY.md) and [RELEASE-SECURITY.md](RELEASE-SECURITY.md) before building or distributing an installer. The manual **Build Windows handover installer**
workflow publishes a separate `MAF-V3-Windows-tested-<commit>` artifact only after its
fresh-machine smoke job passes; distribute that tested package, not the intermediate
`windows-unsigned-<commit>` candidate. Paid GitHub security features are not required.

## Updating an earlier edition

MAF V3 uses a local SQLite workspace. It does not connect to an earlier hosted or MySQL database automatically. Preserve the old system before selectively importing any content. See [MIGRATION.md](MIGRATION.md).
