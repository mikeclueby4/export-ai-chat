// ==UserScript==
// @name         Export ChatGPT/Gemini/Grok/Claude Chat -> MD, JSON, CSV, TXT, HTML
// @description  Export ChatGPT, Gemini, Grok, Claude conversations to Markdown, JSON, CSV, TXT, HTML
// @namespace    mikeclueby4/export-ai-chat
// @version      1.1.0
// @author       Kairox
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
        sleep: ms => new Promise(r => setTimeout(r, ms)),
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
        scrollParent(el) {
            for (let e = el?.parentElement; e; e = e.parentElement) {
                const oy = getComputedStyle(e).overflowY;
                if ((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight) return e;
            }
            return document.scrollingElement;
        },
        escHtml: s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    };

    // ---- Per-site logic: selectors, labels, code blocks, title and dates live here ----

    const Sites = {
        chatGPT: {
            match: h => h.includes('chatgpt.com'),
            labels: { user: 'You said', assistant: 'ChatGPT said' },
            title: () => document.querySelector('#history a[data-active]')?.textContent,
            turns: () => [...document.querySelectorAll('div[data-message-id]')]
                .map(el => ({ el, role: el.dataset.messageAuthorRole === 'user' ? 'user' : 'assistant' })),
            label: t => t.el.closest('article')?.querySelector('h5.sr-only, h6.sr-only')?.textContent,
            content: el => el.querySelector('.markdown, .whitespace-pre-wrap') || el,
            skip: '',
            preLang: pre => pre.querySelector('div > div:first-child')?.textContent,
            // Unverified: endpoint and auth taken from ChatGPT's web client.
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
            title: () => document.title,
            titleSuffix: /\s*-\s*Google Gemini$/,
            turns: () => [...document.querySelectorAll('user-query-content, model-response')]
                .map(el => ({ el, role: el.matches('user-query-content') ? 'user' : 'assistant' })),
            // The hidden heading holds "<span>You said</span> <truncated query>"; take only the span.
            label: t => t.role === 'user'
                ? t.el.querySelector('.screen-reader-user-query-label span')?.textContent
                : t.el.querySelector('.screen-reader-model-response-label')?.textContent,
            content: el => el.querySelector('.query-text') || el.querySelector('message-content .markdown') || el,
            skip: 'source-footnote, thinking-overlay, model-thoughts, sources-list, .response-footer, .follow-up-button-container',
            chipSelector: 'source-inline-chip',
            hook(el, ctx, md) {
                const tag = el.tagName.toLowerCase();
                if (tag === 'source-inline-chip') {
                    const links = ctx.sources?.get(el);
                    if (links?.length) return ' (' + links.map(l => `[Source: ${l.name.replace(/[\[\]]/g, '')}](${md.url(l.href)})`).join(', ') + ')';
                    const name = el.querySelector('.source-title')?.textContent.trim();
                    const count = el.querySelector('.source-count')?.textContent.replace(/\s+/g, '');
                    return name ? ` (Source: ${name}${count ? ' ' + count : ''})` : '';
                }
                if (tag === 'follow-up') {
                    const q = el.querySelector('.follow-up-text');
                    return q ? md.block(md.children(q, ctx)) : '';
                }
                if (tag === 'code-block') {
                    const lang = el.querySelector('.code-block-decoration span, div > div > span')?.textContent;
                    return md.fence(ctx, lang, el.querySelector('pre code, pre')?.textContent ?? el.textContent);
                }
                if (el.hasAttribute('data-math')) {
                    const tex = el.getAttribute('data-math').trim();
                    return el.classList.contains('math-block') ? md.block(md.code(ctx, `$$\n${tex}\n$$`)) : md.code(ctx, `$${tex}$`);
                }
            },
            // Gemini only shows one source card at a time, so chips are resolved one by one.
            // The first failure stops resolving; the remaining chips fall back to plain text.
            async resolveSources(chips, progress) {
                const map = new Map();
                for (let i = 0; i < chips.length; i++) {
                    progress?.(`Sources ${i + 1}/${chips.length}`);
                    try {
                        const links = await this.resolveChip(chips[i]);
                        if (!links.length) throw new Error('no links');
                        map.set(chips[i], links);
                    } catch (e) {
                        console.warn(LOG, `source resolving stopped at chip ${i + 1}/${chips.length}:`, e.message);
                        break;
                    }
                }
                return map;
            },
            async resolveChip(chip) {
                const btn = chip.querySelector('button');
                if (!btn) throw new Error('no chip button');
                const anchors = () => chip.querySelectorAll('inline-source-card a[href]');
                const esc = () => ['keydown', 'keyup'].forEach(type => btn.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true })));
                try {
                    if (!anchors().length) {
                        btn.focus({ preventScroll: true });
                        // After an Escape the chip stays aria-expanded, and the next click only toggles it closed.
                        if (btn.getAttribute('aria-expanded') === 'true') { btn.click(); await Util.sleep(100); }
                        btn.click();
                    }
                    const deadline = Date.now() + 3000;
                    while (!anchors().length) {
                        if (Date.now() > deadline) throw new Error('timeout');
                        await Util.sleep(100);
                    }
                    const fallback = chip.querySelector('.source-title')?.textContent.trim() || 'link';
                    const seen = new Set(), out = [];
                    // Cards are rendered twice; dedupe by URL.
                    for (const a of anchors()) {
                        if (seen.has(a.href)) continue;
                        seen.add(a.href);
                        out.push({ name: (a.querySelector('.path-text')?.textContent || fallback).trim(), href: a.href });
                    }
                    return out;
                } finally {
                    esc();
                    await Util.sleep(50);
                }
            }
        },
        claude: {
            match: h => h.includes('claude.ai'),
            labels: { user: 'You said', assistant: 'Claude said' },
            title: () => document.title,
            titleSuffix: /\s*-\s*Claude$/,
            turns: () => [...document.querySelectorAll('[data-testid="user-message"], .font-claude-response')]
                .map(el => ({ el, role: el.matches('[data-testid="user-message"]') ? 'user' : 'assistant' })),
            content: el => el,
            skip: '',
            // Unverified: endpoint taken from claude.ai's web client.
            async startDate() {
                const id = location.pathname.match(/\/chat\/([\w-]+)/)?.[1];
                if (!id) return null;
                let org = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]+)/)?.[1];
                if (!org) org = (await Util.fetchJson('/api/organizations'))?.[0]?.uuid;
                if (!org) return null;
                const conv = await Util.fetchJson(`/api/organizations/${org}/chat_conversations/${id}`);
                return conv.created_at ? new Date(conv.created_at) : null;
            }
        }
    };

    // ---- DOM -> Markdown ----
    // Walks the live DOM read-only. Code is stashed behind \u0000n\u0000 placeholders so whitespace
    // tidying can't touch it; list indentation uses \u0001 so it survives line trimming.

    const SKIP = 'button, svg, mat-icon, script, style, noscript, template, .cdk-visually-hidden, .sr-only';
    const BLOCK_TAGS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure', 'figcaption', 'details', 'summary', 'dl', 'dt', 'dd', 'li']);

    const Md = {
        convert(root, site, sources) {
            const ctx = { site, sources, codes: [], hOffset: 0 };
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
            .trim()
    };

    // ---- Export ----

    const Chat = {
        site: () => Object.values(Sites).find(s => s.match(location.hostname)),
        async collect(fmt, progress) {
            const site = this.site();
            if (!site) return null;
            const turns = site.turns();
            if (!turns.length) return null;

            let sources = new Map();
            if (fmt !== 'html' && site.resolveSources) {
                const chips = turns.flatMap(t => [...site.content(t.el).querySelectorAll(site.chipSelector)]);
                if (chips.length) {
                    const scroller = Util.scrollParent(turns[0].el), top = scroller?.scrollTop, active = document.activeElement;
                    try {
                        sources = await site.resolveSources(chips, progress);
                    } finally {
                        if (scroller) scroller.scrollTop = top;
                        active?.focus?.({ preventScroll: true });
                    }
                }
            }

            let startDate = null;
            if (site.startDate) {
                progress?.('Dates…');
                startDate = await Util.withTimeout(site.startDate(), 3000).then(Util.validDate).catch(e => {
                    console.warn(LOG, 'start date lookup failed:', e.message);
                    return null;
                });
            }

            const rawTitle = (site.title() || document.title || '').trim();
            const title = (site.titleSuffix ? rawTitle.replace(site.titleSuffix, '') : rawTitle).trim() || 'Export';
            return {
                site, title, startDate,
                exportDate: new Date(),
                source: location.origin + location.pathname,
                turns: turns.map(t => ({
                    role: t.role,
                    label: (site.label?.(t) || site.labels[t.role]).trim().replace(/:$/, ''),
                    contentEl: site.content(t.el),
                    md: fmt === 'html' ? '' : Md.convert(site.content(t.el), site, sources)
                }))
            };
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
            a.href = u; a.download = `${Util.fileName(d.title)}.${fmt}`; document.body.appendChild(a); a.click();
            setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(u); }, 0);
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
        .ai-export-menu-item.clicked { transform: scale(0.92); background: rgba(16,163,127,0.3); opacity: 0.7; }
    `);

    function init() {
        if (document.querySelector('.ai-export-drag-box')) return;
        const box = CommonUtil.createElement("div", { className: "ai-export-drag-box" });
        box.innerHTML = `<div style="display:flex;align-items:center;gap:8px;pointer-events:none;"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg><span>${exportLabel}</span></div>`;
        const labelSpan = box.querySelector('span');
        const menu = CommonUtil.createElement("div", { className: "ai-export-menu-panel" });
        let busy = false;
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
                    try {
                        await Chat.export(ext, msg => { labelSpan.textContent = msg; });
                    } catch (err) {
                        console.error(LOG, 'export failed:', err);
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
        const sX = GM_getValue('x', window.innerWidth - 160), sY = GM_getValue('y', window.innerHeight - 100);
        box.style.left = Math.max(0, Math.min(sX, window.innerWidth - 120)) + 'px'; box.style.top = Math.max(0, Math.min(sY, window.innerHeight - 60)) + 'px';
        let drag = false, moved = false, sX0, sY0, iL, iT;
        box.onmousedown = (e) => { drag = true; moved = false; sX0 = e.clientX; sY0 = e.clientY; iL = box.offsetLeft; iT = box.offsetTop; e.preventDefault(); };
        document.onmousemove = (e) => {
            if (!drag) return;
            const dx = e.clientX - sX0, dy = e.clientY - sY0;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;
            box.style.left = (iL + dx) + 'px'; box.style.top = (iT + dy) + 'px';
        };
        document.onmouseup = () => { if (drag && moved) { GM_setValue('x', box.offsetLeft); GM_setValue('y', box.offsetTop); } drag = false; };
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
