document.addEventListener('DOMContentLoaded', () => {
    const grid            = document.getElementById('signals-grid');
    const loading         = document.getElementById('loading');
    const searchInput     = document.getElementById('search');
    const directionFilter = document.getElementById('direction-filter');
    const showClosedCheck = document.getElementById('show-closed');
    const lastUpdated     = document.getElementById('last-updated');

    const MAX_EXPIRY_DAYS = 20;
    const STORAGE_KEY     = 'stock-global-thresholds';

    let allTracks    = [];
    let dataDefaults = { targetPct: 30, stopLossPct: 30, expiryDays: 10 };

    // ─── Threshold storage ────────────────────────────────────────────────────
    function loadThresholds() {
        try {
            const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
            if (stored && stored.targetPct != null) return stored;
        } catch (_) {}
        return null; // null = use data defaults
    }

    function saveThresholds(t) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    }

    function getActiveThresholds() {
        return loadThresholds() || dataDefaults;
    }

    // ─── Client-side recompute ────────────────────────────────────────────────
    /**
     * Pure function: walk dailyChanges with given thresholds,
     * return { status, exitReason, daysHeld, triggerDay }.
     */
    function recomputeStatus(track, targetPct, stopLossPct, expiryDays) {
        if (!track.dailyChanges || track.dailyChanges.length === 0) {
            return { status: 'OPEN', exitReason: null, daysHeld: 0, triggerDay: null };
        }

        let status     = 'OPEN';
        let exitReason = null;
        let triggerDay = null;

        for (let i = 0; i < track.dailyChanges.length; i++) {
            const { pctChange } = track.dailyChanges[i];

            if (triggerDay === null) {
                const hitTarget = pctChange >= targetPct;
                const hitStop   = pctChange <= -stopLossPct;

                if (hitTarget && hitStop) {
                    status = 'LOSS'; exitReason = 'STOP_LOSS';   triggerDay = i;
                } else if (hitTarget) {
                    status = 'WIN';  exitReason = 'TARGET_PROFIT'; triggerDay = i;
                } else if (hitStop) {
                    status = 'LOSS'; exitReason = 'STOP_LOSS';   triggerDay = i;
                }

                if (triggerDay === null && (i + 1) >= expiryDays) {
                    status     = pctChange > 0 ? 'WIN' : 'LOSS';
                    exitReason = 'TIME_EXPIRED';
                    triggerDay = i;
                }
            }
        }

        const daysHeld = triggerDay !== null ? triggerDay + 1 : track.dailyChanges.length;
        return { status, exitReason, daysHeld, triggerDay };
    }

    // ─── Global threshold panel (injected into filters row) ──────────────────
    function buildThresholdPanel() {
        const { targetPct, stopLossPct, expiryDays } = getActiveThresholds();
        const isCustom = loadThresholds() !== null;

        const panel = document.createElement('div');
        panel.id        = 'threshold-panel';
        panel.className = 'threshold-panel';
        panel.innerHTML = `
            <div class="tp-toggle" id="tp-toggle">
                <span>⚙️ Thresholds</span>
                ${isCustom ? '<span class="tp-modified-dot" title="Using custom thresholds">●</span>' : ''}
                <span class="tp-arrow" id="tp-arrow">▾</span>
            </div>
            <div class="tp-body" id="tp-body" style="display:none;">
                <div class="tp-row">
                    <label>🎯 Target</label>
                    <input type="range" id="sl-target" min="1" max="100" step="1" value="${targetPct}">
                    <span id="sl-target-val">${targetPct}%</span>
                </div>
                <div class="tp-row">
                    <label>🛑 Stop Loss</label>
                    <input type="range" id="sl-stop" min="1" max="100" step="1" value="${stopLossPct}">
                    <span id="sl-stop-val">${stopLossPct}%</span>
                </div>
                <div class="tp-row">
                    <label>⏰ Expiry</label>
                    <input type="range" id="sl-expiry" min="1" max="${MAX_EXPIRY_DAYS}" step="1" value="${expiryDays}">
                    <span id="sl-expiry-val">${expiryDays}d</span>
                </div>
                <div class="tp-footer">
                    <span class="tp-hint">Drag sliders — win rate updates live</span>
                    <button id="tp-reset">↩️ Reset to defaults</button>
                </div>
            </div>
        `;
        return panel;
    }

    function wireThresholdPanel() {
        const toggle   = document.getElementById('tp-toggle');
        const body     = document.getElementById('tp-body');
        const arrow    = document.getElementById('tp-arrow');
        const slTarget = document.getElementById('sl-target');
        const slStop   = document.getElementById('sl-stop');
        const slExpiry = document.getElementById('sl-expiry');
        const valT     = document.getElementById('sl-target-val');
        const valS     = document.getElementById('sl-stop-val');
        const valE     = document.getElementById('sl-expiry-val');
        const btnReset = document.getElementById('tp-reset');

        toggle.addEventListener('click', () => {
            const open = body.style.display !== 'none';
            body.style.display = open ? 'none' : 'block';
            arrow.textContent  = open ? '▾' : '▴';
        });

        function onChange() {
            const t = parseInt(slTarget.value);
            const s = parseInt(slStop.value);
            const e = parseInt(slExpiry.value);
            valT.textContent = `${t}%`;
            valS.textContent = `${s}%`;
            valE.textContent = `${e}d`;
            saveThresholds({ targetPct: t, stopLossPct: s, expiryDays: e });

            // Live update: stats + visible cards
            updateStats();
            applyFilters();

            // Show/hide modified dot
            let dot = toggle.querySelector('.tp-modified-dot');
            if (!dot) {
                dot = document.createElement('span');
                dot.className = 'tp-modified-dot';
                dot.title     = 'Using custom thresholds';
                dot.textContent = '●';
                toggle.insertBefore(dot, arrow);
            }
        }

        slTarget.addEventListener('input', onChange);
        slStop.addEventListener('input', onChange);
        slExpiry.addEventListener('input', onChange);

        btnReset.addEventListener('click', () => {
            localStorage.removeItem(STORAGE_KEY);
            // Re-build panel with defaults
            const panel = document.getElementById('threshold-panel');
            const newPanel = buildThresholdPanel();
            panel.replaceWith(newPanel);
            wireThresholdPanel();
            updateStats();
            applyFilters();
        });
    }

    // ─── Environment & Data Fetch ─────────────────────────────────────────────
    const isLocal     = window.location.hostname === 'localhost' ||
                        window.location.hostname === '127.0.0.1';
    const DATA_SOURCE = isLocal ? '../local/data.json' : 'data.json';

    fetch(DATA_SOURCE)
        .then(res => {
            if (!res.ok) throw new Error("Could not fetch data.json");
            return res.json();
        })
        .then(data => {
            dataDefaults = {
                targetPct:   data.defaultTargetPct  ?? 30,
                stopLossPct: data.defaultStopLossPct ?? 30,
                expiryDays:  data.defaultVerifyDays  ?? 10,
            };

            allTracks = (data.tracks || []).sort((a, b) =>
                new Date(b.dateDetected) - new Date(a.dateDetected)
            );

            // Backfill trackId for legacy data
            allTracks.forEach((t, i) => {
                if (!t.trackId) t.trackId = `${t.ticker}_${t.direction}_${i}`;
            });

            if (data.updatedAt) {
                const d = new Date(data.updatedAt);
                lastUpdated.textContent = `Last Updated: ${d.toLocaleString()}`;
            }

            // Inject threshold panel into actions container
            const filterActions = document.getElementById('filter-actions');
            const panel = buildThresholdPanel();
            filterActions.appendChild(panel);
            wireThresholdPanel();

            updateStats();
            applyFilters();
            loading.style.display = 'none';
        })
        .catch(err => {
            console.error(err);
            loading.innerHTML = `<p style="color:var(--accent-put)">Failed to load data. Ensure verification job has run.</p>`;
        });

    // ─── Filters ──────────────────────────────────────────────────────────────
    searchInput.addEventListener('input', applyFilters);
    directionFilter.addEventListener('change', applyFilters);
    showClosedCheck.addEventListener('change', applyFilters);

    function applyFilters() {
        const query      = searchInput.value.toUpperCase();
        const dir        = directionFilter.value;
        const showClosed = showClosedCheck.checked;
        const { targetPct, stopLossPct, expiryDays } = getActiveThresholds();

        const filtered = allTracks.filter(track => {
            const { status } = recomputeStatus(track, targetPct, stopLossPct, expiryDays);
            const matchSearch = track.ticker.includes(query);
            const matchDir    = dir === 'ALL' || track.direction === dir;
            const matchStatus = showClosed ? status !== 'OPEN' : status === 'OPEN';
            return matchSearch && matchDir && matchStatus;
        });

        renderGrid(filtered);
    }

    // ─── Stats ────────────────────────────────────────────────────────────────
    function updateStats() {
        const { targetPct, stopLossPct, expiryDays } = getActiveThresholds();

        const computed = allTracks.map(t => recomputeStatus(t, targetPct, stopLossPct, expiryDays));

        const active    = computed.filter(c => c.status === 'OPEN').length;
        const completed = computed.filter(c => c.status !== 'OPEN');
        const wins      = completed.filter(c => c.status === 'WIN').length;
        const losses    = completed.length - wins;
        const winRate   = completed.length > 0
            ? ((wins / completed.length) * 100).toFixed(1)
            : '0.0';

        document.getElementById('stat-signals').textContent  = active;
        document.getElementById('stat-closed').textContent   = completed.length;
        document.getElementById('stat-winrate').textContent  = `${winRate}%`;

        const targetWin  = completed.filter(c => c.status === 'WIN'  && c.exitReason === 'TARGET_PROFIT').length;
        const targetLoss = completed.filter(c => c.status === 'LOSS' && c.exitReason === 'STOP_LOSS').length;
        const expiredWin = completed.filter(c => c.status === 'WIN'  && c.exitReason === 'TIME_EXPIRED').length;
        const expiredLoss= completed.filter(c => c.status === 'LOSS' && c.exitReason === 'TIME_EXPIRED').length;

        document.getElementById('stat-target-win').textContent   = targetWin;
        document.getElementById('stat-target-loss').textContent  = targetLoss;
        document.getElementById('stat-expired-win').textContent  = expiredWin;
        document.getElementById('stat-expired-loss').textContent = expiredLoss;

        // Animate win rate value for visual feedback
        const winEl = document.getElementById('stat-winrate');
        winEl.classList.remove('stat-flash');
        void winEl.offsetWidth; // reflow to restart animation
        winEl.classList.add('stat-flash');
    }

    // ─── Card Rendering ───────────────────────────────────────────────────────
    function renderGrid(tracks) {
        grid.innerHTML = '';

        if (tracks.length === 0) {
            grid.innerHTML = `<p style="color:var(--text-secondary); grid-column:1/-1; text-align:center;">No signals match your criteria.</p>`;
            return;
        }

        const { targetPct, stopLossPct, expiryDays } = getActiveThresholds();
        tracks.forEach(track => renderCard(track, targetPct, stopLossPct, expiryDays));
    }

    function renderCard(track, targetPct, stopLossPct, expiryDays) {
        const { status, exitReason, daysHeld, triggerDay } = recomputeStatus(track, targetPct, stopLossPct, expiryDays);

        const card      = document.createElement('div');
        card.className  = 'card';
        card.dataset.trackId = track.trackId;

        const d       = new Date(track.dateDetected);
        const dateStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
        const isCall  = track.direction === 'CALL';
        const isClosed = status !== 'OPEN';

        // Return at trigger (closed) or latest (open)
        let currentReturn = 0;
        if (track.dailyChanges.length > 0) {
            const idx = (isClosed && triggerDay !== null) ? triggerDay : track.dailyChanges.length - 1;
            currentReturn = track.dailyChanges[idx]?.pctChange ?? 0;
        }

        const currentClass = currentReturn >= 0 ? 'positive' : 'negative';
        const currentSign  = currentReturn > 0 ? '+' : '';
        const excursionSign= track.maxExcursionPct > 0 ? '+' : '';

        // Status badge
        let badgeStyle = '';
        if      (status === 'WIN')  badgeStyle = 'background:var(--accent-call);color:#fff;';
        else if (status === 'LOSS') badgeStyle = 'background:var(--accent-put);color:#fff;';
        else                        badgeStyle = 'background:var(--surface-light);color:var(--text-secondary);';
        const statusBadge = `<span class="badge" style="${badgeStyle}">${status}</span>`;

        // Outcome row (closed only)
        let outcomeHtml = '';
        if (isClosed) {
            const reasonMap = {
                TARGET_PROFIT: 'Target Hit 🎯',
                STOP_LOSS:     'Stop Loss ⚠️',
                TIME_EXPIRED:  'Time Expired ⏰',
            };
            const reason      = reasonMap[exitReason] || exitReason;
            const outcomeClass = status === 'WIN' ? 'win' : 'loss';
            outcomeHtml = `
                <div class="outcome-info ${outcomeClass}">
                    <span class="reason-tag">${reason}</span>
                    <span class="days-tag">Held ${daysHeld} Days</span>
                </div>`;
        }

        // Lifecycle bars — active bars + ghost bars after trigger
        let barsHtml = '';
        if (track.dailyChanges.length > 0) {
            const allPcts  = track.dailyChanges.map(c => Math.abs(c.pctChange));
            const maxAbs   = Math.max(...allPcts, 1);
            const cutoff   = (isClosed && triggerDay !== null) ? triggerDay : track.dailyChanges.length - 1;

            track.dailyChanges.forEach((day, i) => {
                const ret        = day.pctChange;
                const heightPct  = Math.max(10, (Math.abs(ret) / maxAbs) * 100);
                const isGhost    = isClosed && i > cutoff;
                const isTrigger  = i === cutoff && isClosed;
                const barClass   = isGhost ? 'ghost' : (ret >= 0 ? 'profit' : 'loss');
                const sign       = ret > 0 ? '+' : '';
                const label      = isGhost
                    ? `Day ${day.day+1}: ${sign}${ret.toFixed(2)}% (post-exit)`
                    : `Day ${day.day+1}: ${sign}${ret.toFixed(2)}%`;
                barsHtml += `<div class="day-bar ${barClass}${isTrigger ? ' trigger-bar' : ''}" style="height:${heightPct}%" data-tooltip="${label}"></div>`;
            });
        } else {
            barsHtml = `<div style="font-size:0.75rem;color:var(--text-secondary);line-height:40px;">No price data yet</div>`;
        }

        const returnLabel = isClosed ? 'Final Ret' : 'Current Ret';

        card.innerHTML = `
            <div class="card-header">
                <div class="ticker-info">
                    <span class="ticker">${track.ticker}</span>
                    <span class="date">${dateStr}</span>
                </div>
                <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end;">
                    ${statusBadge}
                    <span class="badge ${isCall ? 'call' : 'put'}">${track.direction}</span>
                </div>
            </div>

            <div class="card-stats">
                <div class="stat-col">
                    <span class="label">Entry Price</span>
                    <span class="val">$${track.startPrice ? track.startPrice.toFixed(2) : '--'}</span>
                </div>
                <div class="stat-col">
                    <span class="label" data-tooltip="Highest profit % reached since entry">Max Excursion ⓘ</span>
                    <span class="val ${track.maxExcursionPct >= 0 ? 'positive' : 'negative'}">${excursionSign}${track.maxExcursionPct}%</span>
                </div>
                <div class="stat-col">
                    <span class="label" data-tooltip="${isClosed ? 'Profit/loss % at close' : 'Current profit/loss %'}">${returnLabel} ⓘ</span>
                    <span class="val ${currentClass}">${currentSign}${currentReturn.toFixed(2)}%</span>
                </div>
            </div>

            ${outcomeHtml}

            <div>
                <div style="font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px;">
                    Lifecycle Track <span style="opacity:0.5;font-size:0.7rem;">(${track.dailyChanges.length} days data)</span>
                </div>
                <div class="days-tracker">${barsHtml}</div>
            </div>
        `;

        grid.appendChild(card);
    }
});
