// ==UserScript==
// @name         学习通自动刷课脚本 V3 稳定版
// @namespace    local.codex.xuexitong
// @version      3.2.0
// @description  按原版框架自动播放、自动下一节、章节测验自动跳过
// @author       Codex
// @match        *://mooc1.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mycourse/studentstudy*
// @match        *://*.chaoxing.com/mooc2-ans/mycourse/studentstudy*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    if (typeof window.jQuery === 'undefined') {
        const s = document.createElement('script');
        s.src = 'https://code.jquery.com/jquery-3.6.0.min.js';
        s.onload = () => { console.log('jQuery loaded.'); boot(); };
        document.head.appendChild(s);
    } else {
        boot();
    }

    function boot() {
        const SETTINGS_KEYS = {
            skipExerciseTestByStepAdvance: 'chaoxing.skipExerciseTestByStepAdvance'
        };
        const readBoolSetting = (key, defaultValue) => {
            try {
                const value = localStorage.getItem(key);
                return value == null ? defaultValue : value === 'true';
            } catch (e) {
                return defaultValue;
            }
        };
        const writeBoolSetting = (key, value) => {
            try { localStorage.setItem(key, value ? 'true' : 'false'); } catch (e) {}
        };

        // ============================================================
        // 一、自动播放器（V5 弹窗+点击播放修复版 基础上 + 面板联动）
        // ============================================================
        window.app = {
            configs: {
                playbackRate: 1.5,
                autoplay: true,
                retryInterval: 2000,
                maxRetries: 10,
                videoCheckInterval: 1000,
                guardNoProgressMs: 7000,
                guardResumeCooldownMs: 1500,
                videoLoadTimeoutMs: 15000,
                videoLoadPollMs: 500,
                rebindIntervalMs: 3000,
                endedNearDurationDelta: 0.5,
                endedStallMs: 4000,
                popupScanIntervalMs: 1000,
                clickToPlayRetryMs: 1500,
                panelSyncIntervalMs: 1500,
                skipExerciseTestByStepAdvance: readBoolSetting(SETTINGS_KEYS.skipExerciseTestByStepAdvance, false),
            },
            _videoEl: null,
            _videoElToken: 0,
            _treeContainerEl: null,
            _isPlaying: false,
            _checkInterval: null,
            _rebindInterval: null,
            _popupScanInterval: null,
            _panelSyncInterval: null,
            _endedHandled: false,
            _nearEndStartTs: 0,
            _cellData: { cells: 0, nCells: 0, currentCellIndex: 0, currentNCellIndex: 0, currentVideoTitle: '', currentSectionId: '' },
            run() {
                console.log('%c=== 学习通自动刷课脚本 V6 面板联动版 ===', 'color:#4CAF50;font-size:16px;font-weight:bold');
                this._getTreeContainer();
                this._initCellData();
                this._videoEl = null;
                this._endedHandled = false;
                this._clearAllIntervals();
                this._bindStepNavigation();
                this._startRebindLoop();
                this._startPopupScan();
                this._startPanelSync();
                this.play();
            },
            stop() {
                this._isPlaying = false;
                this._clearAllIntervals();
                console.log('%c自动播放已停止', 'color:#F44336');
            },
            _clearAllIntervals() {
                this._clearCheckInterval();
                this._clearRebindInterval();
                this._clearPopupScan();
                this._clearPanelSync();
            },
            nextUnit() {
                console.log('%c=== 准备切换到下一小节 ===', 'color:#2196F3;font-size:14px');
                const el = this._getTreeContainer();
                const cells = el.children('ul').children('li');
                const nCells = $(cells.get(this._cellData.currentCellIndex)).find('.posCatalog_select:not(.firstLayer)');
                if (nCells.length > this._cellData.currentNCellIndex + 1) {
                    const nextNIndex = this._cellData.currentNCellIndex + 1;
                    console.log(`%c切换到同章节下一个视频: ${nextNIndex + 1}/${nCells.length}`, 'color:#FF9800');
                    this.playCurrentIndex(nCells.get(nextNIndex));
                } else {
                    const nextIndex = this._cellData.currentCellIndex + 1;
                    if (nextIndex >= cells.length) {
                        console.log('%c==============本课程学习完成了==============', 'color:#4CAF50;font-size:16px;font-weight:bold');
                        this._clearAllIntervals();
                        return;
                    }
                    console.log(`%c切换到下一个章节: ${nextIndex + 1}/${cells.length}`, 'color:#FF9800');
                    this._cellData.currentCellIndex = nextIndex;
                    this._cellData.currentNCellIndex = 0;
                    this.playCurrentIndex();
                }
            },
            _clearCheckInterval() { if (this._checkInterval) { clearInterval(this._checkInterval); this._checkInterval = null; } },
            _clearRebindInterval() { if (this._rebindInterval) { clearInterval(this._rebindInterval); this._rebindInterval = null; } },
            _clearPopupScan() { if (this._popupScanInterval) { clearInterval(this._popupScanInterval); this._popupScanInterval = null; } },
            _clearPanelSync() { if (this._panelSyncInterval) { clearInterval(this._panelSyncInterval); this._panelSyncInterval = null; } },

            _startPopupScan() {
                this._clearPopupScan();
                const scanOnce = () => {
                    try {
                        this._closePopupsIn(document);
                        const allFrames = document.querySelectorAll('iframe');
                        allFrames.forEach((f) => {
                            try {
                                const doc = f.contentDocument || (f.contentWindow && f.contentWindow.document);
                                if (doc) {
                                    this._closePopupsIn(doc);
                                    const inner = doc.querySelectorAll('iframe');
                                    inner.forEach((fi) => {
                                        try {
                                            const d2 = fi.contentDocument || (fi.contentWindow && fi.contentWindow.document);
                                            if (d2) this._closePopupsIn(d2);
                                        } catch (e) {}
                                    });
                                }
                            } catch (e) {}
                        });
                    } catch (e) {}
                };
                scanOnce();
                this._popupScanInterval = setInterval(scanOnce, this.configs.popupScanIntervalMs);
            },
            _closePopupsIn(doc) {
                if (!doc) return;
                const popDivs = doc.querySelectorAll('.popDiv');
                popDivs.forEach((pop) => {
                    const rect = pop.getBoundingClientRect ? pop.getBoundingClientRect() : null;
                    const visible = !rect || (rect.width > 0 && rect.height > 0);
                    if (!visible) return;
                    const text = (pop.innerText || pop.textContent || '');
                    if (text.includes('任务点未完成') || text.includes('章节') || pop.querySelector('.jobLimitTip')) {
                        const closeBtn = pop.querySelector('.popClose') || pop.querySelector('a[onclick*="closeDeleteWindow"]');
                        if (closeBtn) {
                            console.log('%c检测到提示弹窗，自动关闭', 'color:#E91E63');
                            try { closeBtn.click(); } catch (e) {}
                            try { closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: doc.defaultView || window })); } catch (e) {}
                        } else {
                            try { pop.style.display = 'none'; } catch (e) {}
                        }
                    }
                });
                const masks = doc.querySelectorAll('.mask, .maskDiv, .ui-mask');
                masks.forEach((m) => {
                    try {
                        const r = m.getBoundingClientRect ? m.getBoundingClientRect() : null;
                        if (r && r.width > 0 && r.height > 0 && m.style.display !== 'none') m.style.display = 'none';
                    } catch (e) {}
                });
            },
            _startRebindLoop() {
                this._clearRebindInterval();
                this._rebindInterval = setInterval(() => {
                    try {
                        const fresh = this._queryVideoEl();
                        if (fresh && fresh !== this._videoEl) {
                            console.log('%c检测到 video 元素已替换，重新绑定事件', 'color:#9C27B0');
                            this._videoEl = fresh;
                            this._videoElToken++;
                            this._endedHandled = false;
                            this._videoEventHandle();
                            try { fresh.playbackRate = this.configs.playbackRate; } catch (e) {}
                            if (this._isPlaying) this._kickPlay(fresh);
                        } else if (fresh && this._videoEl === fresh) {
                            this._videoEventHandle();
                            if (this._isPlaying && fresh.paused && !this._isVideoEnded(fresh)) this._kickPlay(fresh);
                        }
                    } catch (e) {}
                }, this.configs.rebindIntervalMs);
            },
            // 周期性把页面 active 同步到面板
            _startPanelSync() {
                this._clearPanelSync();
                const sync = () => {
                    try {
                        const activeEl = document.querySelector('#coursetree .posCatalog_select.posCatalog_active');
                        if (!activeEl) return;
                        const id = activeEl.id;
                        if (id && id !== this._cellData.currentSectionId) {
                            this._cellData.currentSectionId = id;
                            if (window.coursePanel && typeof window.coursePanel.setActive === 'function') {
                                window.coursePanel.setActive(id, { scroll: true });
                            }
                        }
                    } catch (e) {}
                };
                sync();
                this._panelSyncInterval = setInterval(sync, this.configs.panelSyncIntervalMs);
            },
            _startVideoMonitoring() {
                this._clearCheckInterval();
                this._guardLastTime = 0;
                this._guardLastWallTs = 0;
                this._guardLastResumeTs = 0;
                this._nearEndStartTs = 0;
                this._checkInterval = setInterval(() => this._checkVideoStatus(), this.configs.videoCheckInterval);
            },
            _tryResumePlayback(reason) {
                const now = Date.now();
                if (now - this._guardLastResumeTs < this.configs.guardResumeCooldownMs) return;
                this._guardLastResumeTs = now;
                const video = this._getVideoElSafe();
                if (!video || !this._isPlaying) return;
                console.log(`%c触发视频保活恢复(${reason})`, 'color:#607D8B');
                this._kickPlay(video);
            },
            _kickPlay(video) {
                if (!video) return;
                video.play().catch((e) => {
                    console.warn('直接 play() 失败，尝试静音再 play():', e);
                    try { video.muted = true; } catch (err) {}
                    video.play().catch((err) => {
                        console.warn('静音 play() 仍失败，模拟点击:', err);
                        this._simulateClickToPlay();
                    });
                });
                this._simulateClickToPlay();
            },
            _simulateClickToPlay() {
                try {
                    const ctx = this._findVideoContext();
                    if (!ctx) return;
                    const { doc, video } = ctx;
                    const candidates = ['.vjs-big-play-button', '.video-js .vjs-big-play-button', '.vjs-poster', '.video-js', 'button[title="播放"]', '.play-btn'];
                    let clicked = false;
                    for (const sel of candidates) {
                        const el = doc.querySelector(sel);
                        if (el) {
                            const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
                            if (!r || (r.width > 0 && r.height > 0)) {
                                this._fireClick(el, doc);
                                console.log(`%c模拟点击播放器元素: ${sel}`, 'color:#3F51B5');
                                clicked = true;
                                break;
                            }
                        }
                    }
                    if (!clicked && video) {
                        this._fireClick(video, doc);
                        console.log('%c模拟点击 video 本体', 'color:#3F51B5');
                    }
                } catch (e) {}
            },
            _fireClick(el, doc) {
                try {
                    const view = (doc && doc.defaultView) || window;
                    const r = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 1, height: 1 };
                    const cx = r.left + r.width / 2;
                    const cy = r.top + r.height / 2;
                    const opts = { bubbles: true, cancelable: true, view, clientX: cx, clientY: cy, button: 0 };
                    el.dispatchEvent(new MouseEvent('mousedown', opts));
                    el.dispatchEvent(new MouseEvent('mouseup', opts));
                    el.dispatchEvent(new MouseEvent('click', opts));
                    if (typeof el.click === 'function') { try { el.click(); } catch (e) {} }
                } catch (e) {}
            },
            _findVideoContext() {
                try {
                    const outer = document.querySelectorAll('iframe');
                    for (let i = 0; i < outer.length; i++) {
                        try {
                            const d1 = outer[i].contentDocument || (outer[i].contentWindow && outer[i].contentWindow.document);
                            if (!d1) continue;
                            const inner = d1.querySelectorAll('iframe');
                            for (let j = 0; j < inner.length; j++) {
                                try {
                                    const d2 = inner[j].contentDocument || (inner[j].contentWindow && inner[j].contentWindow.document);
                                    if (!d2) continue;
                                    const v = d2.querySelector('video#video_html5_api') || d2.querySelector('video');
                                    if (v) return { doc: d2, video: v };
                                } catch (e) {}
                            }
                            const v1 = d1.querySelector('video#video_html5_api') || d1.querySelector('video');
                            if (v1) return { doc: d1, video: v1 };
                        } catch (e) {}
                    }
                    const v = document.querySelector('video#video_html5_api') || document.querySelector('video');
                    if (v) return { doc: document, video: v };
                } catch (e) {}
                return null;
            },
            _isVideoEnded(video) {
                if (!video) return false;
                if (video.ended) return true;
                const dur = Number(video.duration || 0);
                const cur = Number(video.currentTime || 0);
                if (!isFinite(dur) || dur <= 0) return false;
                if (dur - cur <= this.configs.endedNearDurationDelta) {
                    const now = Date.now();
                    if (this._nearEndStartTs === 0) { this._nearEndStartTs = now; return false; }
                    if (now - this._nearEndStartTs >= this.configs.endedStallMs) return true;
                } else {
                    this._nearEndStartTs = 0;
                }
                return false;
            },
            _checkVideoStatus() {
                try {
                    const video = this._getVideoElSafe();
                    if (!video) { this._videoEl = null; return; }
                    if (video.paused && this._isPlaying && !this._isVideoEnded(video)) {
                        console.log('%c检测到视频暂停，尝试恢复播放...', 'color:#FF5722');
                        this._tryResumePlayback('paused');
                    } else if (this._isPlaying) {
                        const now = Date.now();
                        const current = Number(video.currentTime || 0);
                        if (this._guardLastWallTs === 0) { this._guardLastWallTs = now; this._guardLastTime = current; }
                        else {
                            const stalled = Math.abs(current - this._guardLastTime) < 0.01;
                            const stalledMs = now - this._guardLastWallTs;
                            if (stalled && stalledMs >= this.configs.guardNoProgressMs) {
                                this._tryResumePlayback('no-progress');
                                this._guardLastWallTs = now;
                                this._guardLastTime = Number(video.currentTime || 0);
                            } else if (!stalled) { this._guardLastWallTs = now; this._guardLastTime = current; }
                        }
                    }
                    if (this._isPlaying && !this._endedHandled && this._isVideoEnded(video)) {
                        console.log('%c检测到视频结束（兜底），进入下一个任务点...', 'color:#9C27B0');
                        this._endedHandled = true;
                        this._isPlaying = false;
                        this._clearCheckInterval();
                        setTimeout(() => {
                            if (this.configs.skipExerciseTestByStepAdvance) this._advanceAfterVideo();
                            else this.nextUnit();
                        }, 1000);
                    }
                } catch (e) { console.error('视频状态检查失败:', e); }
            },
            _tryTimes: 0,
            _stepSwitchAt: 0,
            _stepSwitchPending: false,
            _delayedNextUnitTimer: null,
            _guardLastTime: 0,
            _guardLastWallTs: 0,
            _guardLastResumeTs: 0,
            async _waitForVideoEl(timeoutMs) {
                const deadline = Date.now() + (timeoutMs || this.configs.videoLoadTimeoutMs);
                while (Date.now() < deadline) {
                    const el = this._queryVideoEl();
                    if (el) {
                        if (typeof el.readyState === 'number' && el.readyState >= 1) return el;
                        const ok = await new Promise((resolve) => {
                            const t = setTimeout(() => resolve(false), this.configs.videoLoadPollMs);
                            const onMeta = () => { clearTimeout(t); el.removeEventListener('loadedmetadata', onMeta); resolve(true); };
                            el.addEventListener('loadedmetadata', onMeta, { once: true });
                        });
                        if (ok) return el;
                    }
                    await new Promise((r) => setTimeout(r, this.configs.videoLoadPollMs));
                }
                return null;
            },
            async play() {
                try {
                    let el = await this._waitForVideoEl();
                    if (el == null) {
                        if (this._advanceLearningStep()) {
                            console.log('%c当前不在视频页，已尝试切到下一学习步骤，2秒后重试', 'color:#607D8B');
                            setTimeout(() => this.play(), 2000);
                            return;
                        }
                        console.log('%c===========跳过章节测验，2秒后继续播放==============', 'color:#607D8B');
                        $('#prevNextFocusNext').click();
                        setTimeout(() => this.play(), 2000);
                        return;
                    }
                    this._videoEl = el;
                    this._endedHandled = false;
                    this._tryTimes = 0;
                    this._isPlaying = true;
                    this._videoEventHandle();
                    try { el.playbackRate = this.configs.playbackRate; } catch (e) {}
                    try {
                        await el.play();
                        console.log(`%c视频开始播放，倍速: ${el.playbackRate}x`, 'color:#4CAF50');
                        this._startVideoMonitoring();
                    } catch (playError) {
                        console.warn('直接 play() 失败，进入"点击播放"恢复流程:', playError);
                        this._handlePlayError(playError);
                        this._startVideoMonitoring();
                    }
                } catch (e) {
                    if (this._tryTimes > this.configs.maxRetries) {
                        console.error('%c视频播放失败，已达到最大重试次数', 'color:#F44336;font-weight:bold', e);
                        this._clearCheckInterval();
                        return;
                    }
                    this._tryTimes++;
                    console.log(`%c播放失败，${this.configs.retryInterval / 1000}秒后重试 (${this._tryTimes}/${this.configs.maxRetries})`, 'color:#FF9800');
                    setTimeout(() => this.play(), this.configs.retryInterval);
                }
            },
            _advanceLearningStep() {
                if (this._stepSwitchPending && Date.now() - this._stepSwitchAt < 4000) return true;
                const prevTitle = document.getElementsByClassName('prev_title')[0];
                const currentStepTitle = prevTitle ? (prevTitle.title || prevTitle.textContent || '').trim() : '';
                if (currentStepTitle === '章节测验' || currentStepTitle === '视频') return false;
                const clickElement = (el, label) => {
                    if (!el) return false;
                    this._stepSwitchPending = true;
                    this._stepSwitchAt = Date.now();
                    console.log(`%c尝试点击${label}`, 'color:#2196F3');
                    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
                    return true;
                };
                const videoTab = $('.prev_white:visible').filter((_, el) => {
                    const text = ($(el).text() || '').replace(/\s+/g, '');
                    return text === '2视频' || text === '视频';
                }).get(0);
                if (clickElement(videoTab, '"视频"页签')) return true;
                return false;
            },
            _bindStepNavigation() {
                if (this._stepNavigationBound) return;
                this._stepNavigationBound = true;
                const reenter = () => {
                    this._videoEl = null;
                    this._isPlaying = false;
                    this._endedHandled = false;
                    this._stepSwitchPending = true;
                    this._stepSwitchAt = Date.now();
                    setTimeout(() => { try { this._initCellData(); } catch (e) {} this.play(); }, 1800);
                };
                $(document).on('click', '.prev_white', (e) => {
                    const text = ($(e.currentTarget).text() || '').replace(/\s+/g, '');
                    if (text.includes('视频')) {
                        console.log(`%c检测到步骤切换：${text}，重新接管视频`, 'color:#607D8B');
                        reenter();
                    }
                });
            },
            _handlePlayError(error) {
                console.error('播放错误详情:', error);
                const video = this._getVideoElSafe();
                if (video) {
                    try { video.muted = true; } catch (e) {}
                    video.play().then(() => {
                        console.log('%c静音播放成功', 'color:#4CAF50');
                        if (this._delayedNextUnitTimer) { clearTimeout(this._delayedNextUnitTimer); this._delayedNextUnitTimer = null; }
                    }).catch((e) => {
                        console.warn('静音 play() 仍失败，改用模拟点击恢复', e);
                        this._simulateClickToPlay();
                        clearTimeout(this._delayedNextUnitTimer);
                        this._delayedNextUnitTimer = setTimeout(() => {
                            this._delayedNextUnitTimer = null;
                            const v = this._getVideoElSafe();
                            if (v && v.paused && this._isPlaying) this._kickPlay(v);
                        }, this.configs.clickToPlayRetryMs);
                    });
                }
            },
            playCurrentIndex(nCell) {
                if (!nCell) {
                    const el = this._getTreeContainer();
                    const cells = el.children('ul').children('li');
                    const nCells = $(cells.get(this._cellData.currentCellIndex)).find('.posCatalog_select:not(.firstLayer)');
                    nCell = nCells.get(this._cellData.currentNCellIndex);
                }
                const $nCell = $(nCell);
                const clickableSpan = $nCell.find('.posCatalog_name')[0];
                if (!clickableSpan) {
                    console.error('%c找不到可点击的课程节点', 'color:#F44336');
                    setTimeout(() => this.nextUnit(), 2000);
                    return;
                }
                const titleText = $(clickableSpan).attr('title') || '未知标题';
                console.log(`%c点击切换到: ${titleText}`, 'color:#2196F3');
                $(clickableSpan).click();
                this._videoEl = null;
                this._isPlaying = false;
                this._endedHandled = false;
                this._clearCheckInterval();

                // 立即同步面板 active —— 通过 nCell 的 .posCatalog_select 的 id
                try {
                    const sectionId = $nCell.find('.posCatalog_select').attr('id') || $nCell.find('[id]').first().attr('id');
                    if (sectionId && window.coursePanel && typeof window.coursePanel.setActive === 'function') {
                        window.coursePanel.setActive(sectionId, { scroll: true });
                        this._cellData.currentSectionId = sectionId;
                    }
                } catch (e) {}

                console.log('%c等待视频加载...', 'color:#FF9800');
                setTimeout(() => {
                    try { this._initCellData(); } catch (e) {}
                    if (this.configs.autoplay) this.play();
                }, 1500);
            },
            _initCellData() {
                const el = this._getTreeContainer();
                const cells = el.children('ul').children('li');
                this._cellData.cells = cells.length;
                let nCellCounts = 0;
                let foundCurrent = false;
                cells.each((i, v) => {
                    const nCells = $(v).find('.posCatalog_select:not(.firstLayer)');
                    nCellCounts += nCells.length;
                    nCells.each((j, e) => {
                        const _el = $(e);
                        if (_el.hasClass('posCatalog_active')) {
                            this._cellData.currentCellIndex = i;
                            this._cellData.currentNCellIndex = j;
                            this._cellData.currentSectionId = _el.attr('id') || '';
                            foundCurrent = true;
                            const titleSpan = _el.find('.posCatalog_name')[0];
                            if (titleSpan) this._cellData.currentVideoTitle = $(titleSpan).attr('title');
                        }
                    });
                });
                this._cellData.nCells = nCellCounts;
                if (!foundCurrent && nCellCounts > 0) console.warn('%c未找到当前激活的视频节点', 'color:#FF9800');
                console.log(`%c课程信息: ${this._cellData.cells}章, ${this._cellData.nCells}节, 当前: 第${this._cellData.currentCellIndex + 1}章第${this._cellData.currentNCellIndex + 1}节`, 'color:#607D8B');
            },
            _getTreeContainer() {
                if (!this._treeContainerEl) {
                    const el = $('#coursetree');
                    if (el.length <= 0) throw new Error('找不到视频列表');
                    this._treeContainerEl = el;
                }
                return this._treeContainerEl;
            },
            _queryVideoEl() {
                try { const ctx = this._findVideoContext(); return ctx ? ctx.video : null; } catch (e) { return null; }
            },
            _getVideoElSafe() {
                try { const v = this._queryVideoEl(); if (v) this._videoEl = v; return this._videoEl || null; } catch (e) { return null; }
            },
            _videoEventHandle() {
                const el = this._videoEl;
                if (!el) { console.log('videoEl未加载'); return; }
                if (el.__app_bound_token === this._videoElToken) return;
                if (el.__app_handlers) {
                    el.removeEventListener('ended', el.__app_handlers.ended);
                    el.removeEventListener('loadedmetadata', el.__app_handlers.loaded);
                    el.removeEventListener('play', el.__app_handlers.play);
                    el.removeEventListener('pause', el.__app_handlers.pause);
                }
                const handlers = {
                    ended: this._handleVideoEnded.bind(this),
                    loaded: this._handleVideoLoaded.bind(this),
                    play: this._handleVideoPlay.bind(this),
                    pause: this._handleVideoPause.bind(this),
                };
                el.addEventListener('ended', handlers.ended);
                el.addEventListener('loadedmetadata', handlers.loaded);
                el.addEventListener('play', handlers.play);
                el.addEventListener('pause', handlers.pause);
                el.__app_handlers = handlers;
                el.__app_bound_token = this._videoElToken;
                console.log('%c绑定视频事件完成', 'color:#00BCD4');
                if (this._isPlaying || this.configs.autoplay) setTimeout(() => this._kickPlay(el), 200);
            },
            _handleVideoEnded() {
                if (this._endedHandled) return;
                this._endedHandled = true;
                console.warn(`%c============'${this._cellData.currentVideoTitle}' 播放完成，进入下一个任务点=============`, 'color:#4CAF50;font-weight:bold');
                this._isPlaying = false;
                this._clearCheckInterval();
                setTimeout(() => {
                    if (this.configs.skipExerciseTestByStepAdvance) this._advanceAfterVideo();
                    else this.nextUnit();
                }, 1000);
            },
            _advanceAfterVideo() {
                const next = document.getElementById('prevNextFocusNext');
                if (next) {
                    const beforeSection = this._cellData.currentSectionId;
                    console.log('%c点击"下一步"，推进到本小节的下一个任务点', 'color:#2196F3');
                    try { next.click(); } catch (e) {}
                    try { next.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); } catch (e) {}

                    // 给页面切换时间，再让 play() 接管：可能是同小节下一个视频、测验/阅读、或下一小节。
                    setTimeout(() => {
                        try { this._initCellData(); } catch (e) {}
                        const afterSection = this._cellData.currentSectionId;
                        if (afterSection && afterSection !== beforeSection && window.coursePanel) {
                            window.coursePanel.setActive(afterSection, { scroll: true });
                        }
                        this.play();
                    }, 2500);
                } else {
                    console.log('%c未找到"下一步"按钮，回退到下一小节', 'color:#FF9800');
                    this.nextUnit();
                }
            },
            _handleVideoLoaded() {
                console.log('%c============视频加载完成=============', 'color:#2196F3');
                if (this.configs.autoplay && !this._isPlaying) {
                    this.play();
                } else if (this.configs.autoplay) {
                    const v = this._getVideoElSafe();
                    if (v) this._kickPlay(v);
                }
            },
            _handleVideoPlay() {
                console.info(`%c============'${this._cellData.currentVideoTitle}' 开始播放=============`, 'color:#4CAF50');
                this._isPlaying = true;
                this._endedHandled = false;
                this._stepSwitchPending = false;
                const video = this._getVideoElSafe();
                this._guardLastTime = Number(video?.currentTime || 0);
                this._guardLastWallTs = Date.now();
                this._nearEndStartTs = 0;
                if (this._delayedNextUnitTimer) { clearTimeout(this._delayedNextUnitTimer); this._delayedNextUnitTimer = null; }
            },
            _handleVideoPause() { console.log('%c============视频暂停=============', 'color:#FF9800'); }
        };

        // ============================================================
        // 二、控制面板（含完成 / 选中状态 + 与 app 联动）
        // ============================================================
        window.coursePanel = (function () {
            const contentContainer = document.getElementById('content1');
            if (!contentContainer) {
                console.error('❌ 未找到 #content1 容器');
                return null;
            }

            function parseChapters() {
                const chapters = [];
                let currentActiveSectionId = null;
                const firstLayerItems = contentContainer.querySelectorAll('#coursetree > ul > li');
                firstLayerItems.forEach(li => {
                    const firstDiv = li.querySelector(':scope > .firstLayer');
                    if (!firstDiv) return;
                    const titleSpan = firstDiv.querySelector('.posCatalog_title');
                    const chapterTitle = titleSpan ? (titleSpan.getAttribute('title') || titleSpan.textContent.trim()) : '未命名章节';
                    const chapter = { title: chapterTitle, id: firstDiv.id, sections: [] };
                    const levelDiv = li.querySelector(':scope > .posCatalog_level');
                    if (levelDiv) {
                        const sectionItems = levelDiv.querySelectorAll('ul > li');
                        sectionItems.forEach(sectionLi => {
                            const sectionDiv = sectionLi.querySelector('.posCatalog_select');
                            const nameSpan = sectionLi.querySelector('.posCatalog_name');
                            if (!sectionDiv || !nameSpan) return;
                            const sectionTitle = nameSpan.getAttribute('title') || nameSpan.textContent.trim();
                            const sectionId = sectionDiv.id;
                            const isActive = sectionDiv.classList.contains('posCatalog_active');
                            if (isActive) currentActiveSectionId = sectionId;
                            let unfinishedCount = 0, isCompleted = false;
                            const jobInput = sectionLi.querySelector('input.jobUnfinishCount');
                            if (jobInput) unfinishedCount = parseInt(jobInput.value, 10) || 0;
                            const orangeSpan = sectionLi.querySelector('.orangeNew');
                            if (orangeSpan && !jobInput) unfinishedCount = parseInt(orangeSpan.textContent.trim(), 10) || 0;
                            const pointsSpan = sectionLi.querySelector('.catalog_points_yi');
                            if (pointsSpan && orangeSpan && orangeSpan.textContent.trim() === '0') unfinishedCount = 0;
                            if (unfinishedCount === 0 && jobInput) isCompleted = true;
                            else if (!pointsSpan && !jobInput) { isCompleted = true; unfinishedCount = 0; }
                            else if (unfinishedCount === 0) isCompleted = true;
                            chapter.sections.push({ title: sectionTitle, id: sectionId, unfinishedCount, isCompleted, isActive });
                        });
                    }
                    chapters.push(chapter);
                });
                return { chapters, currentActiveSectionId };
            }

            const oldPanel = document.getElementById('course-control-panel');
            if (oldPanel) oldPanel.remove();

            const { chapters, currentActiveSectionId } = parseChapters();
            const totalSections = chapters.reduce((s, c) => s + c.sections.length, 0);
            const completedSections = chapters.reduce((s, c) => s + c.sections.filter(x => x.isCompleted).length, 0);

            const panel = document.createElement('div');
            panel.id = 'course-control-panel';
            panel.innerHTML = `
                <div style="position:fixed;top:20px;right:20px;width:380px;max-height:80vh;background:#fff;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.25);z-index:99999;display:flex;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
                    <div class="panel-header" style="padding:16px 20px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;border-radius:16px 16px 0 0;display:flex;justify-content:space-between;align-items:center;cursor:move;">
                        <div>
                            <span style="font-weight:700;font-size:16px;">📚 课程目录</span>
                            <div id="panel-progress" style="font-size:11px;opacity:0.85;margin-top:2px;">已完成 ${completedSections}/${totalSections}</div>
                        </div>
                        <div style="display:flex;gap:4px;align-items:center;">
                            <button id="panel-autoplay-btn" style="background:rgba(255,255,255,0.25);border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:11px;cursor:pointer;border-radius:6px;padding:4px 8px;white-space:nowrap;" title="开始/停止自动播放">▶ 自动</button>
                            <button id="panel-locate-active" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:11px;cursor:pointer;border-radius:6px;padding:4px 8px;white-space:nowrap;" title="定位到当前选中">📍 定位</button>
                            <button id="panel-filter-completed" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:11px;cursor:pointer;border-radius:6px;padding:4px 8px;white-space:nowrap;" title="仅显示未完成">🔍 未完成</button>
                            <button id="panel-refresh-btn" style="background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:11px;cursor:pointer;border-radius:6px;padding:4px 8px;white-space:nowrap;" title="重新解析章节">🔄</button>
                            <button id="panel-toggle-btn" style="background:rgba(255,255,255,0.25);border:none;color:#fff;font-size:16px;cursor:pointer;border-radius:8px;padding:4px 8px;" title="折叠/展开">−</button>
                            <button id="panel-close-btn" style="background:rgba(255,255,255,0.25);border:none;color:#fff;font-size:16px;cursor:pointer;border-radius:8px;padding:4px 8px;" title="关闭面板">✕</button>
                        </div>
                    </div>
                    <div id="panel-body" style="overflow-y:auto;padding:12px 16px;flex:1;max-height:calc(80vh - 110px);scroll-behavior:smooth;"></div>
                    <label style="padding:8px 16px 0;font-size:12px;color:#475569;border-top:1px solid #f1f5f9;display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;">
                        <input id="panel-skip-exercise-test" type="checkbox" ${window.app && window.app.configs.skipExerciseTestByStepAdvance ? 'checked' : ''}
                            style="width:14px;height:14px;margin:0;cursor:pointer;">
                        <span>有练习测试需跳过（右边课程数为2）</span>
                    </label>
                    <div style="padding:8px 16px;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;display:flex;gap:16px;">
                        <span>🟢 未完成</span>
                        <span style="color:#cbd5e1;">⚪ 已完成</span>
                        <span style="color:#667eea;">💙 当前播放</span>
                    </div>
                </div>
            `;
            document.body.appendChild(panel);
            const panelBody = panel.querySelector('#panel-body');

            function generateChapterHTML(chapterList) {
                if (chapterList.length === 0) return '<div style="color:#999;text-align:center;padding:20px;">暂无章节数据</div>';
                return chapterList.map(ch => {
                    const completedInChapter = ch.sections.filter(s => s.isCompleted).length;
                    const sectionItems = ch.sections.map(sec => {
                        let itemStyle = '', itemClass = 'section-item';
                        if (sec.isActive) {
                            itemStyle = 'background:#eff6ff!important;border-left:3px solid #3b82f6!important;color:#1e40af!important;font-weight:600;opacity:1!important;';
                            itemClass += ' section-active';
                        } else if (sec.isCompleted) {
                            itemStyle = 'color:#b0b7c3!important;opacity:0.6;';
                        } else {
                            itemStyle = 'color:#334155;';
                        }
                        const titleStyle = (sec.isCompleted && !sec.isActive) ? 'text-decoration:line-through;text-decoration-color:#cbd5e1;' : '';
                        const icon = sec.isActive ? '📍' : (sec.isCompleted ? '✅' : '▶');
                        let taskBadge = '';
                        if (sec.isActive) taskBadge = `<span class="badge-active" style="background:#dbeafe;color:#1d4ed8;font-size:10px;padding:2px 6px;border-radius:10px;font-weight:700;margin-left:4px;">当前</span>`;
                        else if (!sec.isCompleted && sec.unfinishedCount > 0) taskBadge = `<span class="badge-count" style="background:#fef2f2;color:#ef4444;font-size:10px;padding:2px 6px;border-radius:10px;font-weight:600;margin-left:4px;">${sec.unfinishedCount}</span>`;
                        else if (sec.isCompleted) taskBadge = `<span class="badge-done" style="color:#94a3b8;font-size:10px;margin-left:4px;">✓</span>`;
                        return `
                            <div class="${itemClass}" data-section-id="${sec.id}" data-completed="${sec.isCompleted}" data-active="${sec.isActive}"
                                style="padding:8px 12px 8px 28px;cursor:pointer;border-radius:8px;margin:3px 0;font-size:13px;transition:all 0.2s;display:flex;align-items:center;gap:6px;${itemStyle}"
                                title="${sec.isActive ? '📍 当前播放' : (sec.isCompleted ? '✅ 已完成' : '⏳ 剩余 ' + sec.unfinishedCount + ' 个任务点')}: ${sec.title.replace(/"/g, '&quot;')}">
                                <span class="row-icon" style="font-size:12px;flex-shrink:0;">${icon}</span>
                                <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${titleStyle}">${sec.title}</span>
                                ${taskBadge}
                            </div>`;
                    }).join('');
                    const hasActive = ch.sections.some(s => s.isActive);
                    const chapterStyle = hasActive ? 'border-left:3px solid #3b82f6;' : '';
                    return `
                        <div class="chapter-group" style="margin-bottom:12px;" data-chapter-id="${ch.id}">
                            <div class="chapter-header" style="font-weight:700;font-size:14px;color:#1e293b;background:${hasActive ? '#eff6ff' : '#f1f5f9'};padding:10px 12px;border-radius:10px;cursor:pointer;display:flex;align-items:center;gap:8px;user-select:none;${chapterStyle}">
                                <span class="folder-icon" style="font-size:16px;">${hasActive ? '📂' : '📁'}</span>
                                <span style="flex:1;">${ch.title}</span>
                                <span style="color:#64748b;font-size:11px;">${completedInChapter}/${ch.sections.length}</span>
                            </div>
                            <div class="section-list" style="margin-top:4px;">${sectionItems}</div>
                        </div>`;
                }).join('');
            }

            function render(chapterList) {
                panelBody.innerHTML = generateChapterHTML(chapterList);
                const c = chapterList.reduce((s, ch) => s + ch.sections.length, 0);
                const done = chapterList.reduce((s, ch) => s + ch.sections.filter(x => x.isCompleted).length, 0);
                const progressEl = panel.querySelector('#panel-progress');
                if (progressEl) progressEl.textContent = `已完成 ${done}/${c}`;
            }
            render(chapters);

            function scrollToActive(behavior) {
                const activeItem = panel.querySelector('.section-active');
                if (!activeItem) return;
                const itemTop = activeItem.offsetTop;
                const panelHeight = panelBody.clientHeight;
                panelBody.scrollTo({ top: itemTop - panelHeight / 3, behavior: behavior || 'smooth' });
                activeItem.style.transition = 'all 0.3s';
                activeItem.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.4)';
                setTimeout(() => { activeItem.style.boxShadow = ''; }, 1500);
            }
            setTimeout(() => scrollToActive('auto'), 100);

            function setActive(activeId, opts) {
                opts = opts || {};
                const allItems = panel.querySelectorAll('.section-item');
                allItems.forEach(item => {
                    const isCompleted = item.getAttribute('data-completed') === 'true';
                    const wasActive = item.getAttribute('data-active') === 'true';
                    item.classList.remove('section-active');
                    item.setAttribute('data-active', 'false');
                    item.style.background = '';
                    item.style.borderLeft = '';
                    item.style.opacity = isCompleted ? '0.6' : '1';
                    item.style.color = isCompleted ? '#b0b7c3' : '#334155';
                    item.style.fontWeight = '';
                    const iconSpan = item.querySelector('.row-icon');
                    if (iconSpan) iconSpan.textContent = isCompleted ? '✅' : '▶';
                    if (wasActive) {
                        // 恢复徽章为未完成数量或已完成 ✓
                        const badge = item.querySelector('.badge-active');
                        if (badge) {
                            const isComp = isCompleted;
                            if (isComp) {
                                badge.outerHTML = `<span class="badge-done" style="color:#94a3b8;font-size:10px;margin-left:4px;">✓</span>`;
                            } else {
                                badge.outerHTML = `<span class="badge-count" style="background:#fef2f2;color:#ef4444;font-size:10px;padding:2px 6px;border-radius:10px;font-weight:600;margin-left:4px;">·</span>`;
                            }
                        }
                    }
                });
                const allHeaders = panel.querySelectorAll('.chapter-header');
                allHeaders.forEach(h => {
                    h.style.background = '#f1f5f9';
                    h.style.borderLeft = '';
                    const fi = h.querySelector('.folder-icon');
                    if (fi) fi.textContent = '📁';
                });

                if (!activeId) return;
                const newItem = panel.querySelector(`.section-item[data-section-id="${CSS.escape(activeId)}"]`);
                if (!newItem) return;
                newItem.classList.add('section-active');
                newItem.setAttribute('data-active', 'true');
                newItem.style.background = '#eff6ff';
                newItem.style.borderLeft = '3px solid #3b82f6';
                newItem.style.color = '#1e40af';
                newItem.style.opacity = '1';
                newItem.style.fontWeight = '600';
                const iconSpan = newItem.querySelector('.row-icon');
                if (iconSpan) iconSpan.textContent = '📍';
                // 替换徽章为"当前"
                const existingBadge = newItem.querySelector('.badge-count, .badge-done, .badge-active');
                const newBadgeHTML = `<span class="badge-active" style="background:#dbeafe;color:#1d4ed8;font-size:10px;padding:2px 6px;border-radius:10px;font-weight:700;margin-left:4px;">当前</span>`;
                if (existingBadge) existingBadge.outerHTML = newBadgeHTML;
                else newItem.insertAdjacentHTML('beforeend', newBadgeHTML);

                const chapterGroup = newItem.closest('.chapter-group');
                if (chapterGroup) {
                    const ch = chapterGroup.querySelector('.chapter-header');
                    if (ch) {
                        ch.style.background = '#eff6ff';
                        ch.style.borderLeft = '3px solid #3b82f6';
                        const fi = ch.querySelector('.folder-icon');
                        if (fi) fi.textContent = '📂';
                    }
                }

                if (opts.scroll) scrollToActive('smooth');
            }

            function refresh() {
                const { chapters: ch2, currentActiveSectionId: aid2 } = parseChapters();
                render(ch2);
                if (aid2) setActive(aid2, { scroll: true });
                console.log('%c面板已刷新', 'color:#10b981');
            }

            // ===== 事件 =====
            // 点击小节 → 触发学习通原始 onclick → 更新面板 active
            panel.addEventListener('click', (e) => {
                const sectionItem = e.target.closest('.section-item');
                if (sectionItem) {
                    const sectionId = sectionItem.getAttribute('data-section-id');
                    if (!sectionId) return;
                    const originalSpan = document.querySelector(`#${CSS.escape(sectionId)} .posCatalog_name`);
                    if (originalSpan) {
                        const title = originalSpan.getAttribute('title') || originalSpan.textContent.trim();
                        console.log(`🖱️ 触发点击：${title}`);
                        originalSpan.click();
                        setActive(sectionId, { scroll: false });
                        // 同步给 app
                        if (window.app) {
                            window.app._cellData.currentSectionId = sectionId;
                            window.app._videoEl = null;
                            window.app._isPlaying = false;
                            window.app._endedHandled = false;
                            setTimeout(() => {
                                try { window.app._initCellData(); } catch (err) {}
                                if (window.app.configs.autoplay) window.app.play();
                            }, 1500);
                        }
                    }
                    return;
                }
                const header = e.target.closest('.chapter-header');
                if (header) {
                    const sectionList = header.nextElementSibling;
                    if (sectionList && sectionList.classList.contains('section-list')) {
                        const isHidden = sectionList.style.display === 'none';
                        sectionList.style.display = isHidden ? 'block' : 'none';
                        header.style.opacity = isHidden ? '1' : '0.7';
                    }
                }
            });

            panel.querySelector('#panel-locate-active').addEventListener('click', () => scrollToActive('smooth'));
            panel.querySelector('#panel-refresh-btn').addEventListener('click', refresh);
            const skipExerciseTestCheckbox = panel.querySelector('#panel-skip-exercise-test');
            skipExerciseTestCheckbox.addEventListener('change', () => {
                const enabled = skipExerciseTestCheckbox.checked;
                if (window.app) window.app.configs.skipExerciseTestByStepAdvance = enabled;
                writeBoolSetting(SETTINGS_KEYS.skipExerciseTestByStepAdvance, enabled);
                console.log(`%c有练习测试需跳过：${enabled ? '已开启' : '已关闭'}`, 'color:#2196F3');
            });

            const toggleBtn = panel.querySelector('#panel-toggle-btn');
            toggleBtn.addEventListener('click', () => {
                if (panelBody.style.display === 'none') { panelBody.style.display = 'block'; toggleBtn.textContent = '−'; }
                else { panelBody.style.display = 'none'; toggleBtn.textContent = '+'; }
            });

            let showOnlyUnfinished = false;
            const filterBtn = panel.querySelector('#panel-filter-completed');
            filterBtn.addEventListener('click', () => {
                showOnlyUnfinished = !showOnlyUnfinished;
                panel.querySelectorAll('.section-item').forEach(item => {
                    const isCompleted = item.getAttribute('data-completed') === 'true';
                    const isActive = item.getAttribute('data-active') === 'true';
                    if (showOnlyUnfinished) item.style.display = (isCompleted && !isActive) ? 'none' : 'flex';
                    else item.style.display = 'flex';
                });
                panel.querySelectorAll('.chapter-group').forEach(group => {
                    const visible = Array.from(group.querySelectorAll('.section-item')).filter(it => it.style.display !== 'none');
                    group.style.display = (showOnlyUnfinished && visible.length === 0) ? 'none' : 'block';
                });
                filterBtn.textContent = showOnlyUnfinished ? '🔍 全部' : '🔍 未完成';
                filterBtn.style.background = showOnlyUnfinished ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.2)';
            });

            const autoBtn = panel.querySelector('#panel-autoplay-btn');
            function syncAutoBtn() {
                const on = !!(window.app && window.app._isPlaying);
                autoBtn.textContent = on ? '⏸ 停止' : '▶ 自动';
                autoBtn.style.background = on ? 'rgba(255,90,90,0.4)' : 'rgba(255,255,255,0.25)';
            }
            autoBtn.addEventListener('click', () => {
                if (!window.app) return;
                if (window.app._isPlaying) {
                    window.app.stop();
                } else {
                    window.app.run();
                }
                setTimeout(syncAutoBtn, 200);
            });
            setInterval(syncAutoBtn, 1500);

            panel.querySelector('#panel-close-btn').addEventListener('click', () => {
                panel.remove();
                console.log('📌 面板已关闭');
            });

            // 拖拽
            const headerDiv = panel.querySelector('.panel-header');
            let isDragging = false, offsetX, offsetY;
            headerDiv.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                isDragging = true;
                const rect = panel.firstElementChild.getBoundingClientRect();
                offsetX = e.clientX - rect.left;
                offsetY = e.clientY - rect.top;
                headerDiv.style.cursor = 'grabbing';
            });
            window.addEventListener('mousemove', (e) => {
                if (!isDragging) return;
                const panelDiv = panel.firstElementChild;
                panelDiv.style.left = (e.clientX - offsetX) + 'px';
                panelDiv.style.top = (e.clientY - offsetY) + 'px';
                panelDiv.style.right = 'auto';
            });
            window.addEventListener('mouseup', () => {
                if (isDragging) { isDragging = false; headerDiv.style.cursor = 'move'; }
            });

            const style = document.createElement('style');
            style.textContent = `
                .section-item:hover { background:#eef2ff !important; }
                .section-active:hover { background:#dbeafe !important; }
                .section-item[data-completed="true"]:not(.section-active):hover { background:#f1f5f9 !important; }
                .chapter-header:hover { background:#e2e8f0 !important; }
            `;
            panel.appendChild(style);

            console.log(`✅ 面板就绪：${chapters.length} 章 / ${totalSections} 节（已完成 ${completedSections}）`);
            if (currentActiveSectionId) console.log(`📍 当前选中：${currentActiveSectionId}`);

            return { setActive, refresh, scrollToActive, parseChapters, panel };
        })();

        // ============================================================
        // 三、启动 + 全局事件
        // ============================================================
        try {
            window.app.run();
            const preventPause = (e) => { e.stopPropagation(); e.preventDefault(); };
            const resumeNow = () => {
                if (window.app && typeof window.app._tryResumePlayback === 'function') window.app._tryResumePlayback('page-event');
            };
            document.addEventListener('mouseleave', preventPause);
            window.addEventListener('mouseleave', preventPause);
            document.addEventListener('mouseout', preventPause);
            window.addEventListener('mouseout', preventPause);
            window.addEventListener('blur', () => { console.log('%c页面失去焦点', 'color:#607D8B'); resumeNow(); });
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) console.log('%c页面切到后台', 'color:#607D8B');
                resumeNow();
            });
        } catch (error) {
            console.error('%c脚本运行失败: ', 'color:#F44336;font-weight:bold', error.message);
        }
    }
})();
