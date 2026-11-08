# export-ai-chat

Userscript that adds a draggable **EXPORT** button to ChatGPT, Gemini, Grok and Claude, to download the current chat as Markdown, JSON, CSV, TXT or HTML. Runs entirely in your browser.

Adapted from [Kairox's script](https://greasyfork.org/scripts/573478) (MIT).

## Install (Violentmonkey)

1. Install [Violentmonkey](https://violentmonkey.github.io/).
2. Violentmonkey dashboard → **+** → **Install from URL**, and enter:

   ```
   https://raw.githubusercontent.com/mikeclueby4/export-ai-chat/main/export-ai-chat.user.js
   ```

   (Or just open that URL; Violentmonkey offers to install it.)
3. Open a chat on a supported site and click **EXPORT**.

## Example Markdown output

````markdown
---
status: report
title: "Exported LLM Chat: Sorting in Python"
date: 2026-10-17 20:15
updated: 2026-10-17 20:30
source: https://gemini.google.com/app/abc123
---

# Sorting in Python

## You said

How do I sort a list of dicts by a key?

## Gemini said

Use `sorted` with a key function:

```python
people = [{"name": "Ann", "age": 31}, {"name": "Bob", "age": 25}]
sorted(people, key=lambda p: p["age"])
```
````

## Claude and Gemini: citations, artifacts, canvases and Deep Research

On Claude and Gemini, the Markdown, JSON, CSV and TXT exports come from the site's own conversation data (the same request the web page makes), not from what is on screen. So you get the whole conversation even when the page has only partly rendered it, and the export holds the original Markdown with real code-block languages and math. If that request fails, the export fails and the button says so. It doesn't fall back to a partial copy of the page.

**Claude**

- Only the branch you are currently viewing is exported. Edited or regenerated alternatives are left out.
- Web citations appear after the cited text as ` ([Source: title](url), …)`.
- Artifacts appear where they were created, as a link: `[Artifact: title](url)`.
- Thinking, tool calls and tool results are left out. File cards and uploaded attachments aren't exported yet.
- The `date` is when the conversation started.

**Gemini**

- Web citations appear after the cited text as ` ([Source: title](url), …)`, with no clicking of source chips. Where Gemini merges neighbouring citations into one "Example +1" chip, the export keeps both sources.
- Answers that draw on attached Google Docs become footnotes, like a Deep Research report's citations below. The source list gives each Doc's title only, because Gemini doesn't return a link for it.
- A code canvas is included as a code block, headed `**Canvas: title (file.ext)**`. Gemini keeps only the canvas's latest version, so the full code goes in the last turn that shows it. Earlier turns get a short note pointing to it.
- The `date` is when the conversation started.
- Chats with more than 100 turns aren't supported yet, so the export stops with an error rather than leaving out the oldest part.

**Gemini Deep Research**

What you get depends on whether the report pane is open when you click **EXPORT**:

- **Pane open:** the export holds only the report. It is titled after the report and dated when the report was finished.
- **Pane closed:** you get the whole chat. The research plan appears as a numbered list of steps, and the report appears where it was delivered, under `**Deep Research report: title**`.

Either way, the report's `[cite: 1, 2]` markers become Markdown footnotes, with a numbered source list at the end:

```markdown
…honeybees communicate the location of food sources through the waggle dance[^1][^2].

**Sources**

[^1]: [The Waggle Dance - Example Bee Society](https://example.org/waggle-dance)
[^2]: [Foraging Behaviour in Honeybees](https://example.com/foraging)
```

In a whole-chat export, each footnote number is prefixed with its turn number (`[^3.1]`), so footnotes from different answers can't collide.

The "sources read" lists in the pane, which Gemini consulted but didn't cite, aren't exported.

## How the .HTML export differs

The HTML export is a quick copy of what the page has rendered. It is not built from the conversation data the other formats use.

- It contains only the turns currently loaded in the page. Claude and Gemini load long chats in pieces, so the button warns **"HTML: rendered turns only"**.
- It embeds the page's own markup as-is, including the site's styling hooks and icons. Citations stay as the site displays them, so there are no footnotes or source lists, and canvases or artifacts appear only as far as the page shows them.
- On Gemini with the Deep Research pane open, it copies the rendered report from the pane.
- The filename date is the export date, because the page doesn't show when the chat started.

For a complete, portable record, use Markdown or JSON.
