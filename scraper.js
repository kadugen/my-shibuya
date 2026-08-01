const fetch = require('node-fetch');
const cheerio = require('cheerio');
const { genresForEvent } = require('./genres');
const { attributesForAlbum } = require('./attributes');
const { deriveAxes } = require('./axes');

const SITE = 'https://www.shibuyahifi.com';
const SCHEDULE_URL = `${SITE}/hifi-schedule`;
const EVENTS_APP_ID = '140603ad-af8d-84a5-2c80-a0f60cb47351'; // Wix Events app
// The calendar lazy-loads past the first ~20 events ("Load More"), so parsing
// the page's warmup blob only gets us the first couple of weeks. Instead we call
// the same API the widget uses, which returns ALL scheduled events at once.
const EVENTS_API = `${SITE}/_api/wix-events-web/v1/events`;
const TOKENS_API = `${SITE}/_api/v1/access-tokens`;
// This fieldset combination returns descriptions, images, and registration
// status (a bare request omits them). status: OPEN_TICKETS | CLOSED (sold out).
// limit is capped at 100 by the API (200 => HTTP 400), so we page through in
// 100s. This fieldset combination returns descriptions, images, and
// registration status (a bare request omits them).
const EVENTS_PAGE_SIZE = 100;
const EVENTS_FIELDSETS = '&fieldset=DETAILS&fieldset=TEXTS&fieldset=REGISTRATION';
const STATUS_SOLD_OUT = 'CLOSED';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

// Wix mints a short-lived per-app "instance" token; the events API needs the
// one scoped to the Events app. Fetch a fresh one from the site's token endpoint.
async function getEventsInstanceToken() {
    const res = await fetch(TOKENS_API, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.apps?.[EVENTS_APP_ID]?.instance || null;
}

// "Artist - Album" title -> { artist, album }. Handles the site's inconsistent
// separators: " - ", a hyphen with a space on only one side ("Artist- Album",
// "Artist -Album"), and comma ("Nirvana, In Utero"). Self-titled albums with no
// separator (e.g. "Audioslave", "Van Halen") keep artist === album.
function splitTitle(title) {
    const t = (title || '').replace(/\s+/g, ' ').trim();

    // Prefer a hyphen separator (with a space on at least one side)
    let m = t.match(/^(.*?)\s*-\s+(.+)$/) || t.match(/^(.*?)\s+-\s*(.+)$/);
    // Otherwise fall back to the first comma
    if (!m) m = t.match(/^([^,]+),\s*(.+)$/);

    if (m && m[1].trim() && m[2].trim()) {
        return { artist: m[1].trim(), album: m[2].trim() };
    }
    return { artist: t, album: t };
}

// Description on the site ends with "Hosted by X"; split that out
function splitHost(description) {
    const desc = (description || '').replace(/\s+/g, ' ').trim();
    const m = desc.match(/Hosted by\s+(.+?)\s*$/i);
    if (m) {
        return { description: desc.slice(0, m.index).trim(), host: m[1].trim() };
    }
    return { description: desc, host: 'Shibuya Hi-Fi' };
}

function mapEvent(ev) {
    const { artist, album } = splitTitle(ev.title);
    const { description, host } = splitHost(ev.description || ev.about);

    const sched = ev.scheduling || {};
    // Use the site's own localized date string (e.g. "July 29, 2026") rather
    // than the UTC startDate — evening Pacific shows are stored as next-day UTC,
    // so toISOString() would shift them a day forward.
    let date = null;
    if (sched.startDateFormatted) {
        const d = new Date(sched.startDateFormatted);
        if (!isNaN(d)) {
            date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
    }
    const time = (sched.startTimeFormatted && sched.endTimeFormatted)
        ? `${sched.startTimeFormatted} – ${sched.endTimeFormatted}`
        : (sched.startTimeFormatted || null);

    const image = ev.mainImage?.url || null;
    const soldOut = ev.registration?.status === STATUS_SOLD_OUT;
    const url = `${SITE}/event-details/${ev.slug}`;
    const genres = genresForEvent(artist, album);
    const attributes = attributesForAlbum(artist, album, genres);

    return {
        artist,
        title: album,
        date,
        time,
        description,
        host,
        image,
        url,
        soldOut,
        genres,
        attributes,
        axes: deriveAxes(attributes, genres),
    };
}

// Primary path: fetch every scheduled event from the Wix Events API, paging
// through in EVENTS_PAGE_SIZE chunks until we've collected all of them.
async function fetchFromApi() {
    const token = await getEventsInstanceToken();
    if (!token) return null;

    const headers = {
        Authorization: token,
        Accept: 'application/json',
        'User-Agent': UA,
        Referer: SCHEDULE_URL,
    };

    const all = [];
    for (let offset = 0; ; offset += EVENTS_PAGE_SIZE) {
        const q = `offset=${offset}&limit=${EVENTS_PAGE_SIZE}&status=SCHEDULED${EVENTS_FIELDSETS}`;
        const res = await fetch(`${EVENTS_API}?${q}`, { headers });
        if (!res.ok) break;
        const data = await res.json();
        const batch = data?.events || [];
        all.push(...batch);
        const total = typeof data?.total === 'number' ? data.total : all.length;
        if (batch.length < EVENTS_PAGE_SIZE || all.length >= total) break;
    }

    return all.length ? all : null;
}

// ---- Fallback: parse the warmup blob from the page (first page of events only) ----

function findEvents(node, out = []) {
    if (Array.isArray(node)) {
        for (const item of node) findEvents(item, out);
    } else if (node && typeof node === 'object') {
        if (node.slug && node.scheduling && node.title) out.push(node);
        else for (const key of Object.keys(node)) findEvents(node[key], out);
    }
    return out;
}

async function fetchFromWarmup() {
    const res = await fetch(SCHEDULE_URL, { headers: { 'User-Agent': UA } });
    const html = await res.text();
    const $ = cheerio.load(html);
    let parsed = null;
    $('script').each((_, el) => {
        if (parsed) return;
        const txt = $(el).contents().text();
        if (!txt || !txt.includes('"slug"') || !txt.includes('"scheduling"')) return;
        const start = txt.indexOf('{');
        if (start === -1) return;
        try { parsed = JSON.parse(txt.slice(start)); } catch { /* not this script */ }
    });
    return parsed ? findEvents(parsed) : [];
}

async function scrapeSchedule() {
    let raw = null;
    try {
        raw = await fetchFromApi();
    } catch (err) {
        console.error('Events API failed, falling back to warmup:', err.message);
    }
    if (!raw || raw.length === 0) {
        raw = await fetchFromWarmup();
    }

    // Dedupe by slug, map, sort by date ascending
    const seen = new Set();
    const events = [];
    for (const ev of raw) {
        if (!ev.slug || seen.has(ev.slug)) continue;
        seen.add(ev.slug);
        events.push(mapEvent(ev));
    }

    events.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    return events;
}

module.exports = { scrapeSchedule };
