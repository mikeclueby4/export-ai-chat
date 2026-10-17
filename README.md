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
