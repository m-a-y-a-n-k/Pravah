import http from "http";
import cluster from "cluster";
import os from "os";
import { handleRequest, cleanupExpiredCache } from "./proxy.js";
import { getStats, saveStats, logRequest } from "./analytics.js";
import { config } from "./config.js";
import { domainManager } from "./domainManager.js";
import { renderAdminDashboard } from "./adminUi.js";
import { logger } from "./logger.js";
import { checkAuth, requireAuth } from "./auth.js";

const PORT = config.port;

if (config.cluster && cluster.isPrimary) {
    const numWorkers = config.maxWorkers || os.cpus().length;
    logger.info(`🛡️ Pravah Primary ${process.pid} is running`);
    logger.info(`📊 Dashboard available at http://localhost:${PORT}/cdn-dashboard`);
    logger.info(`🔧 Admin Control Center at http://localhost:${PORT}/admin-dashboard (User: admin, Pass: admin123)`);

    // Fork workers.
    for (let i = 0; i < numWorkers; i++) {
        cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
        console.log(`⚠️ Worker ${worker.process.pid} died. Forking a new one...`);
        cluster.fork();
    });

    // Periodic GC only on Primary
    setInterval(() => {
        cleanupExpiredCache();
    }, 10 * 60 * 1000);

    // Initial GC
    cleanupExpiredCache();

    // Graceful Shutdown Logic for Primary
    async function shutdown(signal) {
        console.log(`\nRECEIVED ${signal}. Starting graceful shutdown...`);

        // 1. Perform Garbage Collection
        await cleanupExpiredCache();

        // 2. Final Analytics Save
        saveStats();
        console.log("📊 Analytics saved.");

        // 3. Disconnect all workers
        for (const id in cluster.workers) {
            cluster.workers[id].send('shutdown');
            cluster.workers[id].disconnect();
        }

        // 4. Close Server (if primary was also listening, though typically it just manages workers)
        // In this setup, the primary doesn't listen on the port directly, workers do.
        // So, we just wait for workers to exit.
        let workersExited = 0;
        const totalWorkers = Object.keys(cluster.workers).length;

        if (totalWorkers === 0) {
            console.log("🛑 All workers already exited. Goodbye!");
            process.exit(0);
        }

        cluster.on('disconnect', (worker) => {
            console.log(`Worker ${worker.process.pid} disconnected.`);
            workersExited++;
            if (workersExited === totalWorkers) {
                console.log("🛑 All workers shut down. Primary exiting. Goodbye!");
                process.exit(0);
            }
        });

        // Force exit if hanging
        setTimeout(() => {
            console.error("Force exiting primary...");
            process.exit(1);
        }, 10000); // Give workers more time to shut down
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

} else {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);

        // --- AUTH MIDDLEWARE FOR ADMIN ---
        if ((url.pathname.startsWith("/admin/") || url.pathname === "/admin-dashboard") && !checkAuth(req)) {
            return requireAuth(req, res);
        }

        // --- ADMIN API ---
        if (url.pathname === "/admin/domains" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(domainManager.getAll(), null, 2));
            return;
        }

        if (url.pathname === "/admin/domains" && req.method === "POST") {
            let body = [];
            req.on("data", chunk => body.push(chunk));
            req.on("end", async () => {
                try {
                    const data = JSON.parse(Buffer.concat(body).toString());
                    if (data.hostname && data.origin) {
                        await domainManager.addDomain(data.hostname, data.origin);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ success: true, msg: `Added ${data.hostname}` }));
                    } else {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ success: false, msg: "Missing hostname or origin" }));
                    }
                } catch (e) {
                    res.writeHead(400);
                    res.end("Invalid JSON");
                }
            });
            return;
        }

        if (url.pathname === "/admin/domains" && req.method === "DELETE") {
            let body = [];
            req.on("data", chunk => body.push(chunk));
            req.on("end", async () => {
                try {
                    const data = JSON.parse(Buffer.concat(body).toString());
                    if (data.hostname) {
                        const success = await domainManager.removeDomain(data.hostname);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ success, msg: success ? `Removed ${data.hostname}` : "Not found" }));
                    } else {
                        res.writeHead(400);
                        res.end("Missing hostname");
                    }
                } catch (e) {
                    res.writeHead(400);
                    res.end("Invalid JSON");
                }
            });
            return;
        }

        // --- ADMIN DASHBOARD UI ---
        if (url.pathname === "/admin-dashboard") {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(renderAdminDashboard());
            return;
        }


        if (url.pathname === "/cdn-dashboard") {
            const stats = getStats();
            // Inject domain info into stats for dashboard
            stats.activeDomains = Object.keys(domainManager.getAll()).length;

            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(renderDashboard(stats));
            return;
        }

        // ... rest of the server logic

        if (url.pathname === "/cdn-purge") {
            const path = url.searchParams.get("path") || "all";
            const domain = url.searchParams.get("domain");
            const result = purgeCache(path, domain);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
            return;
        }

        if (url.pathname === "/favicon.ico") {
            res.writeHead(204);
            return res.end();
        }

        // Basic Health Check
        if (url.pathname === "/health") {
            res.writeHead(200);
            return res.end("OK");
        }

        try {
            await handleRequest(req, res);
        } catch (err) {
            console.error("Error:", err);
            logRequest("ERROR");
            res.writeHead(500);
            res.end("Internal CDN Error");
        }
    });

    server.listen(PORT, () => {
        console.log(`🚀 Pravah Worker ${process.pid} started on port ${PORT}`);
    });

    // Graceful Shutdown Logic for Workers
    async function shutdown(signal) {
        console.log(`\nWorker ${process.pid} received ${signal}.`);
        saveStats(); // Save analytics before shutdown
        server.close(() => {
            console.log(`Worker ${process.pid} server closed.`);
            process.exit(0);
        });

        // Force exit if hanging
        setTimeout(() => {
            console.error(`Worker ${process.pid} force exiting...`);
            process.exit(1);
        }, 5000);
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

    // Listen for messages from primary to initiate shutdown
    process.on('message', (msg) => {
        if (msg === 'shutdown') {
            shutdown('Primary initiated shutdown');
        }
    });
}

function renderDashboard(stats) {
    const hitRate = stats.totalRequests ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2) : 0;

    const formatBandwidth = (bytes) => {
        if (bytes > 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
        if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        if (bytes > 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        return `${bytes} B`;
    };

    const bandwidthStr = formatBandwidth(stats.bandwidth || 0);

    const domainsHtml = Object.keys(stats.domains || {}).map(domain => {
        const d = stats.domains[domain];
        const dHitRate = d.totalRequests ? ((d.hits / (d.hits + d.misses)) * 100).toFixed(2) : 0;
        return `
            <tr>
                <td>${domain}</td>
                <td>${d.totalRequests}</td>
                <td>${formatBandwidth(d.bandwidth)}</td>
                <td><span class="${dHitRate > 80 ? 'hit' : dHitRate > 50 ? 'miss' : 'error'}">${dHitRate}%</span></td>
            </tr>
        `;
    }).join("");

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Pravah CDN Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600&display=swap" rel="stylesheet">
        <style>
             :root {
                --bg: #0b0f19;
                --card-bg: #161c2d;
                --accent: #3b82f6;
                --text: #ffffff;
                --text-muted: #94a3b8;
                --hit: #10b981;
                --miss: #f59e0b;
                --error: #ef4444;
            }
            body { 
                font-family: 'Outfit', sans-serif; 
                background: var(--bg); 
                color: var(--text); 
                margin: 0; 
                padding: 40px;
                display: flex;
                flex-direction: column;
                align-items: center;
            }
            .header { margin-bottom: 60px; text-align: center; }
            h1 { font-size: 3.5rem; margin: 0; background: linear-gradient(135deg, #60a5fa 0%, #a855f7 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
            .stats-grid { 
                display: grid; 
                grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); 
                gap: 24px; 
                width: 100%; 
                max-width: 1100px; 
                margin-bottom: 40px;
            }
            .card { 
                background: var(--card-bg); 
                padding: 30px; 
                border-radius: 24px; 
                border: 1px solid rgba(255,255,255,0.05);
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                position: relative;
                overflow: hidden;
            }
            .card:hover { transform: translateY(-8px); border-color: rgba(96, 165, 250, 0.3); box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04); }
            .card-title { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 12px; font-weight: 600; }
            .card-value { font-size: 2.5rem; font-weight: 600; }
            .hit { color: var(--hit); }
            .miss { color: var(--miss); }
            .error { color: var(--error); }
            .footer { margin-top: 60px; color: var(--text-muted); font-size: 0.875rem; opacity: 0.6; }
            
            table { width: 100%; max-width: 1100px; border-collapse: collapse; margin-top: 20px; background: var(--card-bg); border-radius: 16px; overflow: hidden; }
            th, td { padding: 20px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.05); }
            th { background: rgba(0,0,0,0.2); color: var(--text-muted); font-weight: 600; text-transform: uppercase; font-size: 0.8rem; }
            tr:last-child td { border-bottom: none; }
            tr:hover { background: rgba(255,255,255,0.02); }

            .refresh {
                margin-top: 30px;
                padding: 12px 28px;
                background: var(--accent);
                color: white;
                border: none;
                border-radius: 9999px;
                cursor: pointer;
                font-weight: 600;
                transition: all 0.2s;
                box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3);
            }
            .refresh:hover { opacity: 0.9; transform: scale(1.05); }
        </style>
        <script>
            setTimeout(() => window.location.reload(), 3000);
        </script>
    </head>
    <body>
        <div class="header">
            <h1>Pravah</h1>
            <p style="color: #94a3b8; font-size: 1.1rem; margin-top: 10px;">Multi-Tenant SaaS CDN Platform</p>
        </div>
        <div class="stats-grid">
            <div class="card">
                <div class="card-title">Total Requests</div>
                <div class="card-value">${stats.totalRequests}</div>
            </div>
            <div class="card">
                <div class="card-title">Data Served</div>
                <div class="card-value">${bandwidthStr}</div>
            </div>
            <div class="card">
                <div class="card-title">Global Cache Hit Rate</div>
                <div class="card-value hit">${hitRate}%</div>
            </div>
             <div class="card">
                <div class="card-title">Active Domains</div>
                <div class="card-value" style="color: #a855f7;">${Object.keys(stats.domains || {}).length}</div>
            </div>
        </div>

        <h3 style="margin-bottom: 20px; width: 100%; max-width: 1100px; text-align: left;">Domain Performance</h3>
        <table>
            <thead>
                <tr>
                    <th>Domain</th>
                    <th>Requests</th>
                    <th>Bandwidth</th>
                    <th>Hit Rate</th>
                </tr>
            </thead>
            <tbody>
                ${domainsHtml || '<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">No traffic recorded yet.</td></tr>'}
            </tbody>
        </table>

        <button class="refresh" onclick="window.location.reload()">Refresh Metrics</button>
        <div class="footer">
            Server Time: ${new Date().toLocaleTimeString()} | Last Persisted: ${new Date(stats.lastUpdate || Date.now()).toLocaleTimeString()}
        </div>
    </body>
    </html>
    `;
}

