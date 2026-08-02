// ============================================================
// PER-USER STORAGE
//
// History belongs to the PERSON (their Spotify account), not the browser — so
// it must live server-side, keyed by Spotify user id. Then a user sees the same
// history on laptop, phone, anywhere they log in.
//
// Backend: Upstash Redis over its REST API (free tier, no credit card, no npm
// dependency — plain HTTPS). If the two Upstash env vars aren't set (e.g. local
// dev), we transparently fall back to a JSON file on disk so nothing is blocked.
//
// Keys look like:  history:<spotifyUserId>  ->  JSON array of rating objects
// ============================================================
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const USING_UPSTASH = !!(URL && TOKEN);

// --- local-file fallback (dev only) ---
const LOCAL_FILE = path.join(__dirname, '.data', 'history.json');
function readLocalAll() {
    try { return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch { return {}; }
}
function writeLocalAll(obj) {
    fs.mkdirSync(path.dirname(LOCAL_FILE), { recursive: true });
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(obj));
}

// --- Upstash REST helpers ---
async function upstash(command) {
    // Upstash accepts a command as a JSON array of args, POSTed to the base URL
    const res = await fetch(URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
    });
    if (!res.ok) throw new Error(`Upstash ${res.status}`);
    const data = await res.json();
    return data.result;
}

const keyFor = userId => `history:${userId}`;

// Get a user's history array (empty array if none / not found)
async function getHistory(userId) {
    if (!userId) return [];
    if (USING_UPSTASH) {
        const raw = await upstash(['GET', keyFor(userId)]);
        if (!raw) return [];
        try { return JSON.parse(raw); } catch { return []; }
    }
    const all = readLocalAll();
    return all[userId] || [];
}

// Replace a user's history with the given array
async function setHistory(userId, history) {
    if (!userId) return false;
    const arr = Array.isArray(history) ? history : [];
    if (USING_UPSTASH) {
        await upstash(['SET', keyFor(userId), JSON.stringify(arr)]);
        return true;
    }
    const all = readLocalAll();
    all[userId] = arr;
    writeLocalAll(all);
    return true;
}

module.exports = { getHistory, setHistory, USING_UPSTASH };
