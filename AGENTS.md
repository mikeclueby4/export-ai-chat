# AGENTS.md

## Project

An adapted/updated version of the Greasy Fork userscript **"Export ChatGPT/Gemini/Grok/Claude Chat -> MD, JSON, CSV, TXT, HTML"** (script #573478, v1.0.0, by Kairox, MIT licence).

The userscript adds a draggable floating "EXPORT" button to AI chat sites. Clicking it opens a menu to download the current conversation as Markdown, JSON, CSV, TXT, or HTML. Everything happens client-side by scraping the page DOM; nothing is sent over the network.

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
- The rest of the code is unchanged from upstream so far.

## How the script is organized

All code lives in one IIFE. Line numbers refer to the root `export-ai-chat.user.js`:

| Lines | Part | What it does |
|---|---|---|
| 1–17 | `==UserScript==` header | `@include` for chatgpt.com, grok.com, gemini.google.com, claude.ai; grants `GM_addStyle`, `GM_setValue`, `GM_getValue` |
| 22 | `exportLabel` | Button/menu label (upstream picked a translation here) |
| 24–34 | `CommonUtil.createElement` | Small DOM element factory |
| 36–97 | `HtmlToMarkdown.to(html, platform)` | Regex/DOM-based HTML→Markdown: KaTeX→`$…$`, bold/italic/code/links/images, per-platform code-block extraction, lists, headings, paragraphs |
| 100–116 | `Chat.getElements()` | Detects the platform from the URL, finds the message nodes and the conversation title for each site |
| 117–140 | `Chat.export(fmt)` | Builds the file content for each format and triggers a Blob download |
| 143–162 | `GM_addStyle(...)` | Styles for the floating button and menu, including dark mode |
| 164–215 | `init()` | Builds the button and menu, handles dragging (position saved with `GM_setValue`), places the menu by screen quadrant |
| 217–221 | Bootstrap | Installs a pass-through `trustedTypes` default policy; runs `init` after 1s, then every 3s (re-injects after SPA navigation) |

### Per-site DOM selectors (likely to go stale)

| Platform | Messages | Title | Code blocks |
|---|---|---|---|
| ChatGPT | `div[data-message-id]` | `#history a[data-active]` | `pre` (language label in `div > div:first-child`) |
| Grok | `div.message-bubble` | `document.title` | `div.not-prose` |
| Gemini | `user-query-content` + `model-response`, interleaved | `conversations-list div.selected` | `code-block` |
| Claude | `[data-testid="user-message"], .font-claude-response` | `document.title` | `pre > code.language-*` |

### Known limitations of the reference script

- Assumes messages strictly alternate user/assistant (`i % 2`). A trailing unanswered message is dropped, and any extra node shifts every pair after it.
- Only the messages currently in the DOM are exported, so lazily rendered or virtualized history can be missing.
- The Markdown converter loses nesting (nested lists, formatting inside links), has no table support, and strips tags with a regex.
- HTML export embeds raw page `innerHTML`, including site classes and inline SVG, with no sanitizing.
- TXT export uses `textContent`, so code-block buttons such as "Copy" show up in the output.
- It registers a permissive global `trustedTypes` default policy, which weakens the host page's Trusted Types protection.
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
