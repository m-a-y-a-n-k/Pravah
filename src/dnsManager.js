import dns from "dns/promises";
import { logger } from "./logger.js";

/**
 * DNS Manager for Continuum
 * Handles verification of customer DNS records.
 */
export const dnsManager = {
    /**
     * Verifies if a hostname's CNAME points to the CDN's entry point.
     * @param {string} hostname - The customer's domain (e.g., blog.customer.com)
     * @param {string} targetHost - Your CDN's entry point (e.g., edge.continuum-cdn.com)
     */
    async verifyCNAME(hostname, targetHost) {
        try {
            const records = await dns.resolveCname(hostname);
            const isPointed = records.some(record => record.toLowerCase() === targetHost.toLowerCase());

            if (isPointed) {
                logger.info("DNS Verification SUCCESS", { hostname, targetHost });
                return { success: true, records };
            } else {
                logger.warn("DNS Verification FAILED: CNAME mismatch", { hostname, found: records, expected: targetHost });
                return { success: false, error: "CNAME points to elsewhere", found: records };
            }
        } catch (err) {
            logger.error("DNS Verification ERROR", { hostname, error: err.message });
            return { success: false, error: err.code === 'ENOTFOUND' ? "Domain not found" : err.message };
        }
    },

    /**
     * Checks the A/AAAA records of a hostname.
     */
    async getIPs(hostname) {
        try {
            const ips = await dns.resolve(hostname);
            return ips;
        } catch (e) {
            return [];
        }
    }
};
