import fs from "fs";
import path from "path";

const ANALYTICS_FILE = "./analytics.json";
const HISTORY_LIMIT = 60; // Keep last 60 data points (e.g., minutes)

let stats = {
    totalRequests: 0,
    hits: 0,
    misses: 0,
    errors: 0,
    blocked: 0,
    bandwidth: 0,
    lastUpdate: Date.now(),
    history: [], // [{ timestamp, hits, misses, errors, bandwidth }]
    domains: {},
    regions: {}, // { countryCode: count }
    urlStats: {} // { url: { total, hits, misses, blocked, bandwidth, regions: {} } }
};

// Mock Geo-IP Lookup
function lookupGeo(ip) {
    if (!ip || ip === '127.0.0.1' || ip === '::1') return { country: 'US', region: 'Local' };
    
    // Simple mock logic: first octet maps to a region
    const firstPart = parseInt(ip.split('.')[0]);
    if (isNaN(firstPart)) return { country: 'GB', region: 'Europe' };

    if (firstPart < 64) return { country: 'US', region: 'North America' };
    if (firstPart < 128) return { country: 'DE', region: 'Europe' };
    if (firstPart < 192) return { country: 'IN', region: 'Asia' };
    if (firstPart < 224) return { country: 'SG', region: 'Asia' };
    return { country: 'BR', region: 'South America' };
}

// Load existing stats if any
if (fs.existsSync(ANALYTICS_FILE)) {
    try {
        stats = JSON.parse(fs.readFileSync(ANALYTICS_FILE, "utf-8"));
        if (!stats.domains) stats.domains = {};
        if (!stats.history) stats.history = [];
        if (!stats.regions) stats.regions = {};
        if (!stats.urlStats) stats.urlStats = {};
        if (stats.blocked === undefined) stats.blocked = 0;
    } catch (e) {
        console.error("Failed to load analytics:", e);
    }
}

function initDomainStats(hostname) {
    if (!stats.domains[hostname]) {
        stats.domains[hostname] = {
            totalRequests: 0,
            hits: 0,
            misses: 0,
            errors: 0,
            blocked: 0,
            bandwidth: 0
        };
    }
}

function initUrlStats(url) {
    if (!stats.urlStats[url]) {
        stats.urlStats[url] = {
            total: 0,
            hits: 0,
            misses: 0,
            errors: 0,
            blocked: 0,
            bandwidth: 0,
            regions: {}
        };
    }
}

function updateHistory(type, bytes = 0) {
    const now = Math.floor(Date.now() / 60000) * 60000; // Minute bucket
    let currentPoint = stats.history.find(p => p.timestamp === now);

    if (!currentPoint) {
        currentPoint = { timestamp: now, hits: 0, misses: 0, errors: 0, blocked: 0, bandwidth: 0 };
        stats.history.push(currentPoint);
        if (stats.history.length > HISTORY_LIMIT) {
            stats.history.shift();
        }
    }

    if (type === "HIT") currentPoint.hits++;
    else if (type === "MISS") currentPoint.misses++;
    else if (type === "ERROR") currentPoint.errors++;
    else if (type === "BLOCKED") currentPoint.blocked++;

    currentPoint.bandwidth += bytes;
}

export function logRequest(type, hostname = 'unknown', url = '/', ip = '127.0.0.1') {
    stats.totalRequests++;

    const geo = lookupGeo(ip);
    const country = geo.country;

    // Global Regions
    stats.regions[country] = (stats.regions[country] || 0) + 1;

    // Type counts
    if (type === "HIT") stats.hits++;
    else if (type === "MISS") stats.misses++;
    else if (type === "ERROR") stats.errors++;
    else if (type === "BLOCKED") stats.blocked++;

    // Domain stats
    initDomainStats(hostname);
    stats.domains[hostname].totalRequests++;
    if (type === "HIT") stats.domains[hostname].hits++;
    else if (type === "MISS") stats.domains[hostname].misses++;
    else if (type === "ERROR") stats.domains[hostname].errors++;
    else if (type === "BLOCKED") stats.domains[hostname].blocked++;

    // URL stats
    initUrlStats(url);
    const u = stats.urlStats[url];
    u.total++;
    if (type === "HIT") u.hits++;
    else if (type === "MISS") u.misses++;
    else if (type === "ERROR") u.errors++;
    else if (type === "BLOCKED") u.blocked++;
    u.regions[country] = (u.regions[country] || 0) + 1;

    updateHistory(type);
    saveStats();
}

export function logBandwidth(bytes, hostname = 'unknown', url = '/', ip = '127.0.0.1') {
    stats.bandwidth += bytes;
    
    initDomainStats(hostname);
    stats.domains[hostname].bandwidth += bytes;

    initUrlStats(url);
    stats.urlStats[url].bandwidth += bytes;

    updateHistory(null, bytes);
    saveStats();
}

export function saveStats() {
    stats.lastUpdate = Date.now();
    try {
        fs.writeFileSync(ANALYTICS_FILE, JSON.stringify(stats, null, 2));
    } catch (e) { }
}

export function getStats() {
    return stats;
}

