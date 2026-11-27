# Run MAF V3 on your computer

This guide runs the archived source release as a local web app. MAF creates its
SQLite workspace on first use. Your chosen AI providers charge separately for API usage.

## 1. Download and run the app

On the repository page, choose **Code → Download ZIP**, then extract the ZIP and
open the folder containing `package.json`.

If you use an AI tool that can run commands on your computer, open the folder in that
tool and give it this instruction:

> Get MAF V3 running as a local web app using Node 24 and pnpm 11.16.0. Install the
> locked dependencies with `pnpm install --frozen-lockfile`, then run `pnpm build`
> and `pnpm start`. Give me the local address to open in my browser.

To run it yourself, install Node.js 24 and pnpm 11.16.0, then open a terminal in
that folder and run these commands in order:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

Open the address printed in the terminal, usually `http://127.0.0.1:3000`.
Leave the terminal open while you work. Press **Ctrl+C** to stop the app. Next time,
run `pnpm start` from the same folder.

## 2. Connect your AI provider

New to API keys? Download the [illustrated HTML setup guide](API-KEY-GUIDE.html) and
double-click it to open in your browser. It walks through setup, costs and keeping
keys private. You can also use the [text guide](API-KEY-GUIDE.md) or
[printable PDF](output/pdf/MAF-V3-API-Setup-and-Safety-Guide.pdf).

Open **API Integrations**. **Intelligence** is the only required connection.

1. Choose a provider/preset. Follow its official API-key link to create a key and
   enable provider API billing if needed. A chat subscription does not necessarily
   include API access or balance.
2. Paste the key into MAF and select a model your provider account can use. Leave the
   preset endpoint unchanged unless deliberately using a compatible service.
3. Choose **Save & test** and wait for success. This sends a small real request and
   may incur a provider charge. Saving alone does not confirm the connection works.
4. Add **Tavily** for optional web research or an **Images** provider if wanted.
   Image tests check credentials/model access without creating a paid image; actual
   generation can still require extra provider approval. Both features can be skipped.
5. Choose **Continue setup**, then start BUILD. Return to API Integrations any time
   to change keys. A changed key, model, or endpoint needs a fresh test.

Keys are encrypted locally and masked after saving. Your key and relevant task data
are sent to the selected provider during requests. Check its privacy/billing terms and
set spending limits or alerts. Compatible endpoints must support the requested
chat/structured-output or image API; not every model implements those capabilities.

## 3. Build, create, repurpose

Complete **BUILD** with your business information. Review and approve each step to
unlock the next. The offer step accepts your own written input. Save drafts to resume
later. Editing earlier approved work can mark later steps for review; reapprove them
before creating new content.

Use **Ideas** for topics, then **CREATE** to write from that foundation. MAF reviews
and refines drafts privately; you see progress and the result, not its internal critique.
Check generated facts before publishing. Without Tavily, research uses your supplied
information, not current web data.

Choose **Repurpose** after generation, or reopen an item in **Library**. Use **Load
older content** for earlier work. Archived items can be restored. Optional image failures
preserve completed text; partial repurposing preserves successes and lets you retry
failed platforms. Several AI calls can run per action. Visual Identity may generate
twelve images and can be skipped. Failed calls can still be billed by the provider.

Saved content remains on your computer without internet. New AI work requires a working
internet connection, provider key, and provider balance; MAF is not an offline AI model.

## Troubleshooting

- **Invalid key:** check the selected provider, create a key on its official API site,
  paste it again, and run Save & test.
- **Model unavailable/access denied:** choose an accessible model; some image models
  require additional provider verification or approval.
- **Quota/billing/rate limit:** check provider billing, usage limits and balance. Wait
  before retrying rate limits. MAF cannot add balance to a provider account.
- **Timeout:** check your connection, then retry. Consider a smaller task or faster model.
- **Unreadable document:** use a text-based PDF, DOCX, TXT or Markdown file, or paste
  the text. Scanned PDFs need OCR elsewhere; old `.doc` files are unsupported.
- **Startup failure:** check the terminal for the exact error. Confirm that you
  ran the commands in the folder containing `package.json` and that the build finished.

## Backups

Stop the app, then copy the whole `data` folder from the extracted project to a
private backup location. If you set `MAF_DATA_DIR`, back up that folder instead.
Keep the database, media, encrypted settings and encryption key together.
Encryption reduces accidental disclosure, not attacks by software running as your
Windows user. Treat a complete backup as private.

Earlier hosted/MySQL data is not imported automatically. MAF is provided under
the included MIT license, without warranty, updates or support. Provider services may change.
The MIT license includes its liability disclaimer, subject to applicable law.

Copyright (c) 2026 Evolution Unleashed and Stu Jordan. If you copy or share the
software, keep the copyright and MIT permission notices with it.
