# AGENTS.md

## Project

An adapted/updated version of the Greasy Fork userscript **"Export ChatGPT/Gemini/Grok/Claude Chat -> MD, JSON, CSV, TXT, HTML"** (script #573478, v1.0.0, by Kairox, MIT licence).

The userscript adds a draggable floating "EXPORT" button to AI chat sites. Clicking it opens a menu to download the current conversation as Markdown, JSON, CSV, TXT, or HTML. Everything happens client-side by scraping the page DOM. Nothing goes to third parties. The only requests are read-only same-origin API calls for the conversation's start date (ChatGPT/Claude), plus whatever the site itself fetches when the script clicks Gemini source chips.

- Upstream source: https://update.greasyfork.org/scripts/573478/Export%20ChatGPTGeminiGrokClaude%20Chat%20-%3E%20MD%2C%20JSON%2C%20CSV%2C%20TXT%2C%20HTML.user.js
- Greasy Fork page: https://greasyfork.org/scripts/573478

## File outline

```
export-ai-chat/
├── AGENTS.md                         # This file
├── export-ai-chat.user.js            # Our working copy of the userscript (edit this one)
└── reference/
    └── export-ai-chat.user.js        # Unmodified upstream v1.0.0, kept for reference only
```

Do not edit anything in `reference/`. All development happens in the root `export-ai-chat.user.js`.

### Differences between the root copy and upstream

- Removed the ~200 localized `@name:xx` and `@description:xx` metadata lines.
- Removed the `i18n` table and `navigator.language` lookup. `exportLabel` is now the constant `"EXPORT"`.
- Removed `@downloadURL` and `@updateURL`, so userscript managers won't auto-update it from Greasy Fork and overwrite our changes.
- Changed `@namespace` from `AI_I18N_Final` to `mikeclueby4/export-ai-chat`. Managers identify a script by name + namespace, so the new namespace stops it being treated as the upstream script.
- v1.1.0: replaced `HtmlToMarkdown` and `Chat` with a per-site `Sites` table, a DOM-walking `Md` converter and a turn-based `Chat` (details below).
- v1.2.0: rewrote the ChatGPT selectors for its 2026-11 DOM: turns, code blocks, inline code, citation pills and writing blocks.
- v1.2.1: the button is anchored to the bottom-right corner (it was positioned from the top-left), so it stays in place when the window is resized or zoomed.

## Output format (MD)

```markdown
---
status: report
title: "Exported LLM Chat: <chat title>"
date: YYYY-MM-DD HH:mm        # conversation start if known, else export time (local time)
updated: YYYY-MM-DD HH:mm     # export time; only present when the start date is known
source: <origin + path of the chat>
---

# <chat title>

## You said

...

## Gemini said

...
```

- Turn headings are the site's own screen-reader label (e.g. Gemini's hidden "You said" / "Gemini said"), falling back to `Sites.<site>.labels`. Headings inside a message are shifted so they start at `###`.
- Gemini inline source chips are resolved by clicking each chip and reading its hover card, rendered as ` ([Source: name](url))`. A multi-source chip yields several links. Gemini only keeps one card open at a time, so chips are resolved sequentially with a 3s timeout each. The first failure stops resolving, and the rest render as ` (Source: name +N)`.
- Suggested-reply buttons (Gemini's `follow-up` "Yes") are dropped; the follow-up question text is kept as a paragraph.
- JSON is `{title, source, date, updated?, messages: [{role, label, content}]}`; CSV is `role,label,content`; TXT is the same Markdown content with `Label:` lines.
- Start dates come from same-origin API calls on ChatGPT (`/api/auth/session` + `/backend-api/conversation/{id}`, verified 2026-11-03: `create_time` in epoch seconds) and Claude (`/api/organizations/{org}/chat_conversations/{id}`, still an **unverified** guess at the web client's endpoint). Both have a 3s timeout and fall back to export time. Gemini and Grok have none.
- ChatGPT citation pills render as ` ([Source: name](url))`, with ` +N` after the link when the pill covers more sources.

## How the script is organized

All code lives in one IIFE. Line numbers refer to the root `export-ai-chat.user.js`:

| Lines | Part | What it does |
|---|---|---|
| 1–17 | `==UserScript==` header | `@include` for chatgpt.com, grok.com, gemini.google.com, claude.ai; grants `GM_addStyle`, `GM_setValue`, `GM_getValue` |
| 25–38 | `exportLabel`, `LOG`, `CommonUtil` | Button label, console prefix, small DOM element factory |
| 40–68 | `Util` | Date formatting (local `YYYY-MM-DD HH:mm`), YAML quoting, filename sanitizing, timeouts, same-origin JSON fetch, scroll parent lookup |
| 70–236 | `Sites` | **All per-site logic**: `match`, `labels`, `title`/`titleSuffix`, `turns()` → `[{el, role}]` in DOM order, `label(turn)`, `content(el)` (root to convert), `skip` selectors, `hook(el, ctx, md)` for custom elements, optional `preLang(pre)`, `startDate()`, and Gemini's `resolveSources`/`resolveChip` |
| 238–368 | `SKIP`, `BLOCK_TAGS`, `Md` | Recursive DOM→Markdown walker over the live DOM (read-only): blocks, nested lists, tables, code fences, inline code, links, images, KaTeX, blockquotes. Code is kept behind placeholders so whitespace tidying can't touch it |
| 370–455 | `Chat` | `collect()` resolves sources and the start date, then converts each turn; `frontmatter()`, `build(fmt)` per format, `export()` triggers the Blob download |
| 457–476 | `GM_addStyle(...)` | Styles for the floating button and menu, including dark mode |
| 478–551 | `init()` | Builds the button and menu, runs the async export with progress shown on the button, handles dragging, places the menu by screen quadrant. The button is anchored bottom-right (`right`/`bottom` offsets saved with `GM_setValue`) and re-clamped to the viewport on `resize`, so it follows window resizing and zoom |
| 553–557 | Bootstrap | Installs a pass-through `trustedTypes` default policy; runs `init` after 1s, then every 3s (re-injects after SPA navigation) |

### Per-site DOM selectors (likely to go stale)

| Platform | Turns (role) | Label | Content root | Title | Code blocks |
|---|---|---|---|---|---|
| ChatGPT | next sibling of `h4[data-conversation-role]` | first `span` of that `h4` ("You said:") | `[class*="MarkdownRoot"]`, `.whitespace-pre-wrap` (user text, kept verbatim) | `document.title` | `div[data-code-block]` (language in `[data-markdown-copy="exclude"] > div`, code in `[data-code-block-source] code`) |
| Grok | `div.message-bubble` (alternating) | — | whole bubble | `document.title` | `div.not-prose` |
| Gemini | `user-query-content`, `model-response` (tag) | `.screen-reader-user-query-label span`, `.screen-reader-model-response-label` | `.query-text`, `message-content .markdown` | `document.title` minus ` - Google Gemini` (upstream's `conversations-list div.selected` was stale by 2026-10) | `code-block` (untested) |
| Claude | `[data-testid="user-message"], .font-claude-response` | — | whole node | `document.title` minus ` - Claude` | `pre > code.language-*` |

ChatGPT extras (verified 2026-11-03; upstream's `div[data-message-id]`, `.markdown` and `pre` selectors were all stale): inline code is `span[data-markdown-copy="inline-code"]`; UI chrome inside messages is marked `[data-markdown-copy="exclude"]` and skipped. Citation pills are `a[data-testid="chatgpt-citation"]` (name in the non-`aria-hidden` span, `+N` in the `aria-hidden` one), rendered as ` ([Source: name](url) +N)` with `utm_source=chatgpt.com` removed; the extra sources aren't resolved. Writing blocks (e.g. drafted emails) are `[data-testid="chatgpt-writing-block"]` and exported from their `data-markdown-copy-text` attribute. Turn wrappers are marked virtualized, but a 10-turn conversation had every turn in the DOM.

Gemini extras (verified 2026-10-17): source chips are `source-inline-chip` (name in `.source-title`, count in `.source-count`); after a click the card renders inside the chip as `multi-source-hovered-card inline-source-card a[href]` with the name in `.path-text`, rendered twice. An Escape keydown on the chip button closes it but leaves `aria-expanded="true"`, so the next click only toggles it closed. Follow-ups are `follow-up` > `.follow-up-text` + `button.follow-up-button`.

### Known limitations

- Grok turns still assume strict user/assistant alternation.
- Only the messages currently in the DOM are exported, so lazily rendered or virtualized history can be missing.
- HTML export embeds raw page `innerHTML`, including site classes and inline SVG, with no sanitizing.
- It registers a permissive global `trustedTypes` default policy, which weakens the host page's Trusted Types protection. (The Markdown path no longer needs it; the button's `innerHTML` still does.)
- It uses `document.onmousemove`/`onmouseup` assignments, which can clobber the page's own handlers.
- Polls `init` every 3s indefinitely.

## Conventions

- Plain JavaScript in a single userscript file with no build step unless one is added deliberately. It should run in Tampermonkey and Violentmonkey.
- Keep the userscript metadata block accurate: bump `@version` on every behaviour change, and keep `@match`/`@include` and `@grant` minimal.
- Don't add back `@downloadURL`/`@updateURL` pointing at Greasy Fork. Only add update URLs if we publish this script ourselves.
- English only, no localization tables.
- Isolate per-site logic (selectors, code-block parsing, title lookup) so a site's DOM change touches one place.
- Credit the original author and keep the MIT licence notice in the derived script.

## Testing

There are no automated tests. To test manually, install the script in a userscript manager, open a conversation on each supported site, export every format, and check the output: message order, roles, code fences and languages, math, lists, links, and the title/filename.

Quick check without installing: Gemini's CSP blocks loading the file from localhost, so paste the IIFE into the page console (or a browser-automation JS tool). First stub `GM_addStyle`/`GM_getValue`/`GM_setValue` and wrap `URL.createObjectURL` to capture the Blob, then call the export and read `blob.text()`.
