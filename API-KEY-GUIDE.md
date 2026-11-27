# MAF V3 API setup and safety guide

Connect your own AI services, understand the costs, and keep your keys private. This guide is for the Windows desktop **research preview**. You do not need to code, install npm, or edit any files.

**Start with one Intelligence connection. Web search and Image generation are optional. You pay your chosen providers for chargeable usage. Never share your API key.**

## 1 Understand what you are connecting

An **API** (Application Programming Interface) is a way for two programs to talk to each other. When you ask MAF to write something, it sends a request to your chosen AI service and brings the answer back.

An **API key** is a private access pass linked to your provider account. Someone with your key could use your allowance or run up charges. Treat it like a password connected to your wallet. It is not your account password, a MAF licence code, or your email address.

A **provider** is the company supplying the service. A **model** is the particular AI you choose from that provider.

| MAF connection   | What it does                                     | Do you need it now |
| ---------------- | ------------------------------------------------ | ------------------ |
| Intelligence     | Business analysis, ideas, writing and refinement | Yes, for AI work   |
| Web search       | Current web research through Tavily              | No                 |
| Image generation | Creates images when requested                    | No                 |

MAF itself has no login or internal credit balance. You will sign in to the provider's website to manage its account, billing and keys. Existing MAF purchases do not pay these provider bills. API-key usage has its own pricing; do not assume a ChatGPT, Claude or Gemini chat subscription pays for MAF requests. MAF uses API keys, not your chat subscription sign-in. See [OpenAI's distinction between subscription and API-key usage](https://learn.chatgpt.com/docs/pricing).

### Before you spend

1. Check the provider's current API prices. Some offer a limited free allowance, but do not assume everything is free.
2. Choose a small starting balance or spending limit that you are comfortable with. Set usage alerts where available.
3. Check whether a setting is an **alert** or a **hard spending limit**. An alert tells you about spending; it does not stop it. Even hard limits can have a short enforcement delay. [OpenAI explains its spend controls here](https://developers.openai.com/api/docs/guides/spend-limits).
4. Leave automatic top-ups off unless you deliberately want them. If enabled, they can charge your payment method again when your balance runs low.
5. After your first small task, check the provider's usage dashboard before doing more.

There is no fixed price per post. AI text is commonly billed in **tokens**, small pieces of text the AI reads and writes. Prices vary by model and task; check the [current OpenAI API prices](https://developers.openai.com/api/docs/pricing) if using OpenAI. MAF can make several requests for one action, including drafting and refinement. Regenerating, repurposing and images can add costs. A failed task does not necessarily mean there was no charge. Visual Identity can create **12 images**; skip it while learning.

## 2 Create your first API key

Use OpenAI for the walkthrough below if you do not already have another supported provider. This is an example, not a requirement or a promise that it is cheapest. Alternative providers are listed in section 4.

1. Open [OpenAI's API platform](https://platform.openai.com/). Sign in or create your own account. This is the API platform, not the ChatGPT conversation screen.
2. Open [API billing](https://platform.openai.com/settings/organization/billing/overview). Follow the account's instructions to enable API usage and add funds or a payment method if required. Read any minimum payment, expiry and recharge terms before paying.
3. Open [API keys](https://platform.openai.com/api-keys). Select the project you want to use, or create a separate project called **MAF V3** if offered. A project groups related usage and settings.
4. Choose the option to create a new secret key. Name it **MAF V3 on my PC** so you can recognise it later. Use a normal project key, not an Admin key. Where permissions are offered, allow only the functions you need. A read-only key cannot generate content.
5. Copy the complete secret key. If you want to retain a copy, put it in a trusted password manager, not a screenshot or shared document. Providers may show the full secret only once. Record any expiry date so you can replace it before it stops working.
6. Return to MAF and follow section 3. You do not need the programming or terminal commands shown in provider developer tutorials.

Never send the key to Evolution Unleashed, a helper or an AI chat. If someone or an agent is guiding you, enter the key yourself and pause screen sharing or recording while it is visible. Official background: [OpenAI API setup](https://developers.openai.com/api/docs/quickstart) and [key safety guidance](https://developers.openai.com/api/docs/guides/production-best-practices).

## 3 Enter the key in MAF

Open **MAF V3** from the Windows Start menu. First launch takes you to **API integrations**. If you are on the dashboard, choose **Integrations** to return there.

1. Find the **Intelligence** card.
2. For an OpenAI key, set **Provider** to **OpenAI or compatible**, then choose **OpenAI preset**.
3. Leave **Base URL** at `https://api.openai.com/v1`. This is the address receiving your requests and key. Never replace it with an address supplied by a stranger.
4. Check **Model**. The preset fills this in. Use that model if your account has access, or enter an available, compatible text model from your provider. Model names and availability can change.
5. Click **API key** and paste the complete key. Do not include quotation marks, an example command or extra spaces. On Windows, paste with **Ctrl + V**.
6. Make sure **Enable this capability** is on.
7. Choose **Save & test** once and wait. **This sends a real request and may incur a small provider charge.**
8. Look for **Verified** on the Intelligence card. Then choose **Continue setup** and follow the setup checklist into BUILD.

**Success means Verified.** Only Intelligence needs to be verified to begin; the other two cards can remain unconfigured. A saved key alone is not enough. **Configured, test needed** means the connection still needs a successful test. If you see an error, use section 6 instead of repeatedly clicking.

After saving, the key box clears and only a masked hint remains. This is normal: MAF does not display the full saved key again. You do not need to paste it every time you open MAF. Changing the provider or address can clear the draft key; enter the key for the newly selected service. Changing a key, model or address requires a fresh **Save & test**.

## 4 Add other services only when you want them

### A different Intelligence provider

Create a key in the provider's official account, check its billing, then use the same paste, enable and **Save & test** steps. Each provider issues its own keys; an OpenAI key is not a Tavily or OpenRouter key.

| Service          | Where to get the key                                                               | What to choose in MAF                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Anthropic Claude | [Claude Console key instructions](https://platform.claude.com/docs/en/get-api-key) | **Anthropic**. Use a key scoped to one workspace. Leave Base URL blank.                                 |
| Google Gemini    | [Google AI Studio](https://aistudio.google.com/apikey)                             | **Gemini**. Create a key for your project. Leave Base URL blank.                                        |
| OpenRouter       | [OpenRouter keys](https://openrouter.ai/settings/keys)                             | **OpenAI or compatible**, then **OpenRouter preset**. Use an OpenRouter key and a supported text model. |

MAF also has **Get a ... key** links beneath its key fields. Provider screens may change. For Gemini, follow Google's [key setup](https://ai.google.dev/gemini-api/docs/api-key) and [billing instructions](https://ai.google.dev/gemini-api/docs/billing). For OpenRouter, see its [official setup guide](https://openrouter.ai/docs/quickstart). Not every compatible service or model supports everything MAF needs. **Custom endpoint** is an advanced option; leave it alone for normal setup.

### Optional web search

In **Web search**, choose **Tavily** and follow **Get a Tavily key** to [Tavily's dashboard](https://app.tavily.com/home). Create your account and copy its API key. Back in MAF, paste it, leave **Model** and **Base URL** blank, enable the capability and choose **Save & test**. Wait for **Verified**. Testing uses a real search request and may use your allowance or incur a charge. Review [Tavily's current pricing](https://docs.tavily.com/documentation/api-credits).

You can skip Tavily. Without it, MAF works from the information you supply rather than current web research.

### Optional image generation

In **Image generation**, choose **OpenAI or compatible** with **OpenAI preset**, or **Gemini**. Add that provider's key and an image-capable model, enable the capability and choose **Save & test**. This card is separate from Intelligence; its key is not copied automatically.

The image test checks credentials and model access without creating a billable image. **Verified does not guarantee a paid image request will succeed**: your provider may require extra approval or billing. Actual image generation can cost money. Leave images unconfigured if you only want text.

## 5 Keep your key and your information safe

### Never do these things

- Never paste a key into an AI chat, email, support ticket, social post or GitHub issue. That includes an agent helping you install MAF.
- Never include it in screenshots, recordings, shared documents, source code or a public repository.
- Never type it into an unfamiliar website, a key checker or a tool sent by a stranger. Use MAF's intended **API key** field and your provider's official website.
- Never share, borrow or buy someone else's key. Use your own account and a separate key for MAF.
- Never disable antivirus or bypass an actual malware or integrity warning to make MAF work.

Use a strong provider-account password and two-factor authentication where available. Keep Windows and your security software updated. After pasting, copy a harmless word to replace the key on your clipboard. If clipboard history is enabled, press **Windows + V** and delete the key entry, including any pinned copy. Keep only the access permissions you need; do not use an administrator key.

### What stays local and what leaves your computer

MAF saves your work on your computer and encrypts saved API keys locally. This does **not** protect them from every attack. Someone or malware with access to your Windows account or complete backup may still obtain them. Protect your computer and backups; do not share the entire app data folder for troubleshooting.

When you use AI, relevant business information, prompts or content go to your selected provider. Tavily receives search queries; an image provider receives image prompts. A desktop app is not the same as offline AI. Only submit material you are entitled to share, and check the provider's privacy and retention terms. Free and paid plans can have different data terms.

### If a key is exposed or stolen

1. **Revoke or delete it immediately on the provider's official API-key page.** This stops future use of that key, including by MAF. Deleting a message or screenshot is not enough.
2. Check recent usage and billing. Contact the provider about anything you do not recognise.
3. If your computer or account may be compromised, secure it before creating or entering a new key. Use a trusted device to manage the provider account.
4. Create a replacement key, paste it into the affected MAF card and choose **Save & test**. Replace it in every card or other app that used the old key.

**Clear key** removes MAF's saved copy; it does not revoke the provider key. To pause a connection, turn off **Enable this capability** and click **Save disabled**. To retire it, revoke it with the provider as well. Uninstalling MAF does not cancel provider plans, revoke keys or remove the retained workspace. Manage billing and auto-recharge on the provider's website.

## 6 Fix common setup problems

| What you see                         | What to do                                                                                                                                                            |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid key or authentication failed | Check that the key belongs to the selected provider. Copy it again without extra text. If it expired, was revoked or is lost, create a replacement.                   |
| Quota, balance or billing error      | Open the provider's billing and usage pages. Check funds, limits and API access. A chat subscription is not proof of API balance. Repeated retries will not fix this. |
| Model not found or access denied     | Check the exact model name and your account's access. Some image models need additional verification. Use a compatible model; do not guess names.                     |
| Rate limit or timeout                | Wait before trying again. Check your internet connection and the provider's service status. If it continues, try a smaller task.                                      |
| Disabled or no Continue setup button | Turn Intelligence on and select Save & test. Continue setup needs a Verified Intelligence connection. Optional cards do not all need to be set up.                    |
| Blank key box after saving           | Normal. Check the masked hint and Verified status. MAF keeps the full key hidden.                                                                                     |

If you ask for help, share the provider name, model name, app version and the error wording **after checking it contains no key or private content**. Never share your key or complete data folder. Billing disputes and account restrictions must be handled with the provider.

### Your final check

- Intelligence says **Verified**.
- You know where to check your provider's usage and bill.
- You have chosen your spending controls and checked auto-recharge.
- Your key is private, and you know where to revoke it.

You are ready to start BUILD. Try a small task first, check its cost, and review AI-generated facts before publishing.

Guide checked against MAF V3 desktop settings and official provider documentation on 2 October 2026. Provider screens, models, prices and terms can change. MAF is supplied as is; this guide does not promise free usage, uninterrupted provider access or complete security.

Copyright (c) 2026 Evolution Unleashed and Stu Jordan. Supplied with the project's MIT licence, including its no-warranty and liability disclaimers, subject to applicable law. Retain the copyright and permission notices when copying or sharing the software. No support or continued maintenance is promised.
