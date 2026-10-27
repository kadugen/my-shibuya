// ============================================================
// SEATTLE-AREA CONCERTS
//
// Pulls every music event in the Seattle area (plus the Gorge) from Ticketmaster
// and, optionally, SeatGeek — then the server matches them against each
// visitor's followed Spotify artists. Pulling the whole area once and matching
// locally is far cheaper than one API call per followed artist, and the pull is
// shared by every user.
//
// Both sources need a FREE key (set as env vars; either one is enough):
//   TICKETMASTER_API_KEY  — https://developer.ticketmaster.com (instant, 5000 calls/day)
//   SEATGEEK_CLIENT_ID    — https://seatgeek.com/account/develop (adds AXS/indie venues)
//
// Results are cached in memory for CACHE_MS. Free Render instances sleep when
// idle, so the first visit after a wake re-pulls (~10–20s).
// ============================================================
const fetch = require('node-fetch');

const TM_KEY = process.env.TICKETMASTER_API_KEY;
const SG_ID = process.env.SEATGEEK_CLIENT_ID;
const MONTHS_AHEAD = parseInt(process.env.CONCERT_MONTHS) || 12;
const CACHE_MS = 6 * 60 * 60 * 1000;

// Seattle metro (Tacoma → Everett, incl. White River / Tulalip) + the Gorge
const AREAS = [
    { name: 'Seattle area', lat: 47.6062, lon: -122.3321, radiusMi: 60 },
    { name: 'The Gorge', lat: 47.1009, lon: -119.9967, radiusMi: 10 },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const tmDate = d => d.toISOString().replace(/\.\d{3}Z$/, 'Z'); // TM rejects milliseconds

// Normalize an artist/performer name for matching:
// "Beyoncé" → "beyonce", "The War & Treaty" → "war and treaty"
function normName(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .replace(/&/g, ' and ').replace(/^the\s+/, '')
        .replace(/[^a-z0-9]+/g, ' ').trim();
}

// Ticket add-ons that show up as their own "events"
const JUNK_RE = /\b(parking|vip|packages?|upgrades?|add-?ons?|suites?|souvenir|hospitality)\b/i;

// ---------------- Ticketmaster ----------------
async function tmPage(area, start, end, page) {
    const params = new URLSearchParams({
        apikey: TM_KEY, latlong: `${area.lat},${area.lon}`, radius: String(area.radiusMi), unit: 'miles',
        classificationName: 'music', startDateTime: tmDate(start), endDateTime: tmDate(end),
        size: '200', page: String(page), sort: 'date,asc',
    });
    for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch(`https://app.ticketmaster.com/discovery/v2/events.json?${params}`);
        if (res.status === 429) { await sleep(1000 * (attempt + 1)); continue; } // rate limited (5 req/s)
        if (!res.ok) throw new Error(`Ticketmaster ${res.status}`);
        return res.json();
    }
    throw new Error('Ticketmaster rate limit');
}

function slimTM(e) {
    const v = e._embedded?.venues?.[0] || {};
    const performers = (e._embedded?.attractions || []).map(a => a.name).filter(Boolean);
    return {
        source: 'Ticketmaster', title: e.name, url: e.url, performers,
        date: e.dates?.start?.localDate || null, time: e.dates?.start?.localTime || null,
        status: e.dates?.status?.code || null, // onsale | offsale | cancelled | postponed | rescheduled
        venue: v.name || '', city: [v.city?.name, v.state?.stateCode].filter(Boolean).join(', '),
        priceMin: e.priceRanges?.[0]?.min ?? null,
    };
}

// TM caps deep paging at 1000 results per query, so walk the calendar in
// windows and split any window that's too full.
async function tmWindow(area, start, end, out, depth = 0) {
    const first = await tmPage(area, start, end, 0);
    const total = first.page?.totalElements || 0;
    if (total > 1000 && depth < 4) {
        const mid = new Date((start.getTime() + end.getTime()) / 2);
        await tmWindow(area, start, mid, out, depth + 1);
        await tmWindow(area, mid, end, out, depth + 1);
        return;
    }
    (first._embedded?.events || []).forEach(e => out.push(slimTM(e)));
    const pages = Math.min(first.page?.totalPages || 1, 5);
    for (let p = 1; p < pages; p++) {
        await sleep(220);
        const data = await tmPage(area, start, end, p);
        (data._embedded?.events || []).forEach(e => out.push(slimTM(e)));
    }
}

async function fetchTicketmaster(now, horizon) {
    const out = [];
    for (const area of AREAS) {
        // monthly windows keep each query comfortably under the 1000 cap
        for (let s = new Date(now); s < horizon;) {
            const e = new Date(Math.min(new Date(s).setMonth(s.getMonth() + 1), horizon.getTime()));
            await tmWindow(area, s, e, out);
            await sleep(220);
            s = e;
        }
    }
    return out;
}

// ---------------- SeatGeek ----------------
async function fetchSeatGeek(now, horizon) {
    const out = [];
    for (const area of AREAS) {
        for (let page = 1; page <= 40; page++) {
            const params = new URLSearchParams({
                client_id: SG_ID, lat: String(area.lat), lon: String(area.lon), range: `${area.radiusMi}mi`,
                'taxonomies.name': 'concert', 'datetime_utc.gte': now.toISOString().slice(0, 19),
                'datetime_utc.lte': horizon.toISOString().slice(0, 19), per_page: '250', page: String(page),
            });
            const res = await fetch(`https://api.seatgeek.com/2/events?${params}`);
            if (!res.ok) throw new Error(`SeatGeek ${res.status}`);
            const data = await res.json();
            (data.events || []).forEach(e => {
                const [date, time] = (e.datetime_local || '').split('T');
                out.push({
                    source: 'SeatGeek', title: e.title, url: e.url,
                    performers: (e.performers || []).map(p => p.name).filter(Boolean),
                    date: date || null, time: e.time_tbd ? null : (time || null), status: null,
                    venue: e.venue?.name || '', city: [e.venue?.city, e.venue?.state].filter(Boolean).join(', '),
                    priceMin: e.stats?.lowest_price ?? null,
                });
            });
            if (page * 250 >= (data.meta?.total || 0)) break;
            await sleep(200);
        }
    }
    return out;
}

// ---------------- cache ----------------
let cache = null;     // { events, fetchedAt, sources, errors }
let inflight = null;  // shared promise so concurrent visitors trigger one pull

function isConfigured() { return !!(TM_KEY || SG_ID); }

async function getAreaEvents() {
    if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache;
    if (inflight) return inflight;
    inflight = (async () => {
        const now = new Date();
        const horizon = new Date(now); horizon.setMonth(horizon.getMonth() + MONTHS_AHEAD);
        const jobs = [];
        if (TM_KEY) jobs.push(['Ticketmaster', fetchTicketmaster(now, horizon)]);
        if (SG_ID) jobs.push(['SeatGeek', fetchSeatGeek(now, horizon)]);
        const settled = await Promise.allSettled(jobs.map(j => j[1]));
        const events = [], sources = [], errors = [];
        settled.forEach((r, i) => {
            if (r.status === 'fulfilled') { events.push(...r.value); sources.push(jobs[i][0]); }
            else { errors.push(`${jobs[i][0]}: ${r.reason.message}`); console.error('Concert fetch', jobs[i][0], r.reason.message); }
        });
        const fresh = { events: events.filter(e => e.date && !/\bparking\b/i.test(e.title)), fetchedAt: Date.now(), sources, errors };
        // Don't let a total outage overwrite a good cache
        if (sources.length || !cache) cache = fresh;
        return cache;
    })().finally(() => { inflight = null; });
    return inflight;
}

// ---------------- matching ----------------
// followed: Spotify artist objects. Returns one entry per (artist, date), with
// ticket links from every source that lists it.
function matchFollowed(followed, events) {
    const byName = new Map(); // normName -> spotify artist
    followed.forEach(a => { const k = normName(a.name); if (k) byName.set(k, a); });

    const hits = [];
    events.forEach(ev => {
        const names = ev.performers.length ? ev.performers.map(normName) : null;
        const matched = new Set();
        if (names) {
            names.forEach(n => { if (byName.has(n)) matched.add(n); });
        } else {
            // No performer data: fall back to whole-word match in the title, only
            // for distinctive names (avoids "Yes"/"Air" false positives)
            const t = ` ${normName(ev.title)} `;
            byName.forEach((_, n) => { if (n.length >= 6 && t.includes(` ${n} `)) matched.add(n); });
        }
        matched.forEach(n => hits.push({ artist: byName.get(n), ev }));
    });

    // Prefer real shows over add-on listings, and Ticketmaster (primary seller) first
    hits.sort((a, b) => (JUNK_RE.test(a.ev.title) - JUNK_RE.test(b.ev.title))
        || (a.ev.source === 'Ticketmaster' ? -1 : 1) - (b.ev.source === 'Ticketmaster' ? -1 : 1));

    const merged = new Map();
    hits.forEach(({ artist, ev }) => {
        const key = `${artist.id}|${ev.date}`;
        const existing = merged.get(key);
        if (existing) {
            if (!existing.links.some(l => l.source === ev.source)) existing.links.push({ source: ev.source, url: ev.url });
            if (existing.priceMin == null) existing.priceMin = ev.priceMin;
            return;
        }
        const imgs = artist.images || [];
        merged.set(key, {
            artist: artist.name,
            artistImage: (imgs[imgs.length - 2] || imgs[0])?.url || null, // ~320px if available
            spotifyUrl: artist.external_urls?.spotify || null,
            title: ev.title, date: ev.date, time: ev.time, status: ev.status,
            venue: ev.venue, city: ev.city, priceMin: ev.priceMin,
            links: [{ source: ev.source, url: ev.url }],
        });
    });
    return [...merged.values()].sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
}

module.exports = { getAreaEvents, matchFollowed, isConfigured };
