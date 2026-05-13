document.addEventListener('DOMContentLoaded', () => {
    const grid = document.getElementById('signals-grid');
    const loading = document.getElementById('loading');
    const searchInput = document.getElementById('search');
    const directionFilter = document.getElementById('direction-filter');
    const lastUpdated = document.getElementById('last-updated');
    
    let allTracks = [];

    // Fetch data
    fetch('data.json')
        .then(res => {
            if (!res.ok) throw new Error("Could not fetch data.json");
            return res.json();
        })
        .then(data => {
            allTracks = data.tracks || [];
            
            // Set Last Updated
            if (data.updatedAt) {
                const d = new Date(data.updatedAt);
                lastUpdated.textContent = `Last Updated: ${d.toLocaleString()}`;
            }

            updateStats();
            renderGrid(allTracks);
            loading.style.display = 'none';
        })
        .catch(err => {
            console.error(err);
            loading.innerHTML = `<p style="color:var(--accent-put)">Failed to load data. Ensure verification job has run.</p>`;
        });

    // Event Listeners for Filters
    searchInput.addEventListener('input', applyFilters);
    directionFilter.addEventListener('change', applyFilters);

    function applyFilters() {
        const query = searchInput.value.toUpperCase();
        const dir = directionFilter.value;

        const filtered = allTracks.filter(track => {
            const matchSearch = track.ticker.includes(query);
            const matchDir = dir === 'ALL' || track.direction === dir;
            return matchSearch && matchDir;
        });

        renderGrid(filtered);
    }

    function updateStats() {
        const activeCount = allTracks.length;
        document.getElementById('stat-signals').textContent = activeCount;

        if (activeCount === 0) return;

        const completed = allTracks.filter(t => t.status !== "OPEN");
        const wins = completed.filter(t => t.status === "WIN").length;
        const winRate = completed.length > 0 ? ((wins / completed.length) * 100).toFixed(1) : "0.0";
        
        document.getElementById('stat-winrate').textContent = `${winRate}%`;
    }

    function renderGrid(tracks) {
        grid.innerHTML = '';
        
        if (tracks.length === 0) {
            grid.innerHTML = `<p style="color:var(--text-secondary); grid-column: 1/-1; text-align: center;">No signals match your criteria.</p>`;
            return;
        }

        tracks.forEach(track => {
            const card = document.createElement('div');
            card.className = 'card';

            const d = new Date(track.dateDetected);
            const dateStr = `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
            
            const isCall = track.direction === 'CALL';
            
            // Find current return (last day in array)
            let currentReturn = 0;
            if (track.dailyChanges.length > 0) {
                const lastDay = track.dailyChanges[track.dailyChanges.length - 1];
                currentReturn = lastDay.pctChange;
                // If it's a PUT, negative price change is positive return
                if (!isCall) currentReturn = -currentReturn;
            }

            const currentClass = currentReturn >= 0 ? 'positive' : 'negative';
            const currentSign = currentReturn > 0 ? '+' : '';

            const excursionClass = track.maxExcursionPct > 0 ? 'positive' : 'negative';
            const excursionSign = track.maxExcursionPct > 0 ? '+' : '';
            
            const statusBadge = track.status === 'OPEN' 
                ? '<span class="badge" style="background: var(--surface-light); color: var(--text-secondary);">OPEN</span>'
                : `<span class="badge ${track.status === 'WIN' ? 'call' : 'put'}">${track.status}</span>`;

            // Build tracking bars
            let barsHtml = '';
            if (track.dailyChanges.length > 0) {
                const maxAbs = Math.max(...track.dailyChanges.map(c => Math.abs(c.pctChange)), 1); // Avoid div by 0
                
                track.dailyChanges.forEach(day => {
                    let ret = day.pctChange;
                    if (!isCall) ret = -ret; // Invert for puts
                    
                    const heightPct = Math.max(10, (Math.abs(ret) / maxAbs) * 100);
                    const barClass = ret >= 0 ? 'profit' : 'loss';
                    const sign = ret > 0 ? '+' : '';
                    
                    barsHtml += `<div class="day-bar ${barClass}" style="height: ${heightPct}%" data-tooltip="Day ${day.day+1}: ${sign}${ret.toFixed(2)}%"></div>`;
                });
            } else {
                barsHtml = `<div style="font-size: 0.75rem; color: var(--text-secondary); line-height: 40px;">No price data yet</div>`;
            }

            card.innerHTML = `
                <div class="card-header">
                    <div class="ticker-info">
                        <span class="ticker">${track.ticker}</span>
                        <span class="date">${dateStr}</span>
                    </div>
                    <div style="display: flex; gap: 4px;">
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
                        <span class="label">Max Excursion</span>
                        <span class="val ${excursionClass}">${excursionSign}${track.maxExcursionPct}%</span>
                    </div>
                    <div class="stat-col">
                        <span class="label">Current Ret</span>
                        <span class="val ${currentClass}">${currentSign}${currentReturn.toFixed(2)}%</span>
                    </div>
                </div>

                <div>
                    <div style="font-size: 0.75rem; color: var(--text-secondary); margin-bottom: 4px;">Lifecycle Track</div>
                    <div class="days-tracker">
                        ${barsHtml}
                    </div>
                </div>
            `;

            grid.appendChild(card);
        });
    }
});
