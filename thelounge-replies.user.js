// ==UserScript==
// @name         Replies for TheLounge
// @namespace    https://thelounge.chat/
// @version      1.1.0
// @description  Quote messages in chat
// @match        *://your-thelounge-domain.com/*
// @author       spindrift
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// Thanks to greglechin, Ether, lejosh, DAWG for testing and suggestions
// Thanks to lizzie for inspiring me to add mobile support faster
// "lounge best" –corigins

(function () {
    'use strict';

    // ---------------------------------------------------------------------
    // Configuration
    // ---------------------------------------------------------------------
    const CONFIG = {
        // Where the ↩ button appears on hover. One of:
        //   "end-of-message" : flows inline at the end of the message text
        //   "right-edge"     : absolute, pinned to the right edge of the .msg row
        //   "left-edge"      : absolute, pinned to the left edge of the .msg row
        // The edge modes align vertically with the first line of the message.
        buttonPosition: 'end-of-message',

        // Padding (in px) from the .msg edge for "right-edge" / "left-edge".
        edgePadding: 5,

        // Delay (in ms) the pointer must dwell over a message before the ↩
        // button appears. Keeps the button from flickering in as the cursor
        // sweeps across the log. Set to 0 to show it immediately on hover.
        hoverDelay: 250,

        // Strip URL protocols (https://, http://, etc.) from the quoted text.
        // Helps avoid re-triggering link previews when the reply is sent.
        // Links remain clickable in most IRC clients without the protocol.
        stripUrlProtocols: true,

        // Strip mIRC formatting from the quoted text. When false, the original
        // formatting in the source message is preserved.
        stripFormatting: false,

        // Truncation of the quoted message
        truncate: true,          // false = never truncate
        truncateLength: 75,     // chars before … is appended

        // Line-break handling inside the quoted message: "truncate" | "collapse" | "none"
        lineBreakMode: 'truncate',

        // What to do if the textarea already has content:
        //   "prepend" : [quote] [separator] [existing text]   (cursor at end)
        //   "append"  : [existing text] [separator] [quote]   (cursor at end)
        //   "replace" : [quote] (cursor at end)
        existingTextMode: 'prepend',

        // Formatting style for the quoted message and separator.
        // One of: "color", "none", "bold", "italic", "bolditalic"
        quoteStyle: 'italic',

        // Colors used only when quoteStyle === "color" (mIRC color codes 00-15)
        quoteColor: '14',        // light gray
        separatorColor: '15',    // silver

        // Separator string shown between the quoted message and your reply.
        // The separator is never styled or wrapped in quotes.
        separator: '|', // Other good options: '::', '⇒', '➠',

        // Wrap the quoted message text in quote marks (e.g. "hello there")
        addQuotes: true,
        quoteOpen: '"',
        quoteClose: '"',

        // Characters placed around the username. Defaults give <username>.
        // Examples:
        //   "<", ">"  -> <username>
        //   "",  ":"  -> username:
        //   "(", ")"  -> (username)
        //   "[", "]"  -> [username]
        usernamePrefix: '',
        usernameSuffix: ':',

        // Reveal the ↩ button when a message is tapped. This is the primary
        // entrypoint on touch devices, where hover isn't available. Mouse
        // users keep the hover-dwell behavior regardless of this setting.
        tapToReveal: true,
    };

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------
    const COLOR = '\x03';
    const BOLD = '\x02';
    const ITALIC = '\x1d';
    const RESET = '\x0f';
    // Strip mIRC formatting from the quoted text so our wrap stays intact.
    // Matches: color (03 with optional fg[,bg]), bold (02), italic (1d),
    // underline (1f), reverse (16), reset (0f), monospace (11).
    const FORMATTING_RE = /\x03(\d{1,2}(,\d{1,2})?)?|[\x02\x0f\x11\x16\x1d\x1f]/g;

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------
    function stripFormatting(text) {
        return text.replace(FORMATTING_RE, '');
    }

    function handleLineBreaks(text, mode) {
        if (mode === 'collapse') {
            return text.replace(/\s*\n+\s*/g, ' ');
        }
        if (mode === 'truncate') {
            const idx = text.search(/\r?\n/);
            return idx === -1 ? text : text.slice(0, idx);
        }
        return text; // "none"
    }

    function maybeTruncate(text) {
        if (!CONFIG.truncate) return text;
        if (text.length <= CONFIG.truncateLength) return text;
        let cut = text.slice(0, CONFIG.truncateLength);
        // Back up to the last whitespace so we don't truncate mid-word.
        // If there's no whitespace at all (one huge word) fall back to the
        // hard cut so we don't return an empty string.
        const lastSpace = cut.search(/\s\S*$/);
        if (lastSpace > 0) {
            cut = cut.slice(0, lastSpace);
        }
        return cut.replace(/\s+$/, '') + '…';
    }

    // Process the raw message content (optionally strip formatting, handle
    // line breaks, optionally strip URL protocols, collapse whitespace,
    // truncate). Returns the bare text.
    function processContent(rawContent) {
        let content = CONFIG.stripFormatting ? stripFormatting(rawContent) : rawContent;
        content = handleLineBreaks(content, CONFIG.lineBreakMode);
        if (CONFIG.stripUrlProtocols) {
            // Strip scheme from URLs so they don't trigger fresh previews.
            // Matches common schemes followed by ://. Word-boundary anchored
            // so we don't accidentally chew into adjacent text.
            content = content.replace(/\b(?:https?|ftp|ftps|sftp|ws|wss):\/\//gi, '');
        }
        content = content.replace(/[ \t]+/g, ' ').trim();
        return maybeTruncate(content);
    }

    // Return [openCode, closeCode] for the configured quoteStyle.
    // closeCode terminates the formatting so the separator/reply aren't styled.
    function styleCodes() {
        switch (CONFIG.quoteStyle) {
            case 'none':
                return ['', ''];
            case 'bold':
                return [BOLD, BOLD];
            case 'italic':
                return [ITALIC, ITALIC];
            case 'bolditalic':
                return [BOLD + ITALIC, ITALIC + BOLD];
            case 'color':
            default:
                // For color mode, close the quote color with a reset.
                return [COLOR + CONFIG.quoteColor, RESET];
        }
    }

    // Format the username with the configured prefix/suffix.
    function formatUsername(username) {
        return `${CONFIG.usernamePrefix}${username}${CONFIG.usernameSuffix}`;
    }

    // Wrap message content in quote marks if configured.
    function maybeQuoteContent(content) {
        if (!CONFIG.addQuotes) return content;
        return `${CONFIG.quoteOpen}${content}${CONFIG.quoteClose}`;
    }

    // Build the styled portion: "<user> message"  (quote marks, if enabled,
    // wrap the entire run including the username decoration).
    function buildStyledRun(username, content) {
        const [open, close] = styleCodes();
        const inner = `${formatUsername(username)} ${content}`;
        return `${open}${maybeQuoteContent(inner)}${close}`;
    }

    // For color mode the separator gets its own color; otherwise it's unstyled.
    function formatSeparator() {
        if (CONFIG.quoteStyle === 'color') {
            return `${COLOR}${CONFIG.separatorColor}${CONFIG.separator}${RESET}`;
        }
        return CONFIG.separator;
    }

    // "<user> message" ::      (cursor lands after this in prepend/replace)
    function buildQuotePrefix(username, content) {
        return `${buildStyledRun(username, content)} ${formatSeparator()}`;
    }

    // :: "<user> message"      (append mode — quote comes after user's text)
    function buildQuoteSuffix(username, content) {
        return `${formatSeparator()} ${buildStyledRun(username, content)}`;
    }

    // Find the textarea TheLounge is using: #input in the message form.
    function getInput() {
        return document.getElementById('input');
    }

    // Read message text from a .content element, excluding our reply button,
    // any link/media previews, and the preview toggle button. Previews
    // contain titles, descriptions, file sizes, etc. that shouldn't be
    // quoted as if they were part of the message.
    function getMessageText(contentEl) {
        const clone = contentEl.cloneNode(true);
        clone.querySelectorAll(
            '.tl-reply-btn, .preview, .preview-size, .toggle-button'
        ).forEach(n => n.remove());
        return clone.textContent || '';
    }

    // Set textarea value and notify the framework (Vue) so draft state updates.
    function setInputValue(textarea, value, cursorPos) {
        textarea.value = value;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.focus();
        const pos = cursorPos == null ? value.length : cursorPos;
        try {
            textarea.setSelectionRange(pos, pos);
        } catch (_) { /* ignore */ }
    }

    function insertQuote(username, rawContent) {
        const textarea = getInput();
        if (!textarea) return;

        const content = processContent(rawContent);
        const existing = textarea.value;
        const trimmedExisting = existing.trim();

        let next;
        if (CONFIG.existingTextMode === 'replace' || trimmedExisting === '') {
            next = buildQuotePrefix(username, content) + ' ';
        } else if (CONFIG.existingTextMode === 'append') {
            // user text first, then separator, then quote
            next = `${existing.replace(/\s+$/, '')} ${buildQuoteSuffix(username, content)}`;
        } else {
            // prepend: quote first, then existing user text
            next = `${buildQuotePrefix(username, content)} ${existing.replace(/^\s+/, '')}`;
        }

        setInputValue(textarea, next);
    }

    // Quote a whole .msg element (resolve username + content, then insert).
    function quoteMessageEl(msgEl) {
        const userEl = msgEl.querySelector('.user');
        const contentEl = msgEl.querySelector('.content');
        if (!userEl || !contentEl) return;
        const username = userEl.getAttribute('data-name') || userEl.textContent.trim();
        insertQuote(username, getMessageText(contentEl));
    }

    // ---------------------------------------------------------------------
    // Button rendering
    // ---------------------------------------------------------------------
    // We put one button per message, lazily created on first hover.
    // For absolute positions, the button is positioned relative to the .msg row.
    // For end-of-message, the button is appended inline after .content.

    function makeButton() {
        const btn = document.createElement('span');
        btn.className = 'tl-reply-btn';
        btn.textContent = '↩';
        btn.setAttribute('role', 'button');
        btn.setAttribute('aria-label', 'Reply to this message');
        btn.setAttribute('title', 'Reply');
        return btn;
    }

    function ensureButton(msgEl) {
        if (msgEl.querySelector('.tl-reply-btn')) {
            return;
        }
        const userEl = msgEl.querySelector('.user');
        const contentEl = msgEl.querySelector('.content');
        if (!userEl || !contentEl) return;

        const username = userEl.getAttribute('data-name') || userEl.textContent.trim();

        const btn = makeButton();
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            insertQuote(username, getMessageText(contentEl));
        });

        switch (CONFIG.buttonPosition) {
            case 'right-edge':
                btn.classList.add('tl-reply-btn--abs', 'tl-reply-btn--right-edge');
                ensureRelativeMsg(msgEl);
                msgEl.appendChild(btn);
                break;
            case 'left-edge':
                btn.classList.add('tl-reply-btn--abs', 'tl-reply-btn--left-edge');
                ensureRelativeMsg(msgEl);
                msgEl.appendChild(btn);
                break;
            case 'end-of-message':
            default:
                btn.classList.add('tl-reply-btn--inline');
                placeInlineButton(btn, contentEl);
                break;
        }
    }

    // Place the inline button so it flows after all the message text, but
    // before any block-level link/media preview. Message text in TheLounge
    // is a mix of bare text nodes, inline spans (URL wrappers, pings, etc.),
    // and finally any <div class="preview"> blocks. We want the button at
    // the end of the inline run, which means just before the first preview
    // block (or at the end of .content if there isn't one).
    function placeInlineButton(btn, contentEl) {
        const firstPreview = contentEl.querySelector(':scope > .preview');
        if (firstPreview) {
            contentEl.insertBefore(btn, firstPreview);
        } else {
            contentEl.appendChild(btn);
        }
    }

    function ensureRelativeMsg(msgEl) {
        const cs = getComputedStyle(msgEl);
        if (cs.position === 'static') {
            msgEl.style.position = 'relative';
        }
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------
    function injectStyles() {
        if (document.getElementById('tl-reply-style')) return;
        const style = document.createElement('style');
        style.id = 'tl-reply-style';
        style.textContent = `
            .msg .tl-reply-btn {
                cursor: pointer;
                opacity: 0;
                transition: opacity 0.1s ease-in-out;
                user-select: none;
                font-size: 0.95em;
                line-height: 1;
                color: inherit;
            }
            .msg:hover .tl-reply-btn {
                opacity: 0.55;
            }
            .msg.tl-reply-revealed .tl-reply-btn {
                opacity: 0.7;
            }
            .msg .tl-reply-btn:hover {
                opacity: 1 !important;
            }
            .msg .tl-reply-btn--abs {
                position: absolute;
                top: 0.5em;
                pointer-events: auto;
            }
            .msg .tl-reply-btn--right-edge {
                right: ${CONFIG.edgePadding}px;
            }
            .msg .tl-reply-btn--left-edge {
                left: ${CONFIG.edgePadding}px;
            }
            .msg .tl-reply-btn--inline {
                vertical-align: middle;
                margin-left: 0.4em;
                display: inline;
            }
        `;
        document.head.appendChild(style);
    }

    // ---------------------------------------------------------------------
    // Event wiring (delegated mouseover with a short dwell timer)
    // ---------------------------------------------------------------------
    // The button only appears after the pointer has lingered over a message
    // for CONFIG.hoverDelay ms. This avoids buttons flickering in across
    // every message the cursor sweeps over. We track a single pending timer
    // and cancel it if the pointer leaves the message before it fires.

    let pendingMsg = null;
    let pendingTimer = null;

    function clearPending() {
        if (pendingTimer !== null) {
            clearTimeout(pendingTimer);
            pendingTimer = null;
        }
        pendingMsg = null;
    }

    function onMouseOver(e) {
        const msg = e.target.closest && e.target.closest('.msg');
        if (!msg) {
            clearPending();
            return;
        }
        // Only handle normal messages (skip actions, joins, parts, etc.)
        if (msg.getAttribute('data-type') !== 'message') {
            clearPending();
            return;
        }
        // Button already exists — nothing to schedule.
        if (msg.querySelector('.tl-reply-btn')) return;
        // Already waiting on this same message.
        if (msg === pendingMsg) return;

        // New target: reset any pending timer and start a fresh dwell.
        clearPending();
        if (CONFIG.hoverDelay > 0) {
            pendingMsg = msg;
            pendingTimer = setTimeout(() => {
                pendingTimer = null;
                pendingMsg = null;
                // Confirm the pointer is still over this message before showing.
                if (msg.matches(':hover')) {
                    ensureButton(msg);
                }
            }, CONFIG.hoverDelay);
        } else {
            ensureButton(msg);
        }
    }

    function onMouseOut(e) {
        // If the pointer leaves the message we were waiting on, cancel.
        if (!pendingMsg) return;
        const related = e.relatedTarget;
        if (!related || !pendingMsg.contains(related)) {
            clearPending();
        }
    }

    // ---------------------------------------------------------------------
    // Tap to reveal (primary entrypoint on mobile)
    // ---------------------------------------------------------------------
    // On touch devices hover doesn't exist, so the first tap on a message
    // reveals its ↩ button, and a second tap on the same message fires the
    // reply (double-tap to reply). Tapping a different message moves the
    // reveal there; tapping empty space clears it.
    //
    // We use touchend (not click) so this only triggers from real touch
    // input — mouse users keep the hover-dwell behavior and never get a
    // sticky button from an ordinary click. A small movement threshold
    // distinguishes a tap from a scroll, and taps on the button itself or
    // on interactive content (links, etc.) are left alone.

    let touchStartXY = null;
    let revealedMsg = null;

    // Max finger travel (px) between touchstart and touchend to still count
    // as a tap rather than a scroll/swipe.
    const TAP_MOVE_TOLERANCE = 10;

    function clearRevealed() {
        if (revealedMsg) {
            revealedMsg.classList.remove('tl-reply-revealed');
            revealedMsg = null;
        }
    }

    function onTouchStart(e) {
        if (e.touches && e.touches.length === 1) {
            touchStartXY = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        } else {
            touchStartXY = null; // multi-touch / gesture — ignore
        }
    }

    function onTouchEnd(e) {
        const start = touchStartXY;
        touchStartXY = null;
        if (!start) return;

        // Reject if the finger moved too far (scroll, not a tap).
        const touch = e.changedTouches && e.changedTouches[0];
        if (touch) {
            const dx = Math.abs(touch.clientX - start.x);
            const dy = Math.abs(touch.clientY - start.y);
            if (dx > TAP_MOVE_TOLERANCE || dy > TAP_MOVE_TOLERANCE) return;
        }

        const target = e.target;

        // Let taps on the button itself, links, and other interactive bits
        // behave normally — don't hijack them as reveal toggles.
        if (target.closest('.tl-reply-btn')) return;
        if (target.closest('a, button, input, textarea, select, label, .preview')) {
            return;
        }

        const msg = target.closest && target.closest('.msg');

        // Tap outside any message clears the current reveal.
        if (!msg || msg.getAttribute('data-type') !== 'message') {
            clearRevealed();
            return;
        }

        // Second tap on the already-revealed message fires the reply
        // (double-tap to reply). The first tap revealed the arrow.
        if (msg === revealedMsg) {
            quoteMessageEl(msg);
            clearRevealed();
            return;
        }

        // First tap: reveal the arrow (moving the reveal from any prior one).
        clearRevealed();
        ensureButton(msg);
        msg.classList.add('tl-reply-revealed');
        revealedMsg = msg;
    }

    function init() {
        injectStyles();
        document.addEventListener('mouseover', onMouseOver, true);
        document.addEventListener('mouseout', onMouseOut, true);
        if (CONFIG.tapToReveal) {
            document.addEventListener('touchstart', onTouchStart, true);
            document.addEventListener('touchend', onTouchEnd, true);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
