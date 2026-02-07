import fs from "fs";
import path from "path";
import crypto from "crypto";
import http from "http";
import https from "https";
import zlib from "zlib";
import { config } from "./config.js";
import { logRequest, logBandwidth } from "./analytics.js";
import { logger } from "./logger.js";
import Redis from "ioredis";

import { domainManager } from "./domainManager.js";
import { checkWAF } from "./waf.js";
import { renderLandingPage } from "./landing.js";
import { optimizeImage } from "./imageProcessor.js";
import { executeEdgeRule } from "./edgeEngine.js";

const CACHE_DIR = config.cacheDir;
// Redis Client Initialization
let redis = null;
if (config.redis.enabled) {
    redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        retryStrategy: (times) => Math.min(times * 50, 2000), // Reconnect backoff
        lazyConnect: true // Don't crash if Redis is down initially
    });

    let lastRedisError = 0;
    const REDIS_ERROR_THROTTLE = 60000; // Log redis error at most once per minute

    redis.on("error", (err) => {
        const now = Date.now();
        if (now - lastRedisError > REDIS_ERROR_THROTTLE) {
            logger.error("Redis connection error (throttled)", { error: err.message });
            lastRedisError = now;
        }
    });

    // Connect explicitly to catch initial errors without crashing
    redis.connect().catch(err => {
        logger.error("Could not connect to Redis", { error: err.message });
    });

    // --- Distributed Edge Sync ---
    const sub = redis.duplicate();
    sub.on("error", () => { }); // Silence errors for subscriber
    sub.connect().then(() => {
        sub.subscribe("Continuum:purge", "Continuum:config_update");
        sub.on("message", (channel, message) => {
            try {
                const data = JSON.parse(message);
                if (channel === "Continuum:purge") {
                    logger.info("Distributed Purge Received", { path: data.path, domain: data.domain });
                    purgeCache(data.path, data.domain, true);
                } else if (channel === "Continuum:config_update") {
                    logger.info("Distributed Domain Update Received", { hostname: data.hostname });
                    domainManager.loadFromRedis();
                }
            } catch (e) { }
        });
    }).catch(() => { });
}

const rateLimitMap = new Map(); // IP -> { count, windowStart }

if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function getCacheKey(req, hostname) {
    return crypto
        .createHash("sha256")
        .update(`${hostname}${req.url}`)
        .digest("hex");
}

async function checkRateLimit(req) {
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    const windowMs = config.rateLimit.windowMs;
    const max = config.rateLimit.max;

    if (redis && redis.status === 'ready') {
        const key = `ratelimit:${ip}`;
        try {
            const count = await redis.incr(key);
            if (count === 1) {
                await redis.expire(key, Math.ceil(windowMs / 1000));
            }
            return count <= max;
        } catch (err) {
            logger.error("Redis rate limit error, falling back to local memory", { error: err.message });
        }
    }

    if (!rateLimitMap.has(ip)) {
        rateLimitMap.set(ip, { count: 1, windowStart: now });
        return true;
    }

    const data = rateLimitMap.get(ip);
    if (now - data.windowStart > windowMs) {
        data.count = 1;
        data.windowStart = now;
        return true;
    }

    data.count++;
    return data.count <= max;
}

export async function handleRequest(req, res) {
    const startTime = Date.now();

    // Extract Hostname (remove port if present)
    const hostHeader = req.headers.host || "";
    const hostname = hostHeader.split(":")[0];

    // Get Domain Configuration
    const domainConfig = domainManager.getConfig(hostname);
    const origin = await domainManager.getOrigin(hostname);

    // 0. WAF Check (Security Layer)
    const wafResult = checkWAF(req, domainConfig || {});
    if (wafResult.blocked) {
        logger.warn("WAF Blocked Request", {
            ip: req.socket.remoteAddress,
            url: req.url,
            reason: wafResult.reason,
            hostname
        });
        logRequest("BLOCKED", hostname, req.url, req.socket.remoteAddress);
        res.writeHead(403, { "Content-Type": "text/plain" });
        return res.end(`Forbidden (Continuum WAF): ${wafResult.reason}`);
    }

    if (!(await checkRateLimit(req))) {
        res.writeHead(429, { "Content-Type": "text/plain" });
        return res.end("Too Many Requests (Rate limit exceeded)");
    }

    logger.debug("Routing Decision", { hostname, resolvedOrigin: origin || "null" });

    if (!origin) {
        logger.warn("Unknown host request", { hostname, url: req.url });
        res.writeHead(404, { "Content-Type": "text/html" });
        return res.end(renderLandingPage());
    }

    // --- Edge Logic (Request Phase) ---
    if (domainConfig && domainConfig.edgeRules) {
        for (const rule of domainConfig.edgeRules) {
            const edgeResult = await executeEdgeRule(rule, req, res, 'request');
            if (edgeResult && edgeResult.stop) return; // Script handled response
        }
    }

    const finalOrigin = origin;
    const cacheKey = getCacheKey(req, hostname);
    const cachePath = path.join(CACHE_DIR, cacheKey);
    const metaPath = `${cachePath}.json`;

    // 1. Try Redis Cache (Hot Layer)
    if (redis && redis.status === 'ready') {
        try {
            const [metaRaw, bodyBuffer] = await redis.pipeline()
                .get(`meta:${cacheKey}`)
                .getBuffer(`body:${cacheKey}`)
                .exec();

            if (!metaRaw[0] && metaRaw[1] && !bodyBuffer[0] && bodyBuffer[1]) {
                const meta = JSON.parse(metaRaw[1]);
                logger.info("Cache HIT (Redis)", { hostname, url: req.url });
                logRequest("HIT", hostname, req.url, req.socket.remoteAddress);
                return await sendResponse(req, res, bodyBuffer[1], meta.headers, "HIT-REDIS", hostname);
            }
        } catch (err) {
            logger.error("Redis read error", { error: err.message });
        }
    }

    // 2. Try Disk Cache
    if (fs.existsSync(cachePath) && fs.existsSync(metaPath)) {
        try {
            const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
            if (Date.now() < meta.expiresAt) {
                logger.info("Cache HIT (Disk)", { hostname, url: req.url });
                logRequest("HIT", hostname, req.url, req.socket.remoteAddress);
                const buffer = fs.readFileSync(cachePath);

                if (redis && redis.status === 'ready') {
                    const ttl = Math.ceil((meta.expiresAt - Date.now()) / 1000);
                    if (ttl > 0) {
                        redis.pipeline()
                            .set(`meta:${cacheKey}`, JSON.stringify({ headers: meta.headers }), "EX", ttl)
                            .setBuffer(`body:${cacheKey}`, buffer, "EX", ttl)
                            .exec();
                    }
                }

                return await sendResponse(req, res, buffer, meta.headers, "HIT-DISK", hostname);
            } else {
                logger.debug("Cache Stale", { hostname, url: req.url });
                fs.unlinkSync(cachePath);
                fs.unlinkSync(metaPath);
            }
        } catch (err) {
            logger.error("Cache read error", { error: err.message });
        }
    }

    // 3. Cache MISS - Fetch from Origin
    logger.info("Cache MISS - Fetching origin", { hostname, url: req.url, origin: finalOrigin });
    logRequest("MISS", hostname, req.url, req.socket.remoteAddress);

    const originUrl = new URL(finalOrigin);
    const protocol = originUrl.protocol === "https:" ? https : http;

    const options = {
        hostname: originUrl.hostname,
        port: originUrl.port || (originUrl.protocol === "https:" ? 443 : 80),
        path: req.url,
        method: req.method,
        headers: {
            ...req.headers,
            host: originUrl.hostname
        }
    };

    const proxyReq = protocol.request(options, (proxyRes) => {
        const statusCode = proxyRes.statusCode;
        const headers = { ...proxyRes.headers };
        let ttl = config.defaultTTL;
        const cacheControl = proxyRes.headers["cache-control"];
        if (cacheControl) {
            const match = cacheControl.match(/max-age=(\d+)/);
            if (match) ttl = parseInt(match[1]);
        }
        const expiresAt = Date.now() + ttl * 1000;

        let body = [];
        proxyRes.on("data", chunk => body.push(chunk));
        proxyRes.on("end", async () => {
            const buffer = Buffer.concat(body);
            logBandwidth(buffer.length, hostname, req.url, req.socket.remoteAddress);

            if (req.method === "GET" && statusCode === 200) {
                fs.writeFileSync(cachePath, buffer);
                const meta = {
                    url: req.url,
                    headers: headers,
                    expiresAt: expiresAt,
                    createdAt: Date.now()
                };
                fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

                if (redis && redis.status === 'ready') {
                    redis.pipeline()
                        .set(`meta:${cacheKey}`, JSON.stringify({ headers: headers }), "EX", ttl)
                        .setBuffer(`body:${cacheKey}`, buffer, "EX", ttl)
                        .exec().catch(err => logger.error("Redis write error", { error: err.message }));
                }
            }

            await sendResponse(req, res, buffer, headers, "MISS", hostname);
        });
    });

    proxyReq.on("error", (err) => {
        logger.error("Proxy request error", { error: err.message, origin: finalOrigin });
        logRequest("ERROR", hostname, req.url, req.socket.remoteAddress);
        res.writeHead(502);
        res.end("Bad Gateway");
    });

    req.pipe(proxyReq);
}

async function sendResponse(req, res, buffer, headers, cacheStatus, hostname = 'unknown') {
    let responseHeaders = {
        ...headers,
        "X-Cache": cacheStatus,
        "X-Continuum-Worker": process.pid
    };

    const url = new URL(req.url, `http://${req.headers.host}`);
    const w = url.searchParams.get("w") || url.searchParams.get("width");
    const h = url.searchParams.get("h") || url.searchParams.get("height");
    const q = url.searchParams.get("q") || url.searchParams.get("quality");
    const f = url.searchParams.get("f") || url.searchParams.get("format");

    const contentType = (headers["content-type"] || "").toLowerCase();
    const isImage = contentType.startsWith("image/") || req.url.match(/\.(jpg|jpeg|png|webp|avif)$/i);

    if (isImage && (w || h || q || f || contentType.startsWith("image/"))) {
        logger.info("Optimizing image on-the-fly", { url: req.url, w, h, q, f });
        const optimized = await optimizeImage(buffer, {
            width: w, height: h, quality: q, format: f,
            accept: req.headers["accept"]
        });
        if (optimized.buffer) {
            buffer = optimized.buffer;
            if (optimized.contentType) {
                responseHeaders["content-type"] = optimized.contentType;
            }
            responseHeaders["X-Continuum-Optimized"] = "true";
        }
    }

    const acceptEncoding = req.headers["accept-encoding"] || "";

    const send = (data, encoding) => {
        if (encoding) responseHeaders["content-encoding"] = encoding;
        delete responseHeaders["content-length"];
        res.writeHead(200, responseHeaders);
        res.end(data);
        logBandwidth(data.length, hostname, req.url, req.socket.remoteAddress);
    };

    if (config.compression && buffer.length > 128) {
        if (acceptEncoding.includes("br")) {
            zlib.brotliCompress(buffer, (err, compressed) => {
                if (!err) send(compressed, "br");
                else send(buffer, null);
            });
            return;
        } else if (acceptEncoding.includes("gzip")) {
            zlib.gzip(buffer, (err, compressed) => {
                if (!err) send(compressed, "gzip");
                else send(buffer, null);
            });
            return;
        } else if (acceptEncoding.includes("deflate")) {
            zlib.deflate(buffer, (err, compressed) => {
                if (!err) send(compressed, "deflate");
                else send(buffer, null);
            });
            return;
        }
    }

    send(buffer, null);
}

export function purgeCache(pathOrUrl, domain, localOnly = false) {
    if (!localOnly && redis && redis.status === 'ready') {
        redis.publish("Continuum:purge", JSON.stringify({ path: pathOrUrl, domain }));
    }

    if (pathOrUrl === "all") {
        const files = fs.readdirSync(CACHE_DIR);
        files.forEach(file => {
            try { fs.unlinkSync(path.join(CACHE_DIR, file)); } catch (e) { }
        });

        if (redis) {
            redis.flushdb().catch(console.error);
        }
        return { success: true, count: files.length };
    }

    let hostname = domain;
    let resourcePath = pathOrUrl;

    try {
        if (pathOrUrl.startsWith("http")) {
            const u = new URL(pathOrUrl);
            if (!hostname) hostname = u.hostname;
            resourcePath = u.pathname + u.search;
        }
    } catch (e) { }

    if (!hostname) {
        return { success: false, error: "Domain or full URL is required to purge specific cache item." };
    }

    const cacheKey = crypto.createHash("sha256").update(`${hostname}${resourcePath}`).digest("hex");
    const cachePath = path.join(CACHE_DIR, cacheKey);
    const metaPath = `${cachePath}.json`;

    let count = 0;
    if (fs.existsSync(cachePath)) { try { fs.unlinkSync(cachePath); count++; } catch (e) { } }
    if (fs.existsSync(metaPath)) { try { fs.unlinkSync(metaPath); count++; } catch (e) { } }

    if (redis) {
        redis.del(`meta:${cacheKey}`, `body:${cacheKey}`);
    }

    return { success: count > 0, count };
}

export async function cleanupExpiredCache() {
    console.log("🧹 Running cache garbage collection...");
    const files = fs.readdirSync(CACHE_DIR);
    let deletedCount = 0;

    for (const file of files) {
        if (file.endsWith(".json")) {
            const metaPath = path.join(CACHE_DIR, file);
            const cachePath = metaPath.replace(".json", "");

            try {
                const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
                if (Date.now() > meta.expiresAt) {
                    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
                    fs.unlinkSync(metaPath);
                    deletedCount++;
                }
            } catch (err) {
                if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
                fs.unlinkSync(metaPath);
                deletedCount++;
            }
        }
    }

    if (deletedCount > 0) {
        console.log(`✅ Garbage collection complete. Removed ${deletedCount} stale items.`);
    }
}
