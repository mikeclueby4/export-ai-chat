# AGENTS.md

## Project

An adapted/updated version of the Greasy Fork userscript **"Export ChatGPT/Gemini/Grok/Claude Chat -> MD, JSON, CSV, TXT, HTML"** (script #573478, v1.0.0, by Kairox, MIT licence).

The userscript adds a draggable floating "EXPORT" button to AI chat sites. Clicking it opens a menu to download the current conversation as Markdown, JSON, CSV, TXT, or HTML. Everything happens client-side, by scraping the page DOM or (Claude, Gemini) reading the web client's own conversation API. Nothing goes to third parties. The only requests are read-only same-origin API calls (ChatGPT's start date, Claude's and Gemini's whole conversation).

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
- v1.3.0: Claude exports MD/JSON/CSV/TXT from its conversation API, because the 2026-11 transcript is virtualized (a 16-turn chat had 5 rows mounted). HTML still copies the rendered DOM, with new selectors, and the button warns that it holds only rendered turns. Export errors and warnings now show on the button for 5s.
- v1.3.1: export filenames start with `YYYYMMDD-`, using the same date as the frontmatter `date` (the conversation start if known, else the export time).
- v1.4.0: Gemini exports MD/JSON/CSV/TXT from its `hNvQHb` RPC. This gives raw Markdown, citation URLs without clicking chips, canvas contents (absent from the DOM) and a start date. HTML still copies the rendered DOM, with the "rendered turns only" warning. The chip-clicking code is gone.
- v1.5.0: Gemini Deep Research. While the report pane is open, every format exports the report alone, with `[cite: n]` markers turned into Markdown footnotes and a numbered source list. In chat exports the report is embedded the same way, and the research plan is rendered instead of left as a placeholder.
- v1.5.1: Gemini chat answers grounded in attached Google Docs also cite with `[cite: n]`. These now become footnotes, with the Doc titles as sources. In chat exports, footnote labels are prefixed with the turn number (`[^3.12]`), so a report and an answer in the same export don't collide.

- v1.5.2: CSV cells starting with `= + - @ tab CR` get a leading `'` (formula injection). The exported HTML carries a `<meta>` CSP (`default-src 'none'; style-src 'unsafe-inline'; img-src data:`), so the saved file runs no script and loads nothing remote. Remote images in it no longer show.

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

- Turn headings are the site's own screen-reader label (e.g. ChatGPT's hidden "You said:"), falling back to `Sites.<site>.labels` (always used for API exports). Headings inside a message are shifted so they start at `###`.
- JSON is `{title, source, date, updated?, messages: [{role, label, content}]}`; CSV is `role,label,content`; TXT is the same Markdown content with `Label:` lines.
- Start dates: ChatGPT via `/api/auth/session` + `/backend-api/conversation/{id}` (verified 2026-11-03: `create_time` in epoch seconds; 3s timeout, falls back to export time). Claude takes `created_at` from its conversation API response, Gemini the first turn's timestamp from its RPC. Grok has none.
- Gemini citations render as ` ([Source: title](url), …)` at each cited span's end. Citations ending at the same offset share one parenthesis. Gemini's UI merges adjacent ones into a single "name +1" chip; the export keeps them separate. A canvas renders as `**Canvas: title (file.ext)**` plus a fence (language = file extension) in the last turn that shows it. Earlier turns get `*[Canvas: title (file.ext), current version in a later turn]*`, because the RPC returns only the current version for every turn. Answers grounded in attached Google Docs become footnotes `[^turn.n]`, followed by `**Sources**` and `[^turn.n]: Doc title` lines; the RPC gives no URL for these.
- Gemini Deep Research: with the report pane open, the export holds a single `## Deep Research report` turn. Its title is the pane's title and its date is the timestamp of the turn that holds the report. The report's own headings are shifted to start at `###`. Citations are footnotes `[^n]`, followed by `**Sources**` and `[^n]: [title](url)` lines. With the pane closed, the chat export embeds the report the same way under `**Deep Research report: title**`. The plan renders as `**Research plan: title**` plus a numbered step list. The pane's "sources read" lists are not exported.
- ChatGPT citation pills render as ` ([Source: name](url))`, with ` +N` after the link when the pill covers more sources.
- Claude citations render as ` ([Source: title](url), …)` at each cited span's end. Artifacts opened by a tool render as a paragraph `[Artifact: title](url)` where the tool call was. Thinking, tool calls and tool results are dropped.

## How the script is organized

All code lives in one IIFE. Line numbers refer to the root `export-ai-chat.user.js`:

| Lines | Part | What it does |
|---|---|---|
| 1–18 | `==UserScript==` header | `@include` for chatgpt.com, grok.com, gemini.google.com, claude.ai; grants `GM_addStyle`, `GM_setValue`, `GM_getValue`, `unsafeWindow` (Gemini's `WIZ_global_data`) |
| 26–39 | `exportLabel`, `LOG`, `CommonUtil` | Button label, console prefix, small DOM element factory |
| 41–59 | `Util` | Date formatting (local `YYYY-MM-DD HH:mm`), YAML quoting, filename sanitizing, timeouts, same-origin JSON fetch |
| 61–316 | `Sites` | **All per-site logic**: `match`, `labels`, `title`/`titleSuffix`, `turns()` → `[{el, role}]` in DOM order, `label(turn)`, `content(el)` (root to convert), `skip` selectors, `hook(el, ctx, md)` for custom elements, optional `preLang(pre)`, `startDate()`, and Gemini's and Claude's `api()` → `{startDate, turns: [{role, label, md}], warning?}` |
| 318–462 | `SKIP`, `BLOCK_TAGS`, `Md` | Recursive DOM→Markdown walker over the live DOM (read-only): blocks, nested lists, tables, code fences, inline code, links, images, KaTeX, blockquotes. Code is kept behind placeholders so whitespace tidying can't touch it. `shiftHeadings()` does the `###` shift for ready-made (API) Markdown |
| 464–546 | `Chat` | `collect()` returns `site.api()` turns for non-HTML formats when a site has one; otherwise it looks up the start date and converts each DOM turn. `frontmatter()`, `build(fmt)` per format, `export()` triggers the Blob download and returns any warning |
| 548–567 | `GM_addStyle(...)` | Styles for the floating button and menu, including dark mode |
| 569–646 | `init()` | Builds the button and menu, runs the async export with progress shown on the button (a warning or error stays there for 5s), handles dragging, places the menu by screen quadrant. The button is anchored bottom-right (`right`/`bottom` offsets saved with `GM_setValue`) and re-clamped to the viewport on `resize`, so it follows window resizing and zoom |
| 648–652 | Bootstrap | Installs a pass-through `trustedTypes` default policy; runs `init` after 1s, then every 3s (re-injects after SPA navigation) |

### Per-site DOM selectors (likely to go stale)

| Platform | Turns (role) | Label | Content root | Title | Code blocks |
|---|---|---|---|---|---|
| ChatGPT | next sibling of `h4[data-conversation-role]` | first `span` of that `h4` ("You said:") | `[class*="MarkdownRoot"]`, `.whitespace-pre-wrap` (user text, kept verbatim) | `document.title` | `div[data-code-block]` (language in `[data-markdown-copy="exclude"] > div`, code in `[data-code-block-source] code`) |
| Grok | `div.message-bubble` (alternating) | — | whole bubble | `document.title` | `div.not-prose` |
| Gemini (HTML only) | `user-query-content`, `model-response` (tag); with the Deep Research pane open, just `deep-research-immersive-panel` | `.screen-reader-user-query-label span`, `.screen-reader-model-response-label` | `.query-text`, `message-content .markdown` (also the pane's report body) | pane's `h2.title-text`, else `document.title` minus ` - Google Gemini` (upstream's `conversations-list div.selected` was stale by 2026-10) | — |
| Claude (HTML only) | `[data-testid="user-message"]`, `[data-testid="assistant-message"]` | hidden `h3` before the colon ("You said: …", "Claude responded: …"); the user's is in the enclosing `[data-testid="transcript-row"]` | user message; assistant `:scope > h3 + div` | `document.title` minus ` - Claude` | — |

Claude API (verified 2026-11-08; upstream's `.font-claude-response` was stale): `GET /api/organizations/{org}/chat_conversations/{id}?tree=True&rendering_mode=messages&render_all_tools=true`, with `org` from the `lastActiveOrg` cookie. Without these parameters, `structured_content` is missing. `chat_messages` holds every branch; the current one is found by walking `parent_message_uuid` back from `current_leaf_message_uuid`. `sender` is `human`/`assistant`. `content[]` blocks are `text` (raw Markdown, with `citations[{end_index, sources[{title, url}]}]`), `thinking`, `tool_use` and `tool_result`. An artifact shows up as a `tool_result` with `structured_content.{title, url}`, e.g. from the `Artifact` tool. A 16-turn chat with web results was 626 KB and loaded in 0.7s. The transcript DOM is virtualized: rows (`[data-testid="transcript-row"][data-index]`) mount around the viewport.

Things deliberately not exported yet: transcript file cards (`[data-testid="file-card-block"]`). In the one example, a project file written by the `Projects` tool, the API has only a `doc_uuid` and no URL. Also not exported: skill-proposal cards and user attachments (`attachments`/`files` are untested). Older chats with `<antArtifact>` tags in the text are untested.

ChatGPT extras (verified 2026-11-03; upstream's `div[data-message-id]`, `.markdown` and `pre` selectors were all stale): inline code is `span[data-markdown-copy="inline-code"]`; UI chrome inside messages is marked `[data-markdown-copy="exclude"]` and skipped. Citation pills are `a[data-testid="chatgpt-citation"]` (name in the non-`aria-hidden` span, `+N` in the `aria-hidden` one), rendered as ` ([Source: name](url) +N)` with `utm_source=chatgpt.com` removed; the extra sources aren't resolved. Writing blocks (e.g. drafted emails) are `[data-testid="chatgpt-writing-block"]` and exported from their `data-markdown-copy-text` attribute. Turn wrappers are marked virtualized, but a 10-turn conversation had every turn in the DOM.

Gemini API (verified 2026-11-09 on a 12-turn chat with canvas and code blocks, 130 KB in 0.4s, and five chats with web citations): `POST /_/BardChatUi/data/batchexecute?rpcids=hNvQHb&source-path=/app/{id}&bl={cfb2h}&f.sid={FdrFJe}&hl=en&_reqid=…&rt=c`, form body `f.req=[[["hNvQHb", "[\"c_{id}\",100,null,1,[1],[4],null,1]", null, "generic"]]]` and `at={SNlM0e}`. The three tokens come from `window.WIZ_global_data`. The response is `)]}'` plus length-prefixed chunks. The line starting `[["wrb.fr"` holds the result as a JSON string at `[0][2]`. Field indices in that result:
- `[0]` is the turns, **newest first**. The second argument (100) is the page size. With 2, `[1]` held a continuation token (a long base64 string) and `[0]` the 2 newest turns. When all turns fit, `[1]` is null. Paging isn't implemented, so the export fails when `[1]` is set.
- Per turn: `[2][0][0]` is the user text, `[3][0]` the response drafts, `[3][3]` the id of the draft shown (matched against each draft's `[0]`), and `[4][0]` the epoch seconds.
- Per draft: `[1][0]` is the response Markdown, without thoughts. `[2][1]` is the citations, each `[[snippet, , , [[start, end], …]], [1], [[url, title, favicon, …, siteName(6)]], id]`, where `[start, end]` is a UTF-8 byte range in the Markdown. `[37]` is the "Searched the web" source list, which is not exported.
- `[12]` is an array that holds an object keyed by content type. The object was at `[12][0]` in one chat and at `[12][8]` in another, so the code merges whatever objects it finds there.
- Canvases: the Markdown holds `http://googleusercontent.com/immersive_entry_chip/N`, `["57"]` maps that placeholder to a canvas id, and `[30]` holds `[id, , title, , content, …, filename(9)]`. A code canvas's filename has an extension (`setup.sh`, `[10]` = 1). A Deep Research report's "filename" is its id (`im_…`, `[10]` = 3). Text-document canvases are untested and would currently be treated as reports.
- Deep Research (verified 2026-11-09 on a 3-turn chat with a 28 KB report and 51 sources; the response was 1.2 MB):
  - The plan turn holds `http://googleusercontent.com/deep_research_confirmation_content/0`. `["56"]` is `[title, [[n, step, details], …], eta, buttons, [placeholder, 0], …]`, where `details` is newline-separated "(1) …" lines.
  - The report turn's `[30]` entry has the report Markdown at `[4]`, with `[cite: 1, 2]` markers. `[5][0]["44"]` is `[[marker], [[, , , [[favicon, url, title, , , urlWithTextFragment], number, …]], …]]` per distinct marker, and the numbers cover every cited source. `[8]` and `[17]` are large structured copies of the same report, not used.
- Chat answers grounded in attached Google Docs (verified 2026-11-09, first turn of the same chat): the draft Markdown `[1][0]` has `[cite: 2, 26]` markers, `[2][1]` is empty, and the `[12]` object's `"44"` is `[[marker, 0], [source, …], [snippet, 0]]` per marker. Each source is `[, [[, 20, title, …, mimeType(11)], …, title]]`, with no URL and no number. The sources are listed in the order of the marker's numbers, and each number mapped to one title throughout.
- DOM for Deep Research: the pane is `deep-research-immersive-panel`, and it is removed from the DOM when closed. Its title is `h2.title-text`. Its paragraphs have ids `p-<canvas id>-<n>`, which is how the export finds the matching `[30]` entry.
- Other `http://googleusercontent.com/<type>/N` placeholders (images, etc.) are untested. They are left in the text, and the button warns about them.

The DOM had no canvas content for earlier turns, and the one `inline-preview` rendered the script as mangled Markdown. Code-block labels were display names ("Bash", "Plaintext").

### Known limitations

- Grok turns still assume strict user/assistant alternation.
- DOM-based exports (ChatGPT, Grok, and Claude's and Gemini's HTML) contain only the messages currently in the DOM, so lazily rendered or virtualized history can be missing.
- HTML export embeds raw page `innerHTML`, including site classes and inline SVG, with no sanitizing.
- It registers a permissive global `trustedTypes` default policy, which weakens the host page's Trusted Types protection. (The Markdown path no longer needs it; the button's `innerHTML` still does.)
- It uses `document.onmousemove`/`onmouseup` assignments, which can clobber the page's own handlers.
- Polls `init` every 3s indefinitely.

## Guiding principles

- This is a personal tool. Keep the code small and fix the cases that actually come up: when an export comes out wrong, analyze that chat and fix it then. Don't build speculative handling, fallback chains or generic frameworks for cases nobody has hit.
- Use one data source per site and format. Pick whichever gives complete output with the least code. A site's own same-origin API is fine: API shapes change, but so do DOM class names and test ids, and an API usually returns the whole conversation and the original Markdown. Prefer it when the DOM is virtualized or would need clicking or scrolling to reveal content.
- Don't fall back silently from the API to the DOM. If the source fails, the export fails visibly on the button and in the console, and the fix goes in the next session.
- HTML export is a quick copy of what is rendered on the page and makes no promise of completeness. When we know it may be partial, the button says so.
- Record what was verified, and when, in this file, with the site's real selector or field names, so the next fix starts from facts.

## Conventions

- Plain JavaScript in a single userscript file with no build step unless one is added deliberately. It should run in Tampermonkey and Violentmonkey.
- Keep the userscript metadata block accurate: bump `@version` on every behaviour change, and keep `@match`/`@include` and `@grant` minimal.
- Don't add back `@downloadURL`/`@updateURL` pointing at Greasy Fork. Only add update URLs if we publish this script ourselves.
- English only, no localization tables.
- Isolate per-site logic (selectors, code-block parsing, title lookup) so a site's DOM change touches one place.
- Credit the original author and keep the MIT licence notice in the derived script.

## Testing

There are no automated tests. To test manually, install the script in a userscript manager, open a conversation on each supported site, export every format, and check the output: message order, roles, code fences and languages, math, lists, links, and the title/filename.

Quick check without installing: on claude.ai the page can `fetch()` the script from a local HTTP server (with `Access-Control-Allow-Origin: *`) and inject it as a `<script>`. Gemini's CSP blocks fetching the file from localhost, but `eval` is allowed. You can paste the IIFE into the page console. Or, from a real click (popups need a user gesture), `window.open` a localhost relay page that fetches the script and `postMessage`s it to `opener`, then run it with `new Function(src)()`. Gemini sometimes enforces Trusted Types for `new Function`; create the same pass-through `default` policy the script uses first. A previously injected copy keeps polling `init` every 3s and can recreate its own button, so replace `setTimeout(init, 1000)` with `init()` when re-injecting. First stub `GM_addStyle`/`GM_getValue`/`GM_setValue` and wrap `URL.createObjectURL` to capture the Blob, then call the export and read `blob.text()`.
