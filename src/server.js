import http from "http";
import cluster from "cluster";
import os from "os";
import { handleRequest, cleanupExpiredCache, purgeCache } from "./proxy.js";
import { getStats, saveStats, logRequest } from "./analytics.js";
import { config } from "./config.js";
import { domainManager } from "./domainManager.js";
import { renderAdminDashboard } from "./adminUi.js";
import { renderLandingPage } from "./landing.js";
import { renderLoginPage } from "./authUi.js";
import { renderDashboard } from "./dashboardUi.js";
import { logger } from "./logger.js";
import { checkAuth, requireAuth, sendLoginOTP, verifyLoginOTP, startGoogleLogin } from "./auth.js";
import { startHealthMonitor } from "./healthMonitor.js";
import { dnsManager } from "./dnsManager.js";
import { sslManager } from "./sslManager.js";

const PORT = config.port;

if (config.cluster && cluster.isPrimary) {
    const numWorkers = config.maxWorkers || os.cpus().length;
    logger.info(`🛡️ Continuum Primary ${process.pid} is running`);
    logger.info(`� Dashboard: http://localhost:${PORT}/cdn-dashboard`);
    logger.info(`🔧 Admin: http://localhost:${PORT}/admin-dashboard`);

    for (let i = 0; i < numWorkers; i++) {
        cluster.fork();
    }

    startHealthMonitor();

    cluster.on("exit", (worker) => {
        logger.warn(`⚠️ Worker ${worker.process.pid} died. Forking a new one...`);
        cluster.fork();
    });

    // Periodic GC on Primary
    setInterval(() => cleanupExpiredCache(), 10 * 60 * 1000);

    async function shutdown(signal) {
        logger.info(`\nRECEIVED ${signal}. Graceful shutdown...`);
        saveStats();
        for (const id in cluster.workers) {
            cluster.workers[id].send('shutdown');
            cluster.workers[id].disconnect();
        }
        setTimeout(() => process.exit(0), 2000);
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));

} else {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://${req.headers.host}`);

        if (url.pathname === "/login") {
            res.writeHead(200, { "Content-Type": "text/html" });
            return res.end(renderLoginPage());
        }
        if (url.pathname === "/auth/login" && req.method === "POST") return sendLoginOTP(req, res);
        if (url.pathname === "/auth/verify" && req.method === "POST") return verifyLoginOTP(req, res);
        if (url.pathname === "/auth/google") return startGoogleLogin(req, res);

        if ((url.pathname.startsWith("/admin/") || url.pathname === "/admin-dashboard") && !(await checkAuth(req))) {
            return requireAuth(req, res);
        }

        if (url.pathname === "/admin/domains" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify(domainManager.getAll()));
        }

        if (url.pathname === "/admin/domains" && req.method === "POST") {
            let body = [];
            req.on("data", chunk => body.push(chunk));
            req.on("end", async () => {
                try {
                    const data = JSON.parse(Buffer.concat(body).toString());
                    await domainManager.addDomain(data.hostname, data.origin, { plan: data.plan });
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ success: true }));
                } catch (e) { res.writeHead(400); res.end("Error"); }
            });
            return;
        }

        if (url.pathname === "/admin/domains" && req.method === "DELETE") {
            let body = [];
            req.on("data", chunk => body.push(chunk));
            req.on("end", async () => {
                try {
                    const data = JSON.parse(Buffer.concat(body).toString());
                    const success = await domainManager.removeDomain(data.hostname);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ success }));
                } catch (e) { res.writeHead(400); res.end("Error"); }
            });
            return;
        }

        // --- DNS & SSL API ---
        if (url.pathname === "/admin/dns-verify" && req.method === "POST") {
            let body = [];
            req.on("data", chunk => body.push(chunk));
            req.on("end", async () => {
                const { hostname } = JSON.parse(Buffer.concat(body).toString());
                const result = await dnsManager.verifyCNAME(hostname, "edge.continuum-cdn.com");
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(result));
            });
            return;
        }

        if (url.pathname === "/admin/ssl-provision" && req.method === "POST") {
            let body = [];
            req.on("data", chunk => body.push(chunk));
            req.on("end", async () => {
                const { hostname } = JSON.parse(Buffer.concat(body).toString());
                try {
                    const result = await sslManager.getCertificate(hostname);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ success: true, msg: "SSL Certificate Ready" }));
                } catch (e) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ success: false, msg: e.message }));
                }
            });
            return;
        }

        if (url.pathname === "/" || url.pathname === "/landing") {
            res.writeHead(200, { "Content-Type": "text/html" });
            return res.end(renderLandingPage());
        }

        if (url.pathname === "/admin-dashboard") {
            res.writeHead(200, { "Content-Type": "text/html" });
            return res.end(renderAdminDashboard());
        }

        if (url.pathname === "/cdn-dashboard") {
            res.writeHead(200, { "Content-Type": "text/html" });
            return res.end(renderDashboard(getStats()));
        }

        if (url.pathname === "/cdn-purge") {
            const result = purgeCache(url.searchParams.get("path") || "all", url.searchParams.get("domain"));
            res.writeHead(200, { "Content-Type": "application/json" });
            return res.end(JSON.stringify(result));
        }

        if (url.pathname === "/health") {
            res.writeHead(200); return res.end("OK");
        }

        try {
            await handleRequest(req, res);
        } catch (err) {
            logger.error("Proxy Error", { error: err.message });
            logRequest("ERROR", hostname, req.url, req.socket.remoteAddress);
            res.writeHead(500); res.end("Internal Error");
        }
    });

    server.listen(PORT, () => logger.info(`🚀 Worker ${process.pid} on ${PORT}`));

    process.on('message', (msg) => {
        if (msg === 'shutdown') {
            saveStats();
            server.close(() => process.exit(0));
        }
    });
}
