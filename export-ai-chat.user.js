// ==UserScript==
// @name         Export ChatGPT/Gemini/Grok/Claude Chat -> MD, JSON, CSV, TXT, HTML
// @description  Export ChatGPT, Gemini, Grok, Claude conversations to Markdown, JSON, CSV, TXT, HTML
// @namespace    mikeclueby4/export-ai-chat
// @version      1.6.0
// @author       mikeclueby4, Kairox
// @include      *://chatgpt.com/*
// @include      *://grok.com/*
// @include      *://gemini.google.com/*
// @include      *://claude.ai/*
// @noframes
// @license      MIT
// @run-at       document-idle
// @grant        GM_addStyle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// ==/UserScript==

// Based on "Export ChatGPT/Gemini/Grok/Claude Chat -> MD, JSON, CSV, TXT, HTML" v1.0.0
// by Kairox (https://greasyfork.org/scripts/573478), MIT licence.

(function () {
    'use strict';

    const exportLabel = "EXPORT";
    const LOG = '[export-ai-chat]';

    const CommonUtil = {
        createElement: function(tag, opts = {}) {
            const el = document.createElement(tag);
            if (opts.html) el.innerHTML = opts.html;
            if (opts.text) el.textContent = opts.text;
            if (opts.className) el.className = opts.className;
            if (opts.style) Object.assign(el.style, opts.style);
            if (opts.childrens) opts.childrens.forEach(c => el.appendChild(c));
            return el;
        }
    };

    const Util = {
        pad: n => String(n).padStart(2, '0'),
        // Local time as "YYYY-MM-DD HH:mm"
        fmtDate(d) {
            return `${d.getFullYear()}-${this.pad(d.getMonth() + 1)}-${this.pad(d.getDate())} ${this.pad(d.getHours())}:${this.pad(d.getMinutes())}`;
        },
        yamlStr: s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"',
        fileName: s => s.replace(/[\/\\?%*:|"<>.]/g, "_").trim() || "Export",
        withTimeout(p, ms) {
            return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
        },
        async fetchJson(url, opts = {}) {
            const r = await fetch(url, { credentials: 'same-origin', ...opts });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            return r.json();
        },
        validDate: d => (d instanceof Date && !isNaN(d)) ? d : null,
        escHtml: s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    };

    // ---- Per-site logic: selectors, labels, code blocks, title and dates live here ----

    const Sites = {
        chatGPT: {
            match: h => h.includes('chatgpt.com'),
            labels: { user: 'You said', assistant: 'ChatGPT said' },
            title: () => document.title,
            titleSuffix: /\s*[-|]\s*ChatGPT$/,
            // Each message follows a hidden <h4 data-conversation-role> holding "<span>You said:</span><span>You</span>".
            turns: () => [...document.querySelectorAll('h4[data-conversation-role]')]
                .filter(h => h.nextElementSibling)
                .map(h => ({ el: h.nextElementSibling, head: h, role: h.dataset.conversationRole === 'user' ? 'user' : 'assistant' })),
            label: t => t.head.querySelector('span')?.textContent,
            content: el => el.querySelector('[class*="MarkdownRoot"], .whitespace-pre-wrap') || el,
            skip: '[data-markdown-copy="exclude"]',
            hook(el, ctx, md) {
                // User text is plain text; keep its line breaks verbatim.
                if (el.matches('.whitespace-pre-wrap') && !el.closest('[class*="MarkdownRoot"]')) {
                    return md.block(md.code(ctx, el.textContent.replace(/\s+$/, '')));
                }
                if (el.matches('[data-code-block]')) {
                    const lang = el.querySelector('[data-markdown-copy="exclude"] > div')?.textContent.trim().toLowerCase();
                    const code = el.querySelector('[data-code-block-source] code, [data-code-block-source]');
                    return md.fence(ctx, lang === 'plain text' ? 'text' : lang?.replace(/\s+/g, ''), code?.textContent ?? '');
                }
                if (el.matches('[data-markdown-copy="inline-code"]')) return md.inlineCode(ctx, el.textContent);
                if (el.matches('[data-testid="chatgpt-writing-block"]')) {
                    const text = el.dataset.markdownCopyText;
                    if (text) return md.block(md.code(ctx, text.trim()));
                }
                if (el.matches('a[data-testid="chatgpt-citation"]')) {
                    const name = [...el.querySelectorAll('span')].find(s => !s.children.length && !s.closest('[aria-hidden="true"]'))?.textContent.trim() || 'link';
                    const more = el.querySelector('[aria-hidden="true"]')?.textContent.trim();
                    const u = new URL(el.href);
                    if (u.searchParams.get('utm_source') === 'chatgpt.com') u.searchParams.delete('utm_source');
                    return ` ([Source: ${name.replace(/[\[\]]/g, '')}](${md.url(u.href)})${more ? ' ' + more : ''})`;
                }
            },
            // Verified 2026-11-03: returns create_time in epoch seconds.
            async startDate() {
                const id = location.pathname.match(/\/c\/([\w-]+)/)?.[1];
                if (!id) return null;
                const session = await Util.fetchJson('/api/auth/session');
                const conv = await Util.fetchJson(`/backend-api/conversation/${id}`, { headers: { Authorization: `Bearer ${session.accessToken}` } });
                return conv.create_time ? new Date(conv.create_time * 1000) : null;
            }
        },
        grok: {
            match: h => h.includes('grok.com'),
            labels: { user: 'You said', assistant: 'Grok said' },
            title: () => document.title,
            titleSuffix: /\s*[-|]\s*Grok$/,
            // No role marker known; assume strict alternation.
            turns: () => [...document.querySelectorAll('div.message-bubble')]
                .map((el, i) => ({ el, role: i % 2 ? 'assistant' : 'user' })),
            content: el => el,
            skip: '',
            hook(el, ctx, md) {
                if (el.matches('div.not-prose') && el.querySelector('code')) {
                    return md.fence(ctx, el.querySelector('div > div > span')?.textContent, el.querySelector('code').textContent);
                }
            }
        },
        gemini: {
            match: h => h.includes('gemini.google.com'),
            labels: { user: 'You said', assistant: 'Gemini said' },
            reportLabel: 'Deep Research report',
            // While the Deep Research pane is open, every format exports that report instead of the chat.
            pane: () => document.querySelector('deep-research-immersive-panel'),
            title() { return this.pane()?.querySelector('h2.title-text')?.textContent || document.title; },
            titleSuffix: /\s*-\s*Google Gemini$/,
            // DOM selectors are only used for HTML export, which copies the rendered turns.
            turns() {
                const pane = this.pane();
                if (pane) return [{ el: pane, role: 'assistant', report: true }];
                return [...document.querySelectorAll('user-query-content, model-response')]
                    .map(el => ({ el, role: el.matches('user-query-content') ? 'user' : 'assistant' }));
            },
            // The hidden heading holds "<span>You said</span> <truncated query>"; take only the span.
            label(t) {
                if (t.report) return this.reportLabel;
                return t.role === 'user'
                    ? t.el.querySelector('.screen-reader-user-query-label span')?.textContent
                    : t.el.querySelector('.screen-reader-model-response-label')?.textContent;
            },
            content: el => el.querySelector('.query-text') || el.querySelector('message-content .markdown') || el,
            // All other formats come from the web client's batchexecute "hNvQHb" RPC (verified 2026-11-09): every turn,
            // raw Markdown, citations with URLs and canvas contents.
            async api() {
                const id = location.pathname.match(/\/app\/(\w+)/)?.[1];
                if (!id) throw new Error('no conversation id in URL');
                const W = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window).WIZ_global_data;
                const rpc = 'hNvQHb', limit = 100;
                const qs = new URLSearchParams({ rpcids: rpc, 'source-path': location.pathname, bl: W.cfb2h, 'f.sid': W.FdrFJe, hl: 'en', _reqid: String(Date.now() % 900000 + 100000), rt: 'c' });
                const body = new URLSearchParams({ 'f.req': JSON.stringify([[[rpc, JSON.stringify(['c_' + id, limit, null, 1, [1], [4], null, 1]), null, 'generic']]]), at: W.SNlM0e });
                const r = await fetch('/_/BardChatUi/data/batchexecute?' + qs, { method: 'POST', body, credentials: 'same-origin' });
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                // The body is ")]}'" plus length-prefixed chunks; the result is a JSON string inside the "wrb.fr" envelope.
                const env = JSON.parse((await r.text()).split('\n').find(l => l.startsWith('[["wrb.fr"')) || 'null');
                if (!env?.[0]?.[2]) throw new Error('no conversation data');
                const data = JSON.parse(env[0][2]);
                // [1] is a continuation token when older turns didn't fit; paging isn't implemented.
                if (data[1]) throw new Error(`over ${limit} turns not supported`);
                const turns = data[0].reverse();
                // Each turn holds its response drafts; [3][3] is the id of the one shown.
                const cands = turns.map(t => t[3][0].find(c => c[0] === t[3][3]));
                if (cands.includes(undefined)) throw new Error('shown response draft not found');
                // Every turn returns a canvas's current version, so its content goes with the last turn that shows it.
                const lastUse = new Map();
                cands.forEach((c, i) => (c[30] || []).forEach(v => lastUse.set(v[0], i)));
                const pane = this.pane();
                if (pane) {
                    // The report's paragraphs have ids "p-<canvas id>-<n>".
                    const id = pane.querySelector('[id^="p-"]')?.id.match(/^p-(.+)-\d+$/)?.[1];
                    const i = lastUse.get(id);
                    if (i === undefined) throw new Error('open report not found');
                    const v = cands[i][30].find(v => v[0] === id);
                    return {
                        startDate: new Date(turns[i][4][0] * 1000),
                        turns: [{ role: 'assistant', label: this.reportLabel, md: Md.shiftHeadings(this.reportMd(v)) }]
                    };
                }
                const out = turns.flatMap((t, i) => [
                    // A blank line before a lone ---/=== line keeps it a rule instead of a setext heading.
                    { role: 'user', label: this.labels.user, md: Md.shiftHeadings(t[2][0][0].trim().replace(/^(.*\S.*)\n([ \t]*(?:-+|=+)[ \t]*)$/gm, '$1\n\n$2')) },
                    { role: 'assistant', label: this.labels.assistant, md: Md.shiftHeadings(this.apiMd(cands[i], i, lastUse)) }
                ]);
                const warnings = [];
                const left = out.flatMap(t => t.md.match(/http:\/\/googleusercontent\.com\/\w+\/\d+/g) || []);
                if (left.length) warnings.push(`${left.length} unresolved placeholder(s): ${[...new Set(left.map(u => u.split('/')[3]))].join(', ')}`);
                const noUrl = cands.flatMap(c => c[2]?.[1] || []).filter(ci => !ci[2]?.some(s => s[0])).length;
                if (noUrl) warnings.push(`${noUrl} web citation(s) without a URL were dropped`);
                return { startDate: new Date(turns[0][4][0] * 1000), turns: out, warnings };
            },
            // Response Markdown with ` ([Source: title](url))` after each cited span, and canvas and Deep Research
            // plan placeholders replaced by their content.
            apiMd(c, i, lastUse) {
                // Citation ranges are UTF-8 byte offsets into the Markdown; [0][3][0] is [start, end].
                const bytes = new TextEncoder().encode(c[1][0]), dec = new TextDecoder();
                const ends = new Map();
                for (const ci of c[2]?.[1] || []) {
                    const end = ci[0][3][0][1];
                    const links = ci[2].filter(s => s[0]).map(s => `[Source: ${(s[1] || s[6] || 'link').replace(/[\[\]]/g, '')}](${Md.url(s[0])})`);
                    if (links.length) ends.set(end, [...(ends.get(end) || []), ...links]);
                }
                let t = '', pos = 0;
                for (const end of [...ends.keys()].sort((a, b) => a - b)) {
                    t += dec.decode(bytes.slice(pos, end)) + ` (${ends.get(end).join(', ')})`;
                    pos = end;
                }
                t += dec.decode(bytes.slice(pos));
                // [12] holds an object keyed by content type, at a varying index.
                const extra = Object.assign({}, ...(c[12] || []).filter(x => x && typeof x === 'object' && !Array.isArray(x)));
                // Answers grounded in attached Google Docs cite with "[cite: n]" too. "44" is [[marker], sources] per
                // marker, the sources in the marker's number order as [, [[, , title, …]]], with no URL.
                const src = new Map();
                for (const [[m], list] of extra['44'] || []) m.match(/\d+/g).forEach((n, k) => list[k] && src.set(+n, list[k][1][0][2].replace(/[\[\]]/g, '')));
                t = this.footnotes(t, src, `${i + 1}.`);
                // Canvases: "57" maps each placeholder to a canvas id; [30] holds [id, , title, , content, …, filename].
                // A code canvas's filename has an extension; a Deep Research report's is its id.
                const ids = new Map((extra['57'] || []).map(e => [e[0][0], e[1]]));
                const canvases = new Map((c[30] || []).map(v => [v[0], v]));
                // Placeholders swallow the line breaks around them so their content sits in its own paragraphs.
                return t.replace(/\n*(http:\/\/googleusercontent\.com\/immersive_entry_chip\/\d+)\n*/g, (m, ph) => {
                    const v = canvases.get(ids.get(ph));
                    if (!v) return m;
                    const ext = v[9].match(/\.(\w+)$/)?.[1];
                    const name = ext ? `Canvas: ${v[2]} (${v[9]})` : `${this.reportLabel}: ${v[2]}`;
                    if (lastUse.get(v[0]) !== i) return `\n\n*[${name}, current version in a later turn]*\n\n`;
                    if (!ext) return `\n\n**${name}**\n\n${this.reportMd(v, `${i + 1}.`)}\n\n`;
                    const f = '`'.repeat(Math.max(3, ...(v[4].match(/`+/g) || []).map(r => r.length + 1)));
                    return `\n\n**${name}**\n\n${f}${ext}\n${v[4].replace(/\n+$/, '')}\n${f}\n\n`;
                }).replace(/\n*(http:\/\/googleusercontent\.com\/deep_research_confirmation_content\/\d+)\n*/g, (m, ph) => {
                    // The research plan: "56" is [title, [[n, step, details], …], eta, buttons, [placeholder, n], …].
                    const p = extra['56'];
                    if (p?.[4]?.[0] !== ph) return m;
                    const steps = p[1].map(([n, step, details]) => `${n}. ${step}` + (details
                        ? '\n\n' + details.split('\n').map(l => l.trim()).filter(Boolean).map(l => '   ' + l).join('\n\n') : ''));
                    return `\n\n**Research plan: ${p[0]}**\n\n${steps.join('\n')}\n\n`;
                }).trim();
            },
            // " [cite: 1, 2]" markers become footnotes [^pre1][^pre2], plus a source list; src maps number → Markdown.
            // The prefix keeps footnotes from different turns of one export apart.
            footnotes(md, src, pre = '') {
                md = md.replace(/ ?\[cite:\s*([\d,\s]+)\]/g, (m, ns) => ns.split(/,\s*/).map(n => `[^${pre}${n.trim()}]`).join(''));
                const nums = [...src.keys()].sort((a, b) => a - b);
                if (!nums.length) return md;
                return md + '\n\n**Sources**\n\n' + nums.map(n => `[^${pre}${n}]: ${src.get(n)}`).join('\n');
            },
            // A Deep Research report's [5][0]["44"] lists each marker's sources as [, , , [[favicon, url, title, …], number, …]].
            reportMd(v, pre) {
                const src = new Map();
                for (const [, list] of v[5]?.[0]?.['44'] || []) for (const s of list) {
                    src.set(s[3][1], `[${(s[3][0][2] || 'link').replace(/[\[\]]/g, '')}](${Md.url(s[3][0][1])})`);
                }
                return this.footnotes(v[4].trim(), src, pre);
            }
        },
        claude: {
            match: h => h.includes('claude.ai'),
            labels: { user: 'You said', assistant: 'Claude responded' },
            title: () => document.title,
            titleSuffix: /\s*-\s*Claude$/,
            turns: () => [...document.querySelectorAll('[data-testid="user-message"], [data-testid="assistant-message"]')]
                .map(el => ({ el, role: el.matches('[data-testid="user-message"]') ? 'user' : 'assistant' })),
            // DOM selectors are only used for HTML export, which copies the rendered (virtualized) turns.
            // A hidden <h3> holds "You said: <text>" / "Claude responded: <text>"; take the part before the colon.
            label: t => (t.role === 'user' ? t.el.closest('[data-testid="transcript-row"]')?.querySelector('h3') : t.el.querySelector(':scope > h3'))
                ?.textContent.match(/^([^:]+):/)?.[1],
            content: el => el.querySelector(':scope > h3 + div') || el,
            // All other formats come from the web client's conversation API (verified 2026-11-08): the whole
            // conversation, with text blocks as raw Markdown, citations and artifact links.
            async api() {
                const id = location.pathname.match(/\/chat\/([\w-]+)/)?.[1];
                if (!id) throw new Error('no conversation id in URL');
                let org = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/)?.[1];
                if (!org) org = (await Util.fetchJson('/api/organizations'))?.[0]?.uuid;
                const conv = await Util.fetchJson(`/api/organizations/${org}/chat_conversations/${id}?tree=True&rendering_mode=messages&render_all_tools=true`);
                // The tree holds every branch; walk back from the current leaf.
                const byId = new Map(conv.chat_messages.map(m => [m.uuid, m]));
                const branch = [];
                for (let m = byId.get(conv.current_leaf_message_uuid); m; m = byId.get(m.parent_message_uuid)) branch.unshift(m);
                return {
                    startDate: new Date(conv.created_at),
                    turns: branch.map(m => {
                        const role = m.sender === 'human' ? 'user' : 'assistant';
                        return { role, label: this.labels[role], md: Md.shiftHeadings(this.apiMd(m)) };
                    })
                };
            },
            // Text blocks with ` ([Source: title](url))` after each cited span, and `[Artifact: title](url)` for
            // artifacts opened by tools. Thinking and tool use are dropped.
            apiMd(m) {
                let out = '', gap = false;
                const seen = new Set(), para = s => { out += (out ? '\n\n' : '') + s; };
                for (const c of m.content || []) {
                    if (c.type === 'text') {
                        let t = c.text;
                        for (const ci of [...(c.citations || [])].sort((a, b) => b.end_index - a.end_index)) {
                            const links = (ci.sources || []).filter(s => s.url).map(s => `[Source: ${(s.title || 'link').replace(/[\[\]]/g, '')}](${Md.url(s.url)})`);
                            if (links.length) t = t.slice(0, ci.end_index) + ` (${links.join(', ')})` + t.slice(ci.end_index);
                        }
                        // Consecutive text blocks continue each other; a tool call in between starts a new paragraph.
                        if (gap) para(t.trim()); else out += t;
                        gap = false;
                        continue;
                    }
                    gap = true;
                    const a = c.type === 'tool_result' && c.structured_content;
                    if (a?.url && a.title && !seen.has(a.url)) { seen.add(a.url); para(`[Artifact: ${a.title.replace(/[\[\]]/g, '')}](${Md.url(a.url)})`); }
                }
                return out.trim();
            }
        }
    };

    // ---- DOM -> Markdown ----
    // Walks the live DOM read-only. Code is stashed behind \u0000n\u0000 placeholders so whitespace
    // tidying can't touch it; list indentation uses \u0001 so it survives line trimming.

    const SKIP = 'button, svg, mat-icon, script, style, noscript, template, .cdk-visually-hidden, .sr-only';
    const BLOCK_TAGS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'details', 'summary', 'dl', 'dt', 'dd', 'li']);

    const Md = {
        convert(root, site) {
            const ctx = { site, codes: [], hOffset: 0 };
            const levels = [...root.querySelectorAll('h1, h2, h3, h4, h5, h6')]
                .filter(h => !h.closest(SKIP)).map(h => +h.tagName[1]);
            // Turn headings are ##, so headings inside a message start at ###.
            if (levels.length) ctx.hOffset = Math.max(0, 3 - Math.min(...levels));
            let s = this.tidy(this.render(root, ctx));
            s = s.replace(/^(\u0001*)\u0000(\d+)\u0000$/gm, (m, ind, i) => ctx.codes[i].split('\n').map(l => ind + l).join('\n'))
                 .replace(/\u0000(\d+)\u0000/g, (m, i) => ctx.codes[i]);
            return s.replace(/\u0001/g, ' ');
        },
        children(el, ctx) {
            let s = '';
            for (const c of el.childNodes) s += this.render(c, ctx);
            return s;
        },
        render(node, ctx) {
            if (node.nodeType === Node.TEXT_NODE) return node.data.replace(/\s+/g, ' ');
            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            const el = node, tag = el.tagName.toLowerCase();

            const hooked = ctx.site.hook?.(el, ctx, this);
            if (hooked !== undefined) return hooked;

            if (el.classList.contains('katex-display') || el.classList.contains('katex')) {
                const tex = el.querySelector('annotation[encoding="application/x-tex"]')?.textContent.trim();
                if (tex) return el.classList.contains('katex-display') ? this.block(this.code(ctx, `$$\n${tex}\n$$`)) : this.code(ctx, `$${tex}$`);
            }
            if (el.matches(SKIP) || (ctx.site.skip && el.matches(ctx.site.skip))) return '';

            switch (tag) {
                case 'br': return '\n';
                case 'hr': return '\n\n---\n\n';
                case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
                    const level = Math.min(6, +tag[1] + ctx.hOffset);
                    return this.block('#'.repeat(level) + ' ' + this.inline(this.children(el, ctx)));
                }
                case 'p': return this.block(this.children(el, ctx));
                case 'strong': case 'b': return this.wrap(this.children(el, ctx), '**');
                case 'em': case 'i': return this.wrap(this.children(el, ctx), '*');
                case 's': case 'del': return this.wrap(this.children(el, ctx), '~~');
                case 'code': {
                    const a = el.querySelector('a[href]');
                    const code = this.inlineCode(ctx, el.textContent);
                    return (a && /^https?:/.test(a.href) && a.textContent.trim() === el.textContent.trim()) ? `[${code}](${this.url(a.href)})` : code;
                }
                case 'pre': {
                    const codeEl = el.querySelector('code');
                    const cls = [...(codeEl || el).classList].find(c => c.startsWith('language-'));
                    const lang = cls ? cls.slice(9) : ctx.site.preLang?.(el);
                    return this.fence(ctx, lang, (codeEl || el).textContent);
                }
                case 'a': {
                    const text = this.inline(this.children(el, ctx));
                    if (!/^https?:/.test(el.href)) return text;
                    if (!text || text === el.href) return `<${el.href}>`;
                    return `[${text}](${this.url(el.href)})`;
                }
                case 'img': {
                    const alt = (el.alt || '').replace(/[\[\]]/g, '');
                    return /^https?:/.test(el.src) ? `![${alt}](${this.url(el.src)})` : (alt ? `[image: ${alt}]` : '');
                }
                case 'ul': case 'ol': return this.list(el, ctx);
                case 'table': return this.table(el, ctx);
                case 'blockquote':
                    return this.block(this.tidy(this.children(el, ctx)).split('\n').map(l => l ? '> ' + l : '>').join('\n'));
                default: {
                    const inner = this.children(el, ctx);
                    return BLOCK_TAGS.has(tag) ? this.block(inner) : inner;
                }
            }
        },
        block: s => s.trim() ? '\n\n' + s.trim() + '\n\n' : '',
        inline: s => s.replace(/\s*\n\s*/g, ' ').trim(),
        wrap(s, m) {
            if (!s.trim() || s.includes('\n\n')) return s;
            return s.match(/^\s*/)[0] + m + s.trim() + m + s.match(/\s*$/)[0];
        },
        code(ctx, text) {
            ctx.codes.push(text);
            return `\u0000${ctx.codes.length - 1}\u0000`;
        },
        inlineCode(ctx, text) {
            if (!text) return '';
            const f = text.includes('`') ? '``' : '`';
            const pad = /^`|`$/.test(text) ? ' ' : '';
            return this.code(ctx, f + pad + text + pad + f);
        },
        fence(ctx, lang, code) {
            const longest = Math.max(2, ...(code.match(/`+/g) || []).map(r => r.length));
            const f = '`'.repeat(Math.max(3, longest + 1));
            lang = (lang || '').trim().split(/\s+/)[0] || '';
            return this.block(this.code(ctx, `${f}${lang}\n${code.replace(/\n+$/, '')}\n${f}`));
        },
        list(el, ctx) {
            const ordered = el.tagName === 'OL';
            let n = parseInt(el.getAttribute('start') || '1', 10);
            const items = [...el.children].filter(c => c.tagName === 'LI').map(li => {
                const marker = ordered ? `${n++}. ` : '- ';
                const pad = '\u0001'.repeat(marker.length);
                const body = this.tidy(this.children(li, ctx));
                return marker + body.split('\n').map((l, i) => (i && l) ? pad + l : l).join('\n');
            });
            return this.block(items.join('\n'));
        },
        table(el, ctx) {
            const rows = [...el.querySelectorAll('tr')].map(tr => [...tr.children]
                .filter(c => c.tagName === 'TH' || c.tagName === 'TD')
                .map(td => this.inline(this.children(td, ctx)).replace(/\|/g, '\\|')));
            if (!rows.length) return '';
            const w = Math.max(...rows.map(r => r.length));
            rows.forEach(r => { while (r.length < w) r.push(''); });
            const line = r => '| ' + r.join(' | ') + ' |';
            return this.block([line(rows[0]), line(rows[0].map(() => '---')), ...rows.slice(1).map(line)].join('\n'));
        },
        url: u => u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29'),
        tidy: s => s
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n[ \t]+/g, '\n')
            .replace(/([^\s\u0001]) {2,}/g, '$1 ')
            .replace(/\n{3,}/g, '\n\n')
            .trim(),
        // For Markdown that arrives ready-made: shift ATX headings outside code fences so they start at ###.
        shiftHeadings(s) {
            const lines = s.split('\n'), heads = [];
            let fence = null;
            lines.forEach((l, i) => {
                const f = l.match(/^\s*(`{3,}|~{3,})/)?.[1];
                if (f) { if (!fence) fence = f; else if (f[0] === fence[0] && f.length >= fence.length) fence = null; }
                else if (!fence && /^#{1,6}\s/.test(l)) heads.push(i);
            });
            if (!heads.length) return s;
            const shift = Math.max(0, 3 - Math.min(...heads.map(i => lines[i].match(/^#+/)[0].length)));
            heads.forEach(i => { lines[i] = lines[i].replace(/^#+/, h => '#'.repeat(Math.min(6, h.length + shift))); });
            return lines.join('\n');
        }
    };

    // ---- Export ----

    const Chat = {
        site: () => Object.values(Sites).find(s => s.match(location.hostname)),
        async collect(fmt, progress) {
            const site = this.site();
            if (!site) return null;
            const rawTitle = (site.title() || document.title || '').trim();
            const title = (site.titleSuffix ? rawTitle.replace(site.titleSuffix, '') : rawTitle).trim() || 'Export';
            const base = { site, title, exportDate: new Date(), source: location.origin + location.pathname };

            // Sites with an API get the whole conversation from it; HTML still copies the rendered DOM.
            if (site.api && fmt !== 'html') {
                progress?.('Loading…');
                const { startDate, turns, warnings = [] } = await site.api();
                return { ...base, startDate: Util.validDate(startDate), turns, warnings: [...warnings, ...this.check(turns)] };
            }

            const turns = site.turns();
            if (!turns.length) return null;

            let startDate = null;
            if (site.startDate) {
                progress?.('Dates…');
                startDate = await Util.withTimeout(site.startDate(), 3000).then(Util.validDate).catch(e => {
                    console.warn(LOG, 'start date lookup failed:', e.message);
                    return null;
                });
            }

            return {
                ...base, startDate,
                // The page renders only part of a long conversation, so HTML may be incomplete.
                warnings: fmt === 'html' && site.api ? ['HTML holds only the turns the page has rendered'] : [],
                turns: turns.map(t => ({
                    role: t.role,
                    label: (site.label?.(t) || site.labels[t.role]).trim().replace(/:$/, ''),
                    contentEl: site.content(t.el),
                    md: fmt === 'html' ? '' : Md.convert(site.content(t.el), site)
                }))
            };
        },
        // Undocumented APIs drift; flag API output that suggests a field moved and content was silently lost.
        check(turns) {
            const w = [];
            const empty = turns.filter(t => !t.md.trim()).map(t => t.role);
            if (empty.length) w.push(`${empty.length} empty message(s) (${[...new Set(empty)].join(', ')})`);
            // Code may legitimately contain "[^1]" or "[cite: 1]", so leave it out.
            const md = turns.map(t => t.md).join('\n').replace(/^(`{3,})[^\n]*\n[\s\S]*?^\1`*$/gm, '').replace(/`[^`\n]*`/g, '');
            const defs = new Set((md.match(/^\[\^[\d.]+\]:/gm) || []).map(s => s.slice(0, -1)));
            const missing = new Set((md.match(/\[\^[\d.]+\](?!:)/g) || []).filter(r => !defs.has(r)));
            if (missing.size) w.push(`${missing.size} footnote(s) without a source`);
            const cites = (md.match(/\[cite:[^\]]*\]/g) || []).length;
            if (cites) w.push(`${cites} unconverted [cite] marker(s)`);
            return w;
        },
        frontmatter(d) {
            const lines = ['---', 'status: report', `title: ${Util.yamlStr('Exported LLM Chat: ' + d.title)}`];
            if (d.startDate) lines.push(`date: ${Util.fmtDate(d.startDate)}`, `updated: ${Util.fmtDate(d.exportDate)}`);
            else lines.push(`date: ${Util.fmtDate(d.exportDate)}`);
            lines.push(`source: ${d.source}`, '---');
            return lines.join('\n');
        },
        build(fmt, d) {
            if (fmt === 'json') {
                const meta = { title: d.title, source: d.source };
                if (d.startDate) { meta.date = Util.fmtDate(d.startDate); meta.updated = Util.fmtDate(d.exportDate); }
                else meta.date = Util.fmtDate(d.exportDate);
                return { c: JSON.stringify({ ...meta, messages: d.turns.map(t => ({ role: t.role, label: t.label, content: t.md })) }, null, 2), m: 'application/json' };
            }
            if (fmt === 'csv') {
                const q = s => `"${s.replace(/"/g, '""')}"`;
                return { c: "role,label,content\n" + d.turns.map(t => [t.role, t.label, t.md].map(q).join(',')).join('\n') + '\n', m: 'text/csv' };
            }
            if (fmt === 'html') {
                const body = d.turns.map(t => t.role === 'user'
                    ? `<h2>${Util.escHtml(t.label)}</h2><div style="background:#f4f4f5;padding:15px;border-radius:12px;margin:20px 0;">${t.contentEl.innerHTML}</div>`
                    : `<h2>${Util.escHtml(t.label)}</h2><div>${t.contentEl.innerHTML}</div><hr/>`).join('');
                return { c: `<html><head><meta charset="utf-8"><title>${Util.escHtml(d.title)}</title></head><body style="font-family:sans-serif;max-width:800px;margin:auto;padding:30px;line-height:1.7;"><h1>${Util.escHtml(d.title)}</h1>${body}</body></html>`, m: 'text/html' };
            }
            if (fmt === 'md') {
                return { c: `${this.frontmatter(d)}\n\n# ${d.title}\n\n` + d.turns.map(t => `## ${t.label}\n\n${t.md}\n`).join('\n'), m: 'text/markdown' };
            }
            return { c: `${d.title}\n${d.source}\n\n` + d.turns.map(t => `${t.label}:\n\n${t.md}\n`).join('\n'), m: 'text/plain' };
        },
        async export(fmt, progress) {
            const d = await this.collect(fmt, progress);
            if (!d) return;
            const { c, m } = this.build(fmt, d);
            const b = new Blob([c], { type: m });
            const u = URL.createObjectURL(b), a = document.createElement("a");
            const day = Util.fmtDate(d.startDate || d.exportDate).slice(0, 10).replace(/-/g, '');
            a.href = u; a.download = `${day}-${Util.fileName(d.title)}.${fmt}`; document.body.appendChild(a); a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(u); }, 0);
            return d.warnings;
        }
    };

    GM_addStyle(`
        .ai-export-drag-box { position: fixed; z-index: 2147483646; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(28,28,30,0.85); backdrop-filter: blur(12px); color: #fff; border-radius: 100px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); cursor: move; user-select: none; border: 1px solid rgba(255,255,255,0.1); padding: 10px 20px; font-family: system-ui; font-size: 14px; font-weight: 600; transition: transform 0.2s ease, opacity 0.2s; white-space: nowrap; }
        .ai-export-drag-box:hover { transform: scale(1.05); }
        .ai-export-menu-panel { position: absolute; width: max-content; min-width: 150px; background: rgba(255,255,255,0.95); backdrop-filter: blur(20px); border-radius: 16px; padding: 6px; display: none; flex-direction: column; }
        .pos-bottom-right { bottom: calc(100% + 15px); right: 0; transform-origin: bottom right; animation: aiPopUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 -10px 50px rgba(0,0,0,0.2); }
        .pos-bottom-left { bottom: calc(100% + 15px); left: 0; transform-origin: bottom left; animation: aiPopUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 -10px 50px rgba(0,0,0,0.2); }
        .pos-top-right { top: calc(100% + 15px); right: 0; transform-origin: top right; animation: aiPopDown 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 10px 50px rgba(0,0,0,0.2); }
        .pos-top-left { top: calc(100% + 15px); left: 0; transform-origin: top left; animation: aiPopDown 0.3s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 10px 50px rgba(0,0,0,0.2); }
        @media (prefers-color-scheme: dark) {
            .ai-export-menu-panel { background: rgba(30,30,34,0.9); }
            .pos-bottom-right, .pos-bottom-left { box-shadow: 0 -10px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1); }
            .pos-top-right, .pos-top-left { box-shadow: 0 10px 50px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1); }
        }
        @keyframes aiPopUp { 0% { opacity: 0; transform: scale(0.9) translateY(10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        @keyframes aiPopDown { 0% { opacity: 0; transform: scale(0.9) translateY(-10px); } 100% { opacity: 1; transform: scale(1) translateY(0); } }
        .ai-export-menu-item { display: flex; align-items: center; padding: 12px 14px; background: transparent; border: none; border-radius: 10px; text-align: left; cursor: pointer; color: #333; font-size: 13px; font-weight: 500; transition: 0.15s ease; width: 100%; white-space: nowrap; }
        @media (prefers-color-scheme: dark) { .ai-export-menu-item { color: #eee; } }
        .ai-export-menu-item:hover { background: rgba(16,163,127,0.15); color: #10a37f; }
        .ai-export-toast { position: fixed; z-index: 2147483647; max-width: 360px; padding: 12px 16px; border-radius: 12px; background: #fff8e1; color: #3e2f00; border-left: 4px solid #f5a623; box-shadow: 0 8px 32px rgba(0,0,0,0.25); font: 13px/1.5 system-ui; cursor: pointer; animation: aiPopUp 0.3s cubic-bezier(0.16, 1, 0.3, 1); }
        .ai-export-toast.error { background: #fdecea; color: #5f1410; border-left-color: #d93025; }
        .ai-export-toast b { display: block; margin-bottom: 4px; }
        @media (prefers-color-scheme: dark) {
            .ai-export-toast { background: #3a3020; color: #ffe8b0; }
            .ai-export-toast.error { background: #3d1f1d; color: #ffd2cc; }
        }
        .ai-export-menu-item.clicked { transform: scale(0.92); background: rgba(16,163,127,0.3); opacity: 0.7; }
    `);

    function init() {
        if (document.querySelector('.ai-export-drag-box')) return;
        const box = CommonUtil.createElement("div", { className: "ai-export-drag-box" });
        box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;pointer-events:none;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg><span>${exportLabel}</span></div>`;
        const labelSpan = box.querySelector('span');
        const menu = CommonUtil.createElement("div", { className: "ai-export-menu-panel" });
        let busy = false, toast = null;
        // Warnings and errors go in a toast next to the button: warnings fade after 10s, errors stay until clicked.
        const showToast = (head, lines, error) => {
            toast = CommonUtil.createElement('div', {
                className: 'ai-export-toast' + (error ? ' error' : ''),
                childrens: [CommonUtil.createElement('b', { text: head }), ...lines.map(l => CommonUtil.createElement('div', { text: '• ' + l }))]
            });
            const rect = box.getBoundingClientRect(), t = toast;
            t.style.right = Math.max(8, window.innerWidth - rect.right) + 'px';
            if (rect.top > window.innerHeight / 2) t.style.bottom = (window.innerHeight - rect.top + 12) + 'px';
            else t.style.top = (rect.bottom + 12) + 'px';
            t.onclick = () => t.remove();
            if (!error) setTimeout(() => t.remove(), 10000);
            document.body.appendChild(t);
        };
        ['md', 'json', 'csv', 'txt', 'html'].forEach(ext => {
            const btn = CommonUtil.createElement("button", { className: "ai-export-menu-item", text: `${exportLabel} .${ext.toUpperCase()}` });
            btn.onclick = (e) => {
                e.stopPropagation();
                if (busy) return;
                btn.classList.add('clicked');
                setTimeout(async () => {
                    btn.classList.remove('clicked');
                    menu.style.display = 'none';
                    busy = true;
                    toast?.remove();
                    try {
                        const warnings = await Chat.export(ext, msg => { labelSpan.textContent = msg; });
                        if (warnings?.length) {
                            console.warn(LOG, 'export warnings:', warnings);
                            showToast('Exported, but check:', warnings, false);
                        }
                    } catch (err) {
                        console.error(LOG, 'export failed:', err);
                        showToast('Export failed:', [err.message, 'Details in the console.'], true);
                    } finally {
                        busy = false;
                        labelSpan.textContent = exportLabel;
                    }
                }, 200);
            };
            menu.appendChild(btn);
        });
        box.appendChild(menu);
        document.body.appendChild(box);
        // Anchored to the bottom-right corner, so it follows window resizes and zoom.
        // The saved offsets are kept as-is; only the applied position is clamped to the viewport.
        let offR = GM_getValue('right', 40), offB = GM_getValue('bottom', 60);
        const place = (r, b) => {
            box.style.right = Math.max(0, Math.min(r, window.innerWidth - box.offsetWidth)) + 'px';
            box.style.bottom = Math.max(0, Math.min(b, window.innerHeight - box.offsetHeight)) + 'px';
        };
        place(offR, offB);
        const onResize = () => { if (!box.isConnected) return window.removeEventListener('resize', onResize); place(offR, offB); };
        window.addEventListener('resize', onResize);
        let drag = false, moved = false, sX0, sY0, iR, iB;
        box.onmousedown = (e) => { drag = true; moved = false; sX0 = e.clientX; sY0 = e.clientY; iR = parseFloat(box.style.right); iB = parseFloat(box.style.bottom); e.preventDefault(); };
        document.onmousemove = (e) => {
            if (!drag) return;
            const dx = e.clientX - sX0, dy = e.clientY - sY0;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            place(iR - dx, iB - dy);
        };
        document.onmouseup = () => {
            if (drag && moved) { offR = parseFloat(box.style.right); offB = parseFloat(box.style.bottom); GM_setValue('right', offR); GM_setValue('bottom', offB); }
            drag = false;
        };
        box.onclick = () => {
            if (!moved) {
                if (menu.style.display !== 'flex') {
                    const rect = box.getBoundingClientRect();
                    const isBottom = rect.top > window.innerHeight / 2;
                    const isRight = rect.left > window.innerWidth / 2;

                    menu.className = 'ai-export-menu-panel';
                    if (isBottom && isRight) menu.classList.add('pos-bottom-right');
                    else if (isBottom && !isRight) menu.classList.add('pos-bottom-left');
                    else if (!isBottom && isRight) menu.classList.add('pos-top-right');
                    else if (!isBottom && !isRight) menu.classList.add('pos-top-left');

                    menu.style.display = 'flex';
                } else {
                    menu.style.display = 'none';
                }
            }
        };
        document.addEventListener("click", (e) => { if (!box.contains(e.target)) menu.style.display = 'none'; });
    }

    if (typeof trustedTypes !== "undefined" && trustedTypes.defaultPolicy === null) {
        trustedTypes.createPolicy("default", { createHTML: s => s, createScriptURL: s => s, createScript: s => s });
    }
    setTimeout(init, 1000);
    setInterval(init, 3000);
})();
