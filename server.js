require('dotenv').config();
const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const crypto = require('crypto');
const { scrapeSchedule } = require('./scraper');
const { AXES } = require('./axes');

const app = express();
const PORT = process.env.PORT || 3000;

// Hosts like Render terminate HTTPS at a proxy; trust it so secure cookies work.
app.set('trust proxy', 1);

const SPOTIFY_SCOPES = 'user-top-read user-read-recently-played user-follow-read user-library-read';
const basicAuthHeader = 'Basic ' + Buffer.from(
    process.env.SPOTIFY_CLIENT_ID + ':' + process.env.SPOTIFY_CLIENT_SECRET
).toString('base64');

// ============================================================
// MULTI-USER SESSIONS
//
// Each visitor's Spotify *refresh token* is stored in a signed, HTTP-only
// cookie — so every person gets their own independent connection, and it
// survives server restarts (the credential lives in their browser, not in
// server memory). Short-lived access tokens are cached in memory per refresh
// token and renewed on demand. Shibuya rating history is already per-device
// (browser localStorage), so it's naturally per-user too.
// ============================================================
const COOKIE_NAME = 'shibuya_rt';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'dev-insecure-secret-change-me';
const IS_PROD = process.env.NODE_ENV === 'production';

// access-token cache: refreshToken -> { access_token, expires_at }
const accessCache = new Map();

// --- tiny signed-cookie helpers (HMAC, no external deps) ---
function sign(value) {
    const mac = crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('base64url');
    return `${value}.${mac}`;
}
function unsign(signed) {
    if (!signed) return null;
    const i = signed.lastIndexOf('.');
    if (i < 0) return null;
    const value = signed.slice(0, i);
    const mac = signed.slice(i + 1);
    const expected = crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('base64url');
    if (mac.length !== expected.length) return null;
    try {
        if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    } catch { return null; }
    return value;
}
function getCookie(req, name) {
    const header = req.headers.cookie;
    if (!header) return null;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx < 0) continue;
        if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
    }
    return null;
}
function setAuthCookie(res, refreshToken) {
    res.cookie(COOKIE_NAME, sign(refreshToken), {
        httpOnly: true,
        secure: IS_PROD,          // HTTPS-only in production
        sameSite: 'lax',          // sent on the top-level OAuth redirect back to us
        maxAge: 1000 * 60 * 60 * 24 * 365, // ~1 year
        path: '/',
    });
}

async function requestToken(bodyParams) {
    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Authorization': basicAuthHeader,
        },
        body: new URLSearchParams(bodyParams),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data;
}

// Middleware: resolve the current visitor's Spotify access token (if any) from
// their cookie, refreshing as needed, and attach it to the request.
async function attachSpotify(req, res, next) {
    req.spotifyAccessToken = null;
    let refreshToken = unsign(getCookie(req, COOKIE_NAME));
    req.spotifyRefreshToken = refreshToken;
    if (!refreshToken) return next();

    const cached = accessCache.get(refreshToken);
    if (cached && Date.now() < cached.expires_at - 60000) {
        req.spotifyAccessToken = cached.access_token;
        return next();
    }

    try {
        const data = await requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
        const entry = { access_token: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
        accessCache.set(refreshToken, entry);
        req.spotifyAccessToken = data.access_token;
        // Spotify occasionally rotates the refresh token — persist the new one
        if (data.refresh_token && data.refresh_token !== refreshToken) {
            accessCache.delete(refreshToken);
            accessCache.set(data.refresh_token, entry);
            setAuthCookie(res, data.refresh_token);
            req.spotifyRefreshToken = data.refresh_token;
        }
    } catch (err) {
        // Invalid/revoked refresh token — treat as logged out and clear it
        console.error('Token refresh failed:', err.message);
        res.clearCookie(COOKIE_NAME, { path: '/' });
    }
    next();
}

// Per-request Spotify fetch, scoped to the visitor's access token
async function spotifyFetch(req, endpoint) {
    if (!req.spotifyAccessToken) return null;
    const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
        headers: { 'Authorization': `Bearer ${req.spotifyAccessToken}` },
    });
    if (!response.ok) return null;
    return response.json();
}

// Serve static frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(attachSpotify);

// ============================================================
// SPOTIFY AUTH
// ============================================================

app.get('/login', (req, res) => {
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.SPOTIFY_CLIENT_ID,
        scope: SPOTIFY_SCOPES,
        redirect_uri: process.env.REDIRECT_URI,
    });
    res.redirect(`https://accounts.spotify.com/authorize?${params}`);
});

app.get('/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.redirect('/?error=' + error);

    try {
        const data = await requestToken({
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.REDIRECT_URI,
        });
        // Establish this visitor's session by storing their refresh token
        if (data.refresh_token) setAuthCookie(res, data.refresh_token);
        res.redirect('/');
    } catch (err) {
        console.error('Auth error:', err);
        res.redirect('/?error=auth_failed');
    }
});

// ============================================================
// API ROUTES
// ============================================================

// Check auth status + user info
app.get('/api/status', async (req, res) => {
    if (!req.spotifyRefreshToken) return res.json({ authenticated: false });
    // Fetch user profile for avatar
    const me = await spotifyFetch(req, '/me');
    if (!me) return res.json({ authenticated: false });
    res.json({
        authenticated: true,
        user: { name: me.display_name, image: me.images?.[0]?.url || null },
    });
});

// Logout — clear this visitor's session only
app.post('/api/logout', (req, res) => {
    if (req.spotifyRefreshToken) accessCache.delete(req.spotifyRefreshToken);
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ ok: true });
});

// Fetch all pages of a paginated Spotify endpoint (items + next), up to a cap
async function spotifyFetchAll(req, endpoint, cap = 200) {
    let url = endpoint;
    const items = [];
    while (url && items.length < cap) {
        const data = await spotifyFetch(req, url);
        if (!data) break;
        const batch = data.items || [];
        items.push(...batch);
        // `next` is a full URL; strip the API prefix so spotifyFetch can reuse it
        url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
    return items.slice(0, cap);
}

// Follow endpoint uses cursor pagination under an `artists` envelope
async function fetchFollowedArtists(req, cap = 200) {
    let url = '/me/following?type=artist&limit=50';
    const items = [];
    while (url && items.length < cap) {
        const data = await spotifyFetch(req, url);
        const block = data?.artists;
        if (!block) break;
        items.push(...(block.items || []));
        url = block.next ? block.next.replace('https://api.spotify.com/v1', '') : null;
    }
    return items;
}

// Get user's taste profile from Spotify.
// Returns rich, per-artist / per-genre signals so the client can apply the
// 40 (artist) / 20 (album) / 40 (genre) scoring rubric.
app.get('/api/profile', async (req, res) => {
    try {
        const [
            topArtistsShort, topArtistsMedium, topArtistsLong,
            topTracksShort, topTracksMedium, topTracksLong,
            recentlyPlayed, followed, savedTracks, savedAlbums,
        ] = await Promise.all([
            spotifyFetch(req, '/me/top/artists?limit=50&time_range=short_term'),
            spotifyFetch(req, '/me/top/artists?limit=50&time_range=medium_term'),
            spotifyFetch(req, '/me/top/artists?limit=50&time_range=long_term'),
            spotifyFetch(req, '/me/top/tracks?limit=50&time_range=short_term'),
            spotifyFetch(req, '/me/top/tracks?limit=50&time_range=medium_term'),
            spotifyFetch(req, '/me/top/tracks?limit=50&time_range=long_term'),
            spotifyFetch(req, '/me/player/recently-played?limit=50'),
            fetchFollowedArtists(req),
            spotifyFetchAll(req, '/me/tracks?limit=50', 200),
            spotifyFetchAll(req, '/me/albums?limit=50', 200),
        ]);

        if (!topArtistsLong && !topArtistsMedium) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        const lc = s => (s || '').toLowerCase().trim();

        // ---- Artist affinity: rank-weighted "share of listening" proxy ----
        // Spotify exposes no play counts or listening time, so we approximate
        // heavy rotation from top-artist rank, weighting the long-term (~1yr,
        // the closest window to "3 years") window most.
        const WINDOW_WEIGHT = { long: 1.0, medium: 0.6, short: 0.35 };
        const rankWeight = i => 50 - i; // rank 0 -> 50, rank 49 -> 1

        const artists = {}; // key: lc(name) -> aggregate signal object
        const ensureArtist = (name, genres) => {
            const k = lc(name);
            if (!artists[k]) artists[k] = { name, genres: genres || [], weight: 0, followed: false, saveCount: 0, topRank: null };
            if (genres && genres.length && !artists[k].genres.length) artists[k].genres = genres;
            return artists[k];
        };

        const genreWeights = {}; // estimated share source
        const addWindow = (list, wKey) => {
            (list?.items || []).forEach((a, i) => {
                const entry = ensureArtist(a.name, a.genres);
                const w = rankWeight(i) * WINDOW_WEIGHT[wKey];
                entry.weight += w;
                if (entry.topRank === null || i < entry.topRank) entry.topRank = i;
                (a.genres || []).forEach(g => { genreWeights[g] = (genreWeights[g] || 0) + w; });
            });
        };
        addWindow(topArtistsLong, 'long');
        addWindow(topArtistsMedium, 'medium');
        addWindow(topArtistsShort, 'short');

        // Followed artists -> strongest artist signal
        followed.forEach(a => { ensureArtist(a.name, a.genres).followed = true; });

        // Library saves per artist (liked songs)
        savedTracks.forEach(({ track }) => {
            (track?.artists || []).forEach(a => { ensureArtist(a.name).saveCount += 1; });
        });

        // Convert artist/genre weights into normalized shares (fraction of total)
        const totalArtistWeight = Object.values(artists).reduce((s, a) => s + a.weight, 0) || 1;
        Object.values(artists).forEach(a => { a.share = a.weight / totalArtistWeight; });
        const totalGenreWeight = Object.values(genreWeights).reduce((s, w) => s + w, 0) || 1;
        const genreShare = {};
        Object.entries(genreWeights).forEach(([g, w]) => { genreShare[g] = w / totalGenreWeight; });

        // ---- Album / track affinity ----
        // Which albums do the user's top tracks + liked songs belong to?
        const albumTopTrackCount = {}; // "artist|album" -> # of top tracks from it
        const savedTrackAlbums = {};   // "artist|album" -> # of liked songs from it
        const countTrack = (track, bucket) => {
            const artist = track?.artists?.[0]?.name;
            const album = track?.album?.name;
            if (!artist || !album) return;
            const key = `${lc(artist)}|${lc(album)}`;
            bucket[key] = (bucket[key] || 0) + 1;
        };
        [topTracksShort, topTracksMedium, topTracksLong].forEach(t =>
            (t?.items || []).forEach(track => countTrack(track, albumTopTrackCount)));
        savedTracks.forEach(({ track }) => countTrack(track, savedTrackAlbums));

        // Saved (liked) full albums
        const savedAlbumSet = {};
        savedAlbums.forEach(({ album }) => {
            const artist = album?.artists?.[0]?.name;
            if (artist && album?.name) savedAlbumSet[`${lc(artist)}|${lc(album.name)}`] = true;
        });

        // Recently played artist names
        const recentArtistNames = [...new Set((recentlyPlayed?.items || [])
            .map(x => x.track?.artists?.[0]?.name).filter(Boolean))];

        // Taste-profile tags (display only): top genres by share
        const topGenres = Object.entries(genreShare).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([g]) => g);

        res.json({
            artists,            // { lcName: { name, genres, share, followed, saveCount, topRank } }
            genreShare,         // { genre: fractionOfListening }
            albumTopTrackCount, // { "artist|album": count }
            savedTrackAlbums,   // { "artist|album": count }
            savedAlbumSet,      // { "artist|album": true }
            recentArtists: recentArtistNames,
            topGenres,          // for taste tags
        });
    } catch (err) {
        console.error('Profile fetch error:', err);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Search Spotify for album art
app.get('/api/album-art', async (req, res) => {
    const { artist, album } = req.query;
    if (!artist || !album) return res.json({ image: null });

    try {
        const query = encodeURIComponent(`album:${album} artist:${artist}`);
        const data = await spotifyFetch(req, `/search?q=${query}&type=album&limit=1`);

        if (data?.albums?.items?.[0]) {
            const item = data.albums.items[0];
            res.json({
                image: item.images?.[1]?.url || item.images?.[0]?.url || null,
                spotifyUri: item.uri,
                spotifyUrl: item.external_urls?.spotify,
            });
        } else {
            res.json({ image: null });
        }
    } catch (err) {
        res.json({ image: null });
    }
});

// Batch album art lookup
app.post('/api/album-art-batch', async (req, res) => {
    const { albums } = req.body; // [{ artist, album }, ...]
    if (!albums || !Array.isArray(albums)) return res.json([]);

    const results = await Promise.all(
        albums.slice(0, 30).map(async ({ artist, album }) => {
            try {
                const query = encodeURIComponent(`album:${album} artist:${artist}`);
                const data = await spotifyFetch(req, `/search?q=${query}&type=album&limit=1`);
                const item = data?.albums?.items?.[0];
                return {
                    artist,
                    album,
                    image: item?.images?.[1]?.url || item?.images?.[0]?.url || null,
                    spotifyUri: item?.uri || null,
                };
            } catch {
                return { artist, album, image: null, spotifyUri: null };
            }
        })
    );

    res.json(results);
});

// Resolve album from free-text search (for adding sessions)
app.get('/api/resolve-album', async (req, res) => {
    const { q } = req.query;
    if (!q) return res.json({});

    try {
        const query = encodeURIComponent(q);
        const data = await spotifyFetch(req, `/search?q=${query}&type=album&limit=1`);
        const item = data?.albums?.items?.[0];
        if (item) {
            // Get artist genres
            const artistId = item.artists?.[0]?.id;
            let genres = [];
            if (artistId) {
                const artistData = await spotifyFetch(req, `/artists/${artistId}`);
                genres = artistData?.genres?.slice(0, 5) || [];
            }
            res.json({
                artist: item.artists?.[0]?.name || '',
                album: item.name || '',
                genres,
                image: item.images?.[1]?.url || item.images?.[0]?.url || null,
                spotifyUri: item.uri,
            });
        } else {
            res.json({});
        }
    } catch (err) {
        res.json({});
    }
});

// Bipolar taste-axis definitions for the preferences menu
app.get('/api/axes', (req, res) => {
    res.json({ axes: AXES });
});

// Get Shibuya Hi-Fi schedule
app.get('/api/schedule', async (req, res) => {
    try {
        const events = await scrapeSchedule();
        res.json(events);
    } catch (err) {
        console.error('Schedule scrape error:', err);
        res.status(500).json({ error: 'Failed to fetch schedule' });
    }
});

// ============================================================
// START
// ============================================================

app.listen(PORT, () => {
    console.log(`\n  🎵 My Shibuya running at http://127.0.0.1:${PORT}\n`);
    console.log(`  → Open that URL in your browser`);
    console.log(`  → You'll be prompted to connect Spotify\n`);
});
