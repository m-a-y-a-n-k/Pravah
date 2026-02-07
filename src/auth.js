import crypto from 'crypto';
import nodemailer from 'nodemailer';
import cookie from 'cookie';
import Redis from "ioredis";
import { config } from "./config.js";

// Redis for Session/OTP (Cluster Support)
let redis = null;
if (config.redis.enabled) {
    redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        lazyConnect: true
    });
    // connection errors handled by ioredis auto-reconnect or silent fail in logic
}

// Fallback In-Memory Storage (Only works if single worker)
const otpStore = new Map(); // email -> { otp, expires }
const sessionStore = new Map(); // sessionId -> { email, expires }

const SESSION_TTL = 24 * 60 * 60; // Seconds
const OTP_TTL = 5 * 60; // Seconds

// Email Transporter (Mock or Real)
let transporter = null;
if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
}

// 1. Check if Request is Authenticated
export async function checkAuth(req) {
    const cookies = cookie.parse(req.headers.cookie || '');
    const sessionId = cookies['pravah_session'];

    if (!sessionId) return false;

    if (redis && redis.status === 'ready') {
        const session = await redis.get(`session:${sessionId}`);
        return !!session;
    } else {
        if (!sessionStore.has(sessionId)) return false;
        const session = sessionStore.get(sessionId);
        if (Date.now() > session.expires) {
            sessionStore.delete(sessionId);
            return false;
        }
        return true;
    }
}

// 2. Redirect to Login Page
export function requireAuth(req, res) {
    res.writeHead(302, { 'Location': '/login' });
    res.end();
}

// 3. Send OTP
export async function sendLoginOTP(req, res) {
    let body = "";
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { email } = JSON.parse(body);
            if (!email) throw new Error("Email required");

            // Generate 6-digit OTP
            const otp = crypto.randomInt(100000, 999999).toString();

            if (redis && redis.status === 'ready') {
                await redis.set(`otp:${email}`, otp, "EX", OTP_TTL);
            } else {
                otpStore.set(email, { otp, expires: Date.now() + (OTP_TTL * 1000) });
            }

            const message = `Your Pravah Admin Login Code is: ${otp}`;

            // Send Email
            if (transporter) {
                await transporter.sendMail({
                    from: '"Pravah Admin" <noreply@pravah.dev>',
                    to: email,
                    subject: 'Admin Login Code',
                    text: message
                });
                console.log(`📧 Email sent to ${email}`);
            } else {
                // Fallback: Log to console for dev
                console.log(`\n🔑 [DEV MODE] OTP for ${email}: ${otp}\n`);
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true, msg: "OTP Sent" }));
        } catch (e) {
            res.writeHead(400);
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
    });
}

// 4. Verify OTP & Set Cookie
export function verifyLoginOTP(req, res) {
    let body = "";
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
        try {
            const { email, otp } = JSON.parse(body);
            let isValid = false;

            if (redis && redis.status === 'ready') {
                const storedOtp = await redis.get(`otp:${email}`);
                if (storedOtp && storedOtp === otp) {
                    isValid = true;
                    await redis.del(`otp:${email}`);
                }
            } else {
                const stored = otpStore.get(email);
                if (stored && Date.now() < stored.expires && stored.otp === otp) {
                    isValid = true;
                    otpStore.delete(email);
                }
            }

            if (!isValid) throw new Error("Invalid or expired OTP");

            // Success: Create Session
            const sessionId = crypto.randomUUID();

            if (redis && redis.status === 'ready') {
                await redis.set(`session:${sessionId}`, email, "EX", SESSION_TTL);
            } else {
                sessionStore.set(sessionId, { email, expires: Date.now() + (SESSION_TTL * 1000) });
            }

            // Set HttpOnly Cookie
            const setCookie = cookie.serialize('pravah_session', sessionId, {
                httpOnly: true,
                maxAge: SESSION_TTL,
                path: '/',
                sameSite: 'strict',
            });

            res.writeHead(200, {
                'Set-Cookie': setCookie,
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({ success: true }));

        } catch (e) {
            res.writeHead(401);
            res.end(JSON.stringify({ success: false, error: e.message }));
        }
    });
}

// 5. Placeholder Google OAuth Start
export function startGoogleLogin(req, res) {
    // In a real app, you'd construct the Google Auth URL with client_id, redirect_uri, scopes etc.
    const googleAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=YOUR_CLIENT_ID&redirect_uri=http://${req.headers.host}/auth/google/callback&response_type=code&scope=email%20profile`;

    // Redirect user to Google
    // res.writeHead(302, { Location: googleAuthUrl });
    // res.end();

    // Since we don't have keys, show an error page for now
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>Google Login Not Configured</h1><p>Please add Client ID to .env</p><a href="/login">Back</a>`);
}
