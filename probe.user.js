// ==UserScript==
// @name         学习通 自动播放触发链 探测
// @namespace    local.codex.xuexitong.probe
// @version      0.1.0
// @description  在 user.js 之前注入。记录每一次 play() 调用与 app 内部触发链，定位"到底是哪一层逻辑触发了自动播放"
// @match        *://mooc1.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mooc2-ans/mycourse/studentstudy*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const T0 = performance.now();
    const events = [];
    const COLORS = {
        play:  '#4CAF50', media: '#00BCD4', wrap:  '#9C27B0',
        click: '#3F51B5', warn:  '#FF9800', err:   '#F44336', info: '#607D8B',
    };

    function rec(cat, msg, extra) {
        const e = Object.assign({ idx: events.length, t: +(performance.now() - T0).toFixed(1), cat, msg }, extra || {});
        events.push(e);
        const c = COLORS[cat] || '#000';
        console.log(`%c[probe ${e.t}ms #${e.idx}] ${cat}: ${msg}`, `color:${c}`);
        if (e.stack) console.log(e.stack);
        return e;
    }

    function shortStack(skip) {
        const s = (new Error()).stack || '';
        return s.split('\n').slice(2 + (skip || 0), 9).map(x => x.trim()).join('\n');
    }

    // ---- 1. 拦截每一次 HTMLMediaElement.prototype.play ----
    function patchPlay(win, label) {
        try {
            const proto = win && win.HTMLMediaElement && win.HTMLMediaElement.prototype;
            if (!proto || proto.__probe_patched) return false;
            const orig = proto.play;
            proto.play = function () {
                const id = this.id || '(no id)';
                const ct = Number(this.currentTime || 0);
                const e = rec('play', `play() on <${this.tagName.toLowerCase()}#${id}> ct=${ct.toFixed(2)} muted=${!!this.muted} paused=${!!this.paused}`, {
                    window: label, stack: shortStack(),
                });
                let p;
                try { p = orig.apply(this, arguments); }
                catch (err) { rec('err', `play() threw: ${err.message}`, { ref: e.idx }); throw err; }
                if (p && typeof p.then === 'function') {
                    p.then(() => rec('play', `play() resolved (#${e.idx})`, { ref: e.idx }))
                     .catch(err => rec('warn', `play() rejected: ${err.name} ${err.message} (#${e.idx})`, { ref: e.idx }));
                }
                return p;
            };
            proto.__probe_patched = true;
            rec('wrap', `patched HTMLMediaElement.prototype.play in ${label}`);
            return true;
        } catch (err) {
            rec('err', `patchPlay(${label}) failed: ${err.message}`);
            return false;
        }
    }
    patchPlay(window, 'top');

    // ---- 2. 巡检 iframe，给嵌套窗口的原型也打补丁 ----
    const seen = new WeakSet();
    function scanFrames() {
        let frames;
        try { frames = document.querySelectorAll('iframe'); } catch (_) { return; }
        frames.forEach(f => {
            if (seen.has(f)) return;
            let w; try { w = f.contentWindow; } catch (_) { return; }
            if (!w) return;
            const ok = patchPlay(w, `iframe[${(f.src || '').slice(0, 80)}]`);
            if (ok) seen.add(f);
            try {
                const doc = w.document;
                attachMediaListeners(doc, `iframe[${(f.src || '').slice(0, 40)}]`);
                doc.querySelectorAll('iframe').forEach(f2 => {
                    let w2; try { w2 = f2.contentWindow; } catch (_) { return; }
                    if (!w2) return;
                    const ok2 = patchPlay(w2, `iframe2[${(f2.src || '').slice(0, 80)}]`);
                    if (ok2) {
                        try { attachMediaListeners(w2.document, `iframe2[${(f2.src || '').slice(0, 40)}]`); } catch (_) {}
                    }
                });
            } catch (_) {}
        });
    }
    setInterval(scanFrames, 500);

    // ---- 3. 监听 media 事件（捕获阶段） ----
    function attachMediaListeners(doc, label) {
        if (!doc || doc.__probe_media_listeners) return;
        ['play', 'playing', 'pause', 'loadedmetadata', 'ended', 'stalled'].forEach(ev => {
            try {
                doc.addEventListener(ev, e => {
                    const t = e.target;
                    if (!t || typeof t.tagName !== 'string') return;
                    if (t.tagName !== 'VIDEO' && t.tagName !== 'AUDIO') return;
                    rec('media', `${ev} on <${t.tagName.toLowerCase()}#${t.id || '(no id)'}> ct=${Number(t.currentTime || 0).toFixed(2)} dur=${Number(t.duration || 0).toFixed(2)}`, { window: label });
                }, true);
            } catch (_) {}
        });
        doc.__probe_media_listeners = true;
    }
    attachMediaListeners(document, 'top');

    // ---- 4. 拦截 window.app 的关键方法 ----
    const APP_METHODS = [
        'run', 'play', 'nextUnit', 'playCurrentIndex',
        '_kickPlay', '_simulateClickToPlay', '_fireClick',
        '_tryResumePlayback', '_handlePlayError',
        '_handleVideoLoaded', '_handleVideoPlay', '_handleVideoEnded', '_handleVideoPause',
        '_videoEventHandle', '_startVideoMonitoring', '_startRebindLoop',
        '_advanceLearningStep', '_advanceAfterVideo',
    ];

    function describeArg(a) {
        if (a == null) return String(a);
        if (typeof a === 'string') return JSON.stringify(a.length > 40 ? a.slice(0, 40) + '…' : a);
        if (typeof a === 'number' || typeof a === 'boolean') return String(a);
        if (a && a.tagName) return `<${a.tagName.toLowerCase()}#${a.id || ''}>`;
        return typeof a;
    }

    function wrapApp(app) {
        let n = 0;
        APP_METHODS.forEach(name => {
            const orig = app[name];
            if (typeof orig !== 'function' || orig.__probe_wrapped) return;
            const wrapped = function () {
                const args = Array.prototype.slice.call(arguments);
                const e = rec('wrap', `app.${name}(${args.map(describeArg).join(',')})`, { stack: shortStack(1) });
                try {
                    const r = orig.apply(this, arguments);
                    if (r && typeof r.then === 'function') {
                        r.then(() => rec('wrap', `app.${name} resolved (#${e.idx})`, { ref: e.idx }))
                         .catch(err => rec('warn', `app.${name} rejected: ${err.message} (#${e.idx})`, { ref: e.idx }));
                    }
                    return r;
                } catch (err) {
                    rec('err', `app.${name} threw: ${err.message} (#${e.idx})`, { ref: e.idx });
                    throw err;
                }
            };
            wrapped.__probe_wrapped = true;
            app[name] = wrapped;
            n++;
        });
        rec('info', `wrapped ${n} methods on window.app`);
    }

    // 在 user.js 设置 window.app 之前，用 getter/setter 抢占
    let _app;
    try {
        Object.defineProperty(window, 'app', {
            configurable: true,
            get() { return _app; },
            set(v) {
                _app = v;
                if (v && typeof v === 'object') {
                    rec('info', 'window.app was assigned — instrumenting now');
                    try { wrapApp(v); } catch (err) { rec('err', `wrapApp failed: ${err.message}`); }
                }
            },
        });
    } catch (err) {
        rec('err', `defineProperty(window,'app') failed: ${err.message}`);
    }

    // ---- 5. 暴露查询接口 ----
    window.__probe = {
        events,
        // 找到第一次真实 'playing' 事件，往回追溯触发链
        summary() {
            const firstPlaying = events.find(e => e.cat === 'media' && e.msg.startsWith('playing'));
            if (!firstPlaying) {
                console.log('%c[probe] 还没观察到 playing 事件 —— 视频尚未真正开始播放', `color:${COLORS.warn}`);
                return null;
            }
            // 向前找最近一次 play() 调用
            let triggerPlay = null;
            for (let i = firstPlaying.idx; i >= 0; i--) {
                if (events[i].cat === 'play' && events[i].msg.startsWith('play()')) { triggerPlay = events[i]; break; }
            }
            // 在 triggerPlay 之前再向前列出 12 条 wrap/play/media，作为触发链
            const startIdx = triggerPlay ? triggerPlay.idx : firstPlaying.idx;
            const trail = [];
            for (let i = startIdx; i >= 0 && trail.length < 15; i--) {
                const e = events[i];
                if (e.cat === 'wrap' || e.cat === 'play' || e.cat === 'media') trail.unshift(e);
            }
            console.group(`%c[probe] 首次 playing @ ${firstPlaying.t}ms ←  触发链(从早到晚)`, `color:${COLORS.play};font-weight:bold`);
            trail.forEach(e => console.log(`#${e.idx} +${e.t}ms  [${e.cat.padEnd(5)}] ${e.msg}`));
            if (triggerPlay && triggerPlay.stack) {
                console.log(`%c--- 直接调用 play() 的栈 ---`, `color:${COLORS.info}`);
                console.log(triggerPlay.stack);
            }
            console.groupEnd();
            return { firstPlaying, triggerPlay, trail };
        },
        // 列出所有 play() 调用与它们各自的来源
        playCalls() {
            const calls = events.filter(e => e.cat === 'play' && e.msg.startsWith('play()'));
            console.group(`%c[probe] 共 ${calls.length} 次 play() 调用`, `color:${COLORS.play};font-weight:bold`);
            calls.forEach(e => {
                const top = (e.stack || '').split('\n')[0] || '(no stack)';
                console.log(`#${e.idx} +${e.t}ms ${e.msg}\n        ↳ ${top}`);
            });
            console.groupEnd();
            return calls;
        },
        clear() { events.length = 0; rec('info', 'events cleared'); },
    };

    rec('info', 'probe installed at document-start. 启动后调用 __probe.summary() 查看触发链');
})();
