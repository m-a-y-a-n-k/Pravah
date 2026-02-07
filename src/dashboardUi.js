export function renderDashboard(stats) {
    const hitRate = stats.totalRequests ? ((stats.hits / stats.totalRequests) * 100).toFixed(2) : 0;

    const formatBandwidth = (bytes) => {
        if (!bytes) return "0 B";
        if (bytes > 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        if (bytes > 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        return `${bytes} B`;
    };

    const historyData = JSON.stringify(stats.history || []);
    const regionsData = JSON.stringify(stats.regions || {});
    const urlStatsData = JSON.stringify(stats.urlStats || {});

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Continuum | Global Analytics</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' style='stop-color:%233B82F6;stop-opacity:1' /><stop offset='100%' style='stop-color:%238B5CF6;stop-opacity:1' /></linearGradient></defs><rect width='100' height='100' rx='20' fill='url(%23g)'/><text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' fill='white' font-family='Outfit, sans-serif' font-size='60' font-weight='800'>C</text></svg>">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/jsvectormap/dist/css/jsvectormap.min.css">
        <script src="https://cdn.jsdelivr.net/npm/jsvectormap"></script>
        <script src="https://cdn.jsdelivr.net/npm/jsvectormap/dist/maps/world.js"></script>
        <style>
            :root {
                --bg: #0b0f19;
                --card-bg: rgba(22, 28, 45, 0.7);
                --accent: #3b82f6;
                --accent-gradient: linear-gradient(135deg, #60a5fa 0%, #a855f7 100%);
                --text: #ffffff;
                --text-muted: #94a3b8;
                --hit: #10b981;
                --miss: #f59e0b;
                --error: #ef4444;
                --glass-border: 1px solid rgba(255, 255, 255, 0.1);
            }
            body { 
                font-family: 'Outfit', sans-serif; 
                background: var(--bg); color: var(--text); 
                margin: 0; padding: 20px 40px;
                display: flex; flex-direction: column; align-items: center;
                background-image: radial-gradient(circle at 50% 10%, rgba(59, 130, 246, 0.05) 0%, transparent 50%),
                                  radial-gradient(circle at 90% 80%, rgba(168, 85, 247, 0.05) 0%, transparent 40%);
            }
            .container { width: 100%; max-width: 1400px; }
            header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; }
            h1 { font-size: 2.2rem; margin: 0; background: var(--accent-gradient); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            
            .main-grid {
                display: grid;
                grid-template-columns: 2fr 1fr;
                gap: 24px;
                margin-bottom: 24px;
            }

            .stats-grid { 
                display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; 
                margin-bottom: 24px;
            }
            .card { 
                background: var(--card-bg); padding: 20px; border-radius: 20px; 
                border: var(--glass-border);
                backdrop-filter: blur(12px);
                transition: transform 0.3s ease, box-shadow 0.3s ease;
            }
            .card:hover { transform: translateY(-5px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
            .card-title { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 8px; font-weight: 600; letter-spacing: 1px; }
            .card-value { font-size: 1.8rem; font-weight: 600; }

            .map-container { 
                background: var(--card-bg); padding: 24px; border-radius: 24px; 
                border: var(--glass-border); position: relative;
                height: 450px;
            }
            #world-map { width: 100%; height: 100%; }

            .chart-container { 
                background: var(--card-bg); padding: 24px; border-radius: 24px; 
                border: var(--glass-border);
                height: 350px;
            }

            .search-bar {
                margin: 20px 0;
                position: relative;
                display: flex;
                gap: 12px;
            }
            .search-bar input {
                flex: 1;
                background: rgba(255,255,255,0.05);
                border: var(--glass-border);
                padding: 12px 20px;
                border-radius: 12px;
                color: white;
                font-family: inherit;
                font-size: 1rem;
                outline: none;
                transition: all 0.3s ease;
            }
            .search-bar input:focus {
                background: rgba(255,255,255,0.1);
                border-color: var(--accent);
                box-shadow: 0 0 20px rgba(59, 130, 246, 0.2);
            }
            .search-btn {
                background: var(--accent-gradient);
                border: none;
                padding: 12px 24px;
                border-radius: 12px;
                color: white;
                font-weight: 600;
                cursor: pointer;
            }

            .table-container {
                background: var(--card-bg); border-radius: 24px; border: var(--glass-border);
                overflow: hidden; margin-top: 24px;
            }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 16px 24px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }
            th { background: rgba(0,0,0,0.3); color: var(--text-muted); font-size: 0.8rem; text-transform: uppercase; font-weight: 600; }
            tr:last-child td { border-bottom: none; }
            tr:hover td { background: rgba(255,255,255,0.02); }

            .badge {
                padding: 4px 10px; border-radius: 20px; font-size: 0.75rem; font-weight: 600;
            }
            .badge-hit { background: rgba(16, 185, 129, 0.1); color: var(--hit); }
            .badge-miss { background: rgba(245, 158, 11, 0.1); color: var(--miss); }
            
            .top-url-list {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }
            .url-item {
                display: flex; justify-content: space-between; align-items: center;
                padding: 12px; border-radius: 12px; background: rgba(255,255,255,0.03);
                border: 1px solid rgba(255,255,255,0.03);
            }
            .url-path { font-family: monospace; font-size: 0.9rem; color: #60a5fa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 200px; }

            #status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--hit); box-shadow: 0 0 10px var(--hit); display: inline-block; margin-right: 8px; }
        </style>
    </head>
    <body>
        <div class="container">
            <header>
                <div>
                    <h1>Continuum Network</h1>
                    <p style="color: var(--text-muted); margin-top: 5px;"><span id="status-dot"></span>Global Delivery Edge Status: Active</p>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">LAST UPDATED</div>
                    <div style="font-weight: 600; font-variant-numeric: tabular-nums;" id="last-updated">${new Date().toLocaleTimeString()}</div>
                </div>
            </header>

            <div class="stats-grid">
                <div class="card">
                    <div class="card-title">Edge Requests</div>
                    <div class="card-value" id="stat-requests">${stats.totalRequests}</div>
                </div>
                <div class="card">
                    <div class="card-title">Global Bandwidth</div>
                    <div class="card-value" style="color: #a855f7;" id="stat-bandwidth">${formatBandwidth(stats.bandwidth)}</div>
                </div>
                <div class="card">
                    <div class="card-title">Cache Hit Rate</div>
                    <div class="card-value" style="color: var(--hit);" id="stat-hitrate">${hitRate}%</div>
                </div>
                <div class="card">
                    <div class="card-title">Active POPs</div>
                    <div class="card-value" style="color: var(--accent);">
                        ${Object.keys(stats.regions || {}).length}
                    </div>
                </div>
            </div>

            <div class="search-bar">
                <input type="text" id="url-search" placeholder="Filter by Request URL (e.g. /images/logo.png)..." autocomplete="off">
                <button class="search-btn" onclick="filterByUrl()">Search & Filter</button>
            </div>

            <div class="main-grid">
                <div class="map-container">
                    <div class="card-title" style="margin-bottom: 15px;">Global Request Distribution</div>
                    <div id="world-map"></div>
                </div>
                <div class="card" style="display: flex; flex-direction: column;">
                    <div class="card-title" style="margin-bottom: 15px;">Top Requested Assets</div>
                    <div class="top-url-list" id="top-urls">
                        ${Object.entries(stats.urlStats || {})
            .sort((a, b) => b[1].total - a[1].total)
            .slice(0, 7)
            .map(([url, s]) => `
                                <div class="url-item">
                                    <div class="url-path" title="${url}">${url}</div>
                                    <div style="font-weight: 600; font-size: 0.9rem;">${s.total}</div>
                                </div>
                            `).join('') || '<div style="color: var(--text-muted); text-align: center; margin-top: 20px;">No URLs logged yet</div>'}
                    </div>
                </div>
            </div>

            <div class="chart-container">
                <div class="card-title" style="margin-bottom: 15px;">Traffic Performance (Last 60m)</div>
                <canvas id="trafficChart"></canvas>
            </div>

            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Domain</th>
                            <th>Total Traffic</th>
                            <th>Hits</th>
                            <th>Misses</th>
                            <th>Hit Rate</th>
                            <th>Bandwidth</th>
                        </tr>
                    </thead>
                    <tbody id="domain-table">
                        ${Object.entries(stats.domains || {}).map(([domain, d]) => {
                const dHitRate = d.totalRequests ? ((d.hits / d.totalRequests) * 100).toFixed(1) : 0;
                return `
                                <tr>
                                    <td style="font-weight: 600;">${domain}</td>
                                    <td>${d.totalRequests}</td>
                                    <td><span style="color: var(--hit)">${d.hits}</span></td>
                                    <td><span style="color: var(--miss)">${d.misses}</span></td>
                                    <td><span class="badge badge-hit">${dHitRate}%</span></td>
                                    <td>${formatBandwidth(d.bandwidth)}</td>
                                </tr>
                            `;
            }).join('') || '<tr><td colspan="6" style="text-align: center; color: var(--text-muted);">No domain traffic</td></tr>'}
                    </tbody>
                </table>
            </div>
        </div>

        <script>
            const fullStats = {
                history: ${historyData},
                regions: ${regionsData},
                urlStats: ${urlStatsData},
                totalRequests: ${stats.totalRequests},
                bandwidth: ${stats.bandwidth},
                hits: ${stats.hits},
                domains: ${JSON.stringify(stats.domains || {})}
            };

            let map = null;

            function initMap(regions) {
                if (map) map.destroy();
                
                // Format regions for jsvectormap
                const mapData = {};
                Object.entries(regions).forEach(([code, count]) => {
                    mapData[code] = count;
                });

                map = new jsVectorMap({
                    selector: '#world-map',
                    map: 'world',
                    backgroundColor: 'transparent',
                    draggable: true,
                    zoomButtons: false,
                    regionStyle: {
                        initial: { fill: 'rgba(255,255,255,0.05)', stroke: 'rgba(255,255,255,0.1)', strokeWidth: 0.5 },
                        hover: { fill: 'rgba(59, 130, 246, 0.5)' }
                    },
                    visualizeData: {
                        scale: ['#1e293b', '#3b82f6'],
                        values: mapData
                    },
                    onRegionTooltipShow(event, tooltip, code) {
                        const count = mapData[code] || 0;
                        tooltip.text('<b>' + tooltip.text() + '</b><br/>Requests: ' + count);
                    }
                });
            }

            function filterByUrl() {
                const search = document.getElementById('url-search').value.trim();
                let filteredStats = {...fullStats};
                
                if (search) {
                    const u = fullStats.urlStats[search];
                    if (u) {
                        // Create a subset of stats for the specific URL
                        filteredStats = {
                            ...fullStats,
                            totalRequests: u.total,
                            bandwidth: u.bandwidth,
                            hits: u.hits,
                            misses: u.misses,
                            regions: u.regions
                        };
                    } else {
                        alert('No data found for this specific URL path.');
                        return;
                    }
                }

                // Update UI elements
                document.getElementById('stat-requests').innerText = filteredStats.totalRequests;
                document.getElementById('stat-bandwidth').innerText = formatBandwidth(filteredStats.bandwidth);
                const hr = filteredStats.totalRequests ? ((filteredStats.hits / filteredStats.totalRequests) * 100).toFixed(2) : 0;
                document.getElementById('stat-hitrate').innerText = hr + '%';
                
                // Re-init map with filtered regions
                initMap(filteredStats.regions);
            }

            function formatBandwidth(bytes) {
                if (!bytes) return "0 B";
                if (bytes > 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
                if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
                if (bytes > 1024) return (bytes / 1024).toFixed(2) + " KB";
                return bytes + " B";
            }

            // Init Chart
            const ctx = document.getElementById('trafficChart').getContext('2d');
            new Chart(ctx, {
                type: 'line',
                data: {
                    labels: fullStats.history.map(p => new Date(p.timestamp).toLocaleTimeString([], {minute:'2-digit', second:'2-digit'})),
                    datasets: [
                        { label: 'Hits', data: fullStats.history.map(p => p.hits), borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.1)', fill: true, tension: 0.4 },
                        { label: 'Misses', data: fullStats.history.map(p => p.misses), borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.1)', fill: true, tension: 0.4 }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: '#94a3b8', font: { family: 'Outfit' } } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' }, beginAtZero: true }
                    }
                }
            });

            // Initial Map
            window.addEventListener('load', () => {
                initMap(fullStats.regions);
            });

            // Auto-refresh (disabled if searching to avoid losing focus)
            const searchInput = document.getElementById('url-search');
            setInterval(() => {
                if (!searchInput.value) window.location.reload();
            }, 30000);
        </script>
    </body>
    </html>
    `;
}

