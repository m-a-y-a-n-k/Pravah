export function renderAdminDashboard() {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Continuum | Admin Control Center</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
        <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><defs><linearGradient id='g' x1='0%' y1='0%' x2='100%' y2='100%'><stop offset='0%' style='stop-color:%233B82F6;stop-opacity:1' /><stop offset='100%' style='stop-color:%238B5CF6;stop-opacity:1' /></linearGradient></defs><rect width='100' height='100' rx='20' fill='url(%23g)'/><text x='50%' y='50%' dominant-baseline='central' text-anchor='middle' fill='white' font-family='Outfit, sans-serif' font-size='60' font-weight='800'>C</text></svg>">
        <style>
            :root {
                --bg: #05070a;
                --sidebar-bg: #0c0f16;
                --card-bg: #111622;
                --accent: #3b82f6;
                --accent-glow: rgba(59, 130, 246, 0.4);
                --text: #ffffff;
                --text-muted: #8b949e;
                --border: rgba(255,255,255,0.08);
                --success: #10b981;
                --danger: #ef4444;
                --glass: rgba(255, 255, 255, 0.03);
            }

            * { box-sizing: border-box; margin: 0; }
            body { 
                font-family: 'Outfit', sans-serif; 
                background: var(--bg); 
                color: var(--text); 
                display: flex;
                min-height: 100vh;
            }

            .sidebar {
                width: 260px;
                background: var(--sidebar-bg);
                border-right: 1px solid var(--border);
                display: flex;
                flex-direction: column;
                padding: 30px 20px;
                position: fixed;
                height: 100vh;
            }
            .logo {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 50px;
                font-size: 1.5rem;
                font-weight: 600;
                background: linear-gradient(135deg, #60a5fa 0%, #a855f7 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
            }
            .nav-item {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px 16px;
                color: var(--text-muted);
                text-decoration: none;
                border-radius: 12px;
                margin-bottom: 8px;
                transition: all 0.2s;
            }
            .nav-item:hover, .nav-item.active { background: var(--glass); color: var(--text); }
            .nav-item.active { border-left: 3px solid var(--accent); }

            .main { flex: 1; margin-left: 260px; padding: 40px 60px; }
            header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 40px; }
            h1 { font-size: 2.2rem; font-weight: 600; }
            
            .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 30px; }
            .card {
                background: var(--card-bg);
                border: 1px solid var(--border);
                border-radius: 20px;
                padding: 30px;
                position: relative;
                box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
            }

            .form-group { margin-bottom: 20px; }
            label { display: block; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; }
            input, select {
                width: 100%;
                background: rgba(0,0,0,0.3);
                border: 1px solid var(--border);
                color: white;
                padding: 14px 18px;
                border-radius: 12px;
            }

            .btn {
                padding: 12px 24px;
                border-radius: 10px;
                border: none;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
            }
            .btn-primary { background: var(--accent); color: white; }

            .domain-item {
                background: var(--glass);
                border: 1px solid var(--border);
                border-radius: 16px;
                padding: 20px;
                margin-bottom: 15px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .badge {
                padding: 4px 10px;
                border-radius: 8px;
                font-size: 0.7rem;
                background: rgba(59, 130, 246, 0.1);
                color: var(--accent);
            }

            #toast {
                position: fixed; bottom: 40px; right: 40px;
                padding: 16px 24px; border-radius: 16px;
                background: var(--card-bg);
                border: 1px solid var(--border);
                transform: translateX(200%);
                transition: transform 0.4s;
                z-index: 1000;
            }
            #toast.show { transform: translateX(0); }
        </style>
    </head>
    <body>
        <div class="sidebar">
            <div class="logo">Continuum</div>
            <a href="#" class="nav-item active">Domains</a>
            <a href="/cdn-dashboard" class="nav-item">Analytics</a>
            <a href="#" class="nav-item">Settings</a>
        </div>

        <div class="main">
            <header>
                <h1>Domain Management</h1>
            </header>

            <div class="grid">
                <div>
                    <div class="card" style="margin-bottom: 30px;">
                        <form id="addDomainForm">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px;">
                                <div class="form-group">
                                    <label>Hostname</label>
                                    <input type="text" id="hostInput" placeholder="blog.site.com" required>
                                </div>
                                <div class="form-group">
                                    <label>Origin</label>
                                    <input type="url" id="originInput" placeholder="https://origin.com" required>
                                </div>
                            </div>
                            <button type="submit" class="btn btn-primary">Provision Domain</button>
                        </form>
                    </div>
                    <div id="domainList"></div>
                </div>

                <div class="card">
                    <h3>Edge Network Instructions</h3>
                    <p style="color: var(--text-muted); font-size: 0.9rem; margin-top: 15px; line-height: 1.6;">
                        To point a new domain to Continuum:<br><br>
                        1. Create a <b>CNAME</b> record in your DNS provider.<br>
                        2. Point it to: <code>edge.continuum-cdn.com</code><br>
                        3. Click "Verify DNS" to check status.
                    </p>
                </div>
            </div>
        </div>

        <div id="toast"></div>

        <script>
            async function fetchDomains() {
                const res = await fetch('/admin/domains');
                const data = await res.json();
                renderDomains(data);
            }

            function renderDomains(domains) {
                const list = document.getElementById('domainList');
                list.innerHTML = '';
                Object.entries(domains).forEach(([host, config]) => {
                    const item = document.createElement('div');
                    item.className = 'domain-item';
                    const origin = typeof config === 'string' ? config : config.origin;
                    item.innerHTML = \`
                        <div>
                            <div style="font-weight: 600; font-size: 1.1rem; margin-bottom: 4px;">\${host}</div>
                            <div style="font-size: 0.85rem; color: var(--text-muted); font-family: monospace;">\${origin}</div>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <button class="btn" style="padding: 6px 12px; font-size: 0.7rem;" onclick="verifyDNS('\${host}')">Verify DNS</button>
                            <button class="btn" style="padding: 6px 12px; font-size: 0.7rem;" onclick="provisionSSL('\${host}')">SSL</button>
                            <button class="btn" style="padding: 6px 12px; font-size: 0.7rem; color: var(--danger);" onclick="deleteDomain('\${host}')">Delete</button>
                        </div>
                    \`;
                    list.appendChild(item);
                });
            }

            async function verifyDNS(host) {
                showToast('Checking DNS...');
                const res = await fetch('/admin/dns-verify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hostname: host })
                });
                const data = await res.json();
                if (data.success) showToast('✅ DNS Correctly Pointed', true);
                else showToast('❌ ' + data.error);
            }

            async function provisionSSL(host) {
                showToast('Requesting SSL...');
                const res = await fetch('/admin/ssl-provision', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hostname: host })
                });
                const data = await res.json();
                if (data.success) showToast('✅ SSL Issued Successfully!', true);
                else showToast('❌ SSL Failed: ' + data.msg);
            }

            async function deleteDomain(host) {
                if(!confirm('Delete ' + host + '?')) return;
                await fetch('/admin/domains', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hostname: host })
                });
                fetchDomains();
            }

            document.getElementById('addDomainForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                await fetch('/admin/domains', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        hostname: document.getElementById('hostInput').value,
                        origin: document.getElementById('originInput').value
                    })
                });
                e.target.reset();
                fetchDomains();
                showToast('Domain Added');
            });

            function showToast(msg, isSuccess) {
                const t = document.getElementById('toast');
                t.textContent = msg;
                t.style.borderColor = isSuccess ? 'var(--success)' : 'var(--border)';
                t.classList.add('show');
                setTimeout(() => t.classList.remove('show'), 3000);
            }

            fetchDomains();
        </script>
    </body>
    </html>
    `;
}
