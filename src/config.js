export const config = {
    port: process.env.PORT || 5000,
    domains: {
        // No default proxying to allow system landing pages
    },
    cacheDir: "./cache-data",
    defaultTTL: 3600,
    compression: true,
    cluster: true,
    maxWorkers: 4, // or os.cpus().length
    rateLimit: {
        windowMs: 15 * 60 * 1000,
        max: 100
    },
    redis: {
        enabled: true,
        host: process.env.REDIS_HOST || "localhost",
        port: process.env.REDIS_PORT || 6379,
    },
    analyticsEnabled: true
};
