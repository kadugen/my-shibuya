// ==========================================================
// MY SHIBUYA - Client-side application
// ==========================================================

const STORAGE_KEY = 'my-shibuya-feedback';
const PREFS_KEY = 'my-shibuya-prefs';
let spotifyProfile = null;
let scheduleEvents = [];
let historySort = 'rating';
let historyArtCache = {}; // { "artist|album": { image, spotifyUri } }
let axisVocab = []; // bipolar taste axes from /api/axes
let isAuthenticated = false; // set from /api/status; gates server history sync

// ============================================================
// INIT
// ============================================================
async function init() {
    setupNavigation();

    // Load the bipolar taste-axis definitions for the preferences menu
    const axisResp = await fetchJSON('/api/axes');
    axisVocab = Array.isArray(axisResp?.axes) ? axisResp.axes : [];
    setupPreferences();

    const status = await fetchJSON('/api/status');
    isAuthenticated = !!status.authenticated;
    updateSpotifyBadge(status);

    if (status.authenticated) {
        // Pull this user's server-side history into the local cache FIRST, so
        // their real history shows on any device. New users get an empty list.
        await syncHistoryFromServer();
        spotifyProfile = await fetchJSON('/api/profile');
        renderTasteProfile();
    }

    // Seed the Vibe sliders from history once it's loaded (empty history = neutral)
    maybeSeedPreferences();

    try {
        scheduleEvents = await fetchJSON('/api/schedule');
        if (scheduleEvents.length === 0 || !scheduleEvents[0]?.date) {
            scheduleEvents = getFallbackSchedule();
        }
        await enrichWithAlbumArt(scheduleEvents);
    } catch (e) {
        scheduleEvents = getFallbackSchedule();
        await enrichWithAlbumArt(scheduleEvents);
    }

    renderUpcoming('all');
    renderDiscover();
    renderHistory();

    setupTour();
}

// ============================================================
// HELPERS
// ============================================================
async function fetchJSON(url, opts) {
    try { const r = await fetch(url, opts); return r.ok ? await r.json() : {}; } catch { return {}; }
}

function updateSpotifyBadge(status) {
    const badge = document.getElementById('spotifyBadge');
    if (status.authenticated && status.user) {
        badge.classList.remove('disconnected');
        const img = status.user.image ? `<img src="${status.user.image}" style="width:22px;height:22px;border-radius:50%;object-fit:cover">` : '<div class="spotify-dot"></div>';
        badge.innerHTML = `${img}<span>Connected</span>`;
        badge.href = '#';
        badge.onclick = (e) => { e.preventDefault(); showLogoutModal(); };
    }
}

function showLogoutModal() {
    if (confirm('Switch Spotify account? This will disconnect the current account.')) {
        // Clear the local history/prefs cache so the next account doesn't see the
        // previous user's data (server is the real per-account record).
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(PREFS_KEY);
        fetch('/api/logout', { method: 'POST' }).then(() => { window.location.href = '/login'; });
    }
}

function renderTasteProfile() {
    if (!spotifyProfile?.topGenres?.length) return;
    document.getElementById('tasteProfile').style.display = '';
    document.getElementById('tasteTags').innerHTML = spotifyProfile.topGenres.slice(0, 8).map(t => `<span class="taste-tag">${t}</span>`).join('');
}

async function enrichWithAlbumArt(events) {
    const needArt = events.filter(e => !e.image).map(e => ({ artist: e.artist, album: e.title }));
    if (needArt.length === 0) return;
    const results = await fetchJSON('/api/album-art-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albums: needArt }),
    });
    if (Array.isArray(results)) {
        results.forEach(r => {
            const event = events.find(e => e.artist === r.artist && e.title === r.album);
            if (event && r.image) { event.image = r.image; event.spotifyUri = r.spotifyUri; }
        });
    }
}

async function getHistoryArt(artist, album) {
    const key = `${artist}|${album}`;
    if (historyArtCache[key]) return historyArtCache[key];
    const result = await fetchJSON(`/api/album-art?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}`);
    historyArtCache[key] = { image: result?.image || null, spotifyUri: result?.spotifyUri || null };
    return historyArtCache[key];
}

async function loadAllHistoryArt() {
    const feedback = loadFeedback();
    const uncached = feedback.filter(f => !historyArtCache[`${f.artist}|${f.album}`]);
    if (uncached.length === 0) return;
    const results = await fetchJSON('/api/album-art-batch', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ albums: uncached.map(f => ({ artist: f.artist, album: f.album })) }),
    });
    if (Array.isArray(results)) {
        results.forEach(r => { historyArtCache[`${r.artist}|${r.album}`] = { image: r.image, spotifyUri: r.spotifyUri }; });
    }
}

// ============================================================
// SCORING ALGORITHM — "Shibuya Score" (0–99)
//
// Shibuya is a destination hi-fi LISTENING ROOM. What you want there (immersive,
// atmospheric, journey-like records on vintage Klipschorns) turned out to be
// only loosely related to day-to-day Spotify streaming. Analysis of the rating
// history confirmed this: GENRE barely predicts enjoyment (corr ~0), while
// sonic-ATTRIBUTE match against stated preferences correlates ~0.68. So the
// model leads with listening-intent + your own Shibuya ratings, treats genre as
// a weak tiebreaker, and makes Spotify a small OPTIONAL bonus.
//
// INTENT is measured on BIPOLAR taste axes (see axes.js): the user positions
// themselves between opposite poles (e.g. Instrumental ↔ Vocal-forward) on a
// [-1,+1] scale, 0 = "no preference". Each album is positioned on the same axes.
// Match = 1 − (weighted distance between the listener and the album), so only
// axes the user actually cares about (non-zero) influence the score, and taking
// a strong stance means the opposite pole is penalized. This fixes the old
// "just max every slider" problem and works for any listener, not just one type.
//
// Buckets, each a 0–1 affinity combined with NOISY-OR (independent signals
// reinforce; any one strong signal moves the score on its own). The per-bucket
// weight is its ceiling — the most it can contribute alone:
//   1. INTENT  (0.85) — album's axis position ↔ your preference sliders
//   2. ARTIST  (0.80) — Shibuya history w/ artist  (+ optional Spotify follow/plays)
//   3. ALBUM   (0.55) — you rated THIS album at Shibuya (+ optional Spotify)
//   4. GENRE   (0.30) — your Shibuya ratings in same/similar genres (tiebreaker)
//
// Spotify is never required: with no preferences and no history the score is a
// neutral 50, and connecting Spotify only adds a modest nudge.
// ============================================================
const lc = s => (s || '').toLowerCase().trim();
const ratingPct = r => Math.max(0, (r - 1) / 4); // 5→1.0, 4→0.75, 3→0.5, 2→0.25, 1→0

// Per-bucket noisy-OR ceilings (how much each can contribute on its own)
const SCORE_WEIGHTS = { intent: 0.85, artist: 0.80, album: 0.55, genre: 0.30 };
// Spotify is optional — these are the MOST a pure-Spotify signal can push a
// bucket's affinity to when you have no Shibuya history for it.
const SPOTIFY_MAX = { artist: 0.55, album: 0.45 };
const GENRE_TUNING = { gMaxW: 0.55, covFloor: 0.6, shareTarget: 0.30 };

// Are two genre strings the same or closely related (substring overlap)?
function genresRelated(a, b) {
    a = lc(a); b = lc(b);
    if (!a || !b) return false;
    if (a === b) return true;
    return a.includes(b) || b.includes(a);
}

function calculateScore(event) {
    const reasons = [];
    const feedback = loadFeedback();
    const p = spotifyProfile || {};
    const artistKey = lc(event.artist);
    const eventGenres = (event.genres && event.genres.length ? event.genres : guessGenres(event));

    // Shibuya history grouped by artist and by album
    const artistRatings = {}; // lcArtist -> [ratings]
    const albumRating = {};   // "lcArtist|lcAlbum" -> rating
    feedback.forEach(f => {
        const ak = lc(f.artist);
        (artistRatings[ak] = artistRatings[ak] || []).push(f.rating);
        albumRating[`${ak}|${lc(f.album)}`] = f.rating;
    });

    // ============ 1. ARTIST AFFINITY (0–1) ============
    // Shibuya history is the ground truth; Spotify (if connected) is a capped bonus.
    let artistFrac = 0;
    const a = p.artists?.[artistKey];

    // --- optional Spotify signals, capped at SPOTIFY_MAX.artist ---
    let spotifyArtist = 0;
    if (a) {
        if (a.followed) { spotifyArtist = 1; reasons.push(`You follow ${event.artist}`); }
        spotifyArtist = Math.max(spotifyArtist, Math.min(1, (a.share || 0) / 0.10));
        spotifyArtist = Math.max(spotifyArtist, Math.min(1, (a.saveCount || 0) / 5));
        if (a.topRank != null) {
            spotifyArtist = Math.max(spotifyArtist, a.topRank < 10 ? 0.6 : a.topRank < 25 ? 0.4 : 0.25);
        }
        artistFrac = spotifyArtist * SPOTIFY_MAX.artist;
        if (!a.followed && spotifyArtist >= 0.6) reasons.push(`You listen to ${event.artist}`);
    }
    // Shibuya history for this artist: average rating as % of max (supersedes Spotify)
    if (artistRatings[artistKey]) {
        const avg = artistRatings[artistKey].reduce((s, r) => s + r, 0) / artistRatings[artistKey].length;
        artistFrac = Math.max(artistFrac, ratingPct(avg));
        if (Math.max(...artistRatings[artistKey]) >= 4) reasons.push(`Loved ${event.artist} at Shibuya`);
        else reasons.push(`Heard ${event.artist} at Shibuya`);
    }

    // ============ 2. ALBUM AFFINITY (0–1) ============
    // Shibuya history for this exact album SUPERSEDES all Spotify album signals.
    let albumFrac = 0;
    const albKey = `${artistKey}|${lc(event.title)}`;
    if (albumRating[albKey] != null) {
        albumFrac = ratingPct(albumRating[albKey]);
        reasons.push('You rated this album at Shibuya');
    } else {
        // --- optional Spotify signals, capped at SPOTIFY_MAX.album ---
        let spotifyAlbum = 0;
        if (p.savedAlbumSet?.[albKey]) { spotifyAlbum = 1; reasons.push('Album in your library'); }
        const topTracks = p.albumTopTrackCount?.[albKey] || 0;
        const savedTracksOnAlbum = p.savedTrackAlbums?.[albKey] || 0;
        const trackFrac = Math.min(1, (topTracks + savedTracksOnAlbum) / 3);
        if (trackFrac > spotifyAlbum) {
            spotifyAlbum = trackFrac;
            if (trackFrac >= 1) reasons.push('You play this album a lot');
            else if (trackFrac > 0) reasons.push('You know tracks off this album');
        }
        albumFrac = spotifyAlbum * SPOTIFY_MAX.album;
    }

    // ============ 3. GENRE AFFINITY (0–1) ============
    // Per-genre: blend max & mean of your ratings for history in that genre, so
    // strong loves aren't diluted by unrelated low ratings. Then average across
    // the album's genres and scale by coverage (how many of them you know).
    let genreFrac = 0;
    const genreShare = p.genreShare || {};
    const perGenre = [];
    eventGenres.forEach(g => {
        const pcts = [];
        feedback.forEach(f => {
            if ((f.genres || []).some(fg => genresRelated(fg, g))) pcts.push(ratingPct(f.rating));
        });
        if (pcts.length) {
            const mx = Math.max(...pcts);
            const mn = pcts.reduce((s, x) => s + x, 0) / pcts.length;
            perGenre.push(GENRE_TUNING.gMaxW * mx + (1 - GENRE_TUNING.gMaxW) * mn);
        }
    });
    if (perGenre.length) {
        const mean = perGenre.reduce((s, x) => s + x, 0) / perGenre.length;
        const coverage = perGenre.length / eventGenres.length;
        genreFrac = mean * (GENRE_TUNING.covFloor + (1 - GENRE_TUNING.covFloor) * coverage);
    }
    // If Spotify ever restores genre data, fold in listening-share as another signal
    if (Object.keys(genreShare).length) {
        let directShare = 0;
        eventGenres.forEach(g => {
            Object.entries(genreShare).forEach(([ug, s]) => { if (genresRelated(g, ug)) directShare += s; });
        });
        genreFrac = Math.max(genreFrac, Math.min(1, directShare / GENRE_TUNING.shareTarget));
    }
    if (genreFrac >= 0.75) reasons.push('Genre you rate highly');
    else if (genreFrac >= 0.4) reasons.push('Genre match');

    // ============ 4. LISTENING-INTENT AFFINITY (0–1) ============
    // Match the album's position on the bipolar taste axes against the user's
    // slider positions. Only axes the user has moved off-center count, weighted
    // by how strongly they feel (distance from 0). This is the strongest
    // predictor of Shibuya enjoyment, so it leads the score.
    const prefs = loadPreferences();           // { axisKey: -1..1 }
    const albumAxes = event.axes || axesFromGenres(eventGenres);
    let intentFrac = 0;
    const activeAxes = Object.keys(prefs).filter(k => Math.abs(prefs[k]) > 0.05);
    if (activeAxes.length && albumAxes) {
        // Weighted alignment: for each axis the user cares about, how close is
        // the album's position to theirs? |pref| is the weight (how much it
        // matters); the pole-distance is |pref - album| on a [-1,1] scale (max 2).
        let wsum = 0, aligned = 0;
        activeAxes.forEach(k => {
            const pref = prefs[k];
            const alb = typeof albumAxes[k] === 'number' ? albumAxes[k] : 0;
            const weight = Math.abs(pref);
            // Signed agreement: same pole → +1, opposite pole → −1, neutral → 0.
            // (pref and alb are both in [-1,1]; product/|pref| normalizes to the
            // album's position along the pref's direction.) An album that leans
            // the WRONG way scores negative here, so it actively drags intent
            // down rather than getting partial credit like the old formula.
            const agreement = Math.max(-1, Math.min(1, (pref * alb) / Math.abs(pref)));
            wsum += weight;
            aligned += weight * agreement;
        });
        // Map signed mean agreement [−1,1] → [0,1]
        intentFrac = wsum > 0 ? (aligned / wsum + 1) / 2 : 0.5;
        if (intentFrac >= 0.75) reasons.push('Matches your listening vibe');
        else if (intentFrac >= 0.55) reasons.push('Fits some of your vibe');
        else if (intentFrac <= 0.4) reasons.push('Not your usual vibe');
    }
    // How decisively has the user expressed preferences? (avg |slider|, 0..1)
    // Used to scale the intent PENALTY so we only punish poor matches when the
    // user has actually taken strong positions — not when sliders sit near center.
    const prefStrength = activeAxes.length
        ? activeAxes.reduce((s, k) => s + Math.abs(prefs[k]), 0) / activeAxes.length : 0;

    // ============ COMBINE (noisy-OR) ============
    // score = 1 − ∏(1 − weightedAffinity); independent signals reinforce.
    const hasPrefs = activeAxes.length > 0;
    let score;
    if (!spotifyProfile && feedback.length === 0 && !hasPrefs) {
        score = 50; // neutral default when we have no data at all
    } else {
        const contribs = [
            intentFrac * SCORE_WEIGHTS.intent,
            artistFrac * SCORE_WEIGHTS.artist,
            albumFrac * SCORE_WEIGHTS.album,
            genreFrac * SCORE_WEIGHTS.genre,
        ];
        const prodMiss = contribs.reduce((prod, c) => prod * (1 - c), 1);
        score = Math.round((1 - prodMiss) * 100);

        // ---- INTENT PENALTY ----
        // intentFrac ~0.5 means the album sits neutral/opposite on the axes you
        // care about; below that it actively clashes with your stated taste.
        // Scale the score down for poor matches, proportional to how decisively
        // you've set your sliders (prefStrength). This lets a strong "deep
        // listener" profile actually push arena-rock/pop DOWN, not just fail to
        // lift it. Skipped when the exact album is rated (the cap handles that).
        if (albumRating[albKey] == null && prefStrength > 0.2 && intentFrac < 0.5) {
            const clash = (0.5 - intentFrac) / 0.5;            // 0 at neutral → 1 at fully opposite
            const penalty = 1 - clash * prefStrength * 0.7;    // up to ~0.7× at max clash+conviction
            score = Math.round(score * penalty);
        }
    }

    // ============ RATING CAP (your history is the strongest predictor) ============
    // A Shibuya rating for THIS album is a near-verdict, so it caps the score:
    //   1→~20, 2→~40, 3→~60, 4→~80, 5→~99. Other signals can only nudge WITHIN a
    //   small band above that anchor — they can't override "I heard it and disliked it."
    // A rating for the same ARTIST (different album) applies a softer ceiling.
    const RATING_CAP = { 1: 25, 2: 45, 3: 68, 4: 88, 5: 99 };
    if (albumRating[albKey] != null) {
        const r = albumRating[albKey];
        const cap = RATING_CAP[r];
        // allow a few points of wiggle from other signals, but the rating dominates
        score = Math.min(score, cap + 3);
        if (r <= 2) { score = Math.min(score, cap); reasons.unshift(`You rated this ${r}/5 at Shibuya`); }
    } else if (artistRatings[artistKey]) {
        // Different album by an artist you've rated: soft ceiling from their WORST
        // rating so a disliked artist can't ride genre/intent to a high score.
        const worst = Math.min(...artistRatings[artistKey]);
        if (worst <= 2) {
            const softCap = RATING_CAP[worst] + 20; // softer than an exact-album cap
            if (score > softCap) { score = softCap; reasons.unshift(`You rated ${event.artist} low before`); }
        }
    }

    // Dedupe reasons, keep the 3 strongest (order already roughly strong→weak)
    const seen = new Set();
    const uniqueReasons = reasons.filter(r => (seen.has(r) ? false : seen.add(r)));

    return { score: Math.min(99, Math.max(5, score)), reasons: uniqueReasons.slice(0, 3) };
}

function guessGenres(event) {
    const text = ((event.description || '') + ' ' + (event.artist || '')).toLowerCase();
    const genres = [];
    [['jazz','jazz'],['rock','rock'],['electronic','electronic'],['ambient','ambient'],['punk','punk'],['soul','soul'],['funk','funk'],['classical','classical'],['blues','blues'],['metal','metal'],['psychedelic','psychedelic rock'],['prog','progressive rock'],['post-rock','post-rock'],['trip-hop','trip-hop'],['grunge','grunge']].forEach(([kw,g])=>{if(text.includes(kw))genres.push(g);});
    return genres.length ? genres : ['rock'];
}

// Client-side genre -> sonic-attribute inference. Mirror of the server's
// GENRE_ATTRIBUTES (attributes.js); used for albums without curated attributes
// (e.g. the Discover list). Keep the two in rough sync.
const GENRE_ATTR = {
    ambient:['atmospheric','immersive','instrumental','meditative','hypnotic'],
    drone:['atmospheric','hypnotic','meditative','longform'],
    'post-rock':['atmospheric','immersive','dynamic','build','instrumental'],
    'progressive rock':['immersive','longform','dynamic','cinematic'],
    'art rock':['immersive','atmospheric','production'],
    'psychedelic rock':['immersive','hypnotic','atmospheric','warm'],
    krautrock:['hypnotic','immersive','longform','instrumental'],
    'spiritual jazz':['immersive','instrumental','meditative','longform','build'],
    'modal jazz':['instrumental','immersive','meditative','warm'],
    'avant-garde jazz':['instrumental','immersive','dynamic'],
    jazz:['instrumental','warm','immersive'],
    fusion:['instrumental','dynamic','longform'],
    'trip-hop':['atmospheric','hypnotic','production','melancholic'],
    downtempo:['atmospheric','hypnotic','meditative'],
    electronic:['production','hypnotic','atmospheric'],
    classical:['cinematic','instrumental','dynamic','immersive'],
    orchestral:['cinematic','instrumental','dynamic'],
    cinematic:['cinematic','atmospheric','instrumental'],
    soundtrack:['cinematic','instrumental','atmospheric'],
    soul:['warm','immersive','melancholic'],
    'r&b':['warm','production','immersive'],
    funk:['warm','hypnotic','instrumental'],
    afrobeat:['hypnotic','longform','instrumental','warm'],
    'dream pop':['atmospheric','immersive','melancholic','production'],
    shoegaze:['atmospheric','immersive','build','dynamic'],
    blues:['warm','instrumental'],
    'blues rock':['warm','dynamic'],
    'classic rock':['warm','dynamic','production'],
    'hard rock':['dynamic','production'],
    folk:['warm','melancholic','instrumental'],
    instrumental:['instrumental','immersive'],
    experimental:['immersive','atmospheric','dynamic'],
};
function attributesFromGenres(genres) {
    const set = new Set();
    (genres || []).forEach(g => { (GENRE_ATTR[lc(g)] || []).forEach(a => set.add(a)); });
    return [...set];
}

// Fallback axis positions for albums the scraper didn't tag (e.g. the Discover
// list). Mirrors the server's deriveAxes (axes.js) using the same attribute +
// genre cues. Returns { axisKey: -1..1 }; negative = deep/left pole.
function axesFromGenres(genres) {
    const A = attributesFromGenres(genres), G = (genres || []).map(lc);
    const has = v => A.includes(v);
    const anyG = list => G.some(g => list.some(t => g.includes(t)));
    const clamp = x => Math.max(-1, Math.min(1, x));
    const ax = { voice: 0, shape: 0, energy: 0, mood: 0, space: 0, sound: 0, access: 0 };
    // VOICE: instrumental (−) ↔ vocal-forward (+). An explicit 'instrumental'
    // attribute overrides the artist's vocal genre (mirrors server deriveAxes).
    if (has('instrumental')) {
        ax.voice -= 0.7;
    } else {
        if (anyG(['ambient','drone','post-rock','krautrock','classical','orchestral','minimalism'])) ax.voice -= 0.5;
        if (anyG(['soul','r&b','neo-soul','pop','singer-songwriter','vocal jazz','gospel','dance-pop','hip-hop','rap','city pop'])) ax.voice += 0.7;
        if (anyG(['dream pop','baroque pop','art pop'])) ax.voice += 0.3;
    }
    // SHAPE: continuous journey (−) ↔ individual songs (+)
    if (has('immersive')) ax.shape -= 0.5;
    if (has('longform')) ax.shape -= 0.4;
    if (has('build')) ax.shape -= 0.2;
    if (anyG(['pop','dance-pop','garage rock','punk','arena rock','glam rock','city pop'])) ax.shape += 0.4;
    // ENERGY: mellow/meditative (−) ↔ energetic/danceable (+)
    if (has('meditative')) ax.energy -= 0.6;
    if (has('atmospheric')) ax.energy -= 0.3;
    if (has('dynamic')) ax.energy += 0.4;
    if (has('build')) ax.energy += 0.2;
    if (anyG(['dance','disco','funk','house','hard rock','metal','punk','thrash','arena rock'])) ax.energy += 0.5;
    if (anyG(['ambient','drone','downtempo'])) ax.energy -= 0.5;
    // MOOD: moody/melancholy (−) ↔ bright/uplifting (+)
    if (has('melancholic')) ax.mood -= 0.6;
    if (anyG(['soul','funk','disco','gospel','afrobeat'])) ax.mood += 0.4;
    if (anyG(['doom','shoegaze'])) ax.mood -= 0.3;
    // SPACE: enveloping/lush (−) ↔ sparse/direct (+)
    if (has('atmospheric')) ax.space -= 0.3;
    if (anyG(['shoegaze','dream pop','orchestral','wall of sound'])) ax.space -= 0.5;
    if (anyG(['folk','singer-songwriter','minimalism','minimal'])) ax.space += 0.5;
    if (has('meditative') && !has('immersive')) ax.space += 0.2;
    // SOUND: warm/vintage (−) ↔ crisp/modern (+)
    if (has('warm')) ax.sound -= 0.6;
    if (anyG(['soul','blues','classic rock','jazz','funk','folk','city pop'])) ax.sound -= 0.4;
    if (anyG(['electronic','dance-pop','idm','techno','house','hyperpop','alt-pop','electropop'])) ax.sound += 0.5;
    if (has('production') && !has('warm')) ax.sound += 0.2;
    // ACCESS: complex/demanding (−) ↔ immediate/catchy (+)
    if (has('hypnotic')) ax.access -= 0.3;
    if (has('longform')) ax.access -= 0.3;
    if (anyG(['experimental','avant-garde','free jazz','progressive','krautrock','modal jazz','contemporary classical','minimalism'])) ax.access -= 0.6;
    if (anyG(['pop','dance-pop','garage rock','arena rock','glam rock'])) ax.access += 0.5;
    Object.keys(ax).forEach(k => { ax[k] = clamp(ax[k]); });
    return ax;
}

function getScoreColor(s) { return s >= 80 ? 'var(--score-high)' : s >= 50 ? 'var(--score-mid)' : 'var(--score-low)'; }

function getFallbackSchedule() {
    return [
        {title:"TNT",artist:"Tortoise",date:"2026-07-29",time:"6:00 PM – 7:00 PM",host:"Studio Q",url:"https://www.shibuyahifi.com/event-details/tortoise-tnt",soldOut:false,genres:['post-rock','jazz','electronic','instrumental','experimental'],relatedArtists:['Tortoise','Stereolab','Boards of Canada']},
        {title:"Songs In The Key Of Life",artist:"Stevie Wonder",date:"2026-07-29",time:"8:00 PM – 10:00 PM",host:"Studio Q",url:"https://www.shibuyahifi.com/event-details/stevie-wonder-songs-in-the-key-of-life",soldOut:true,genres:['soul','funk','jazz','r&b'],relatedArtists:['Stevie Wonder','Marvin Gaye']},
        {title:"The Blues and the Abstract Truth",artist:"Oliver Nelson",date:"2026-07-30",time:"5:00 PM – 6:00 PM",host:"Casual Hero",url:"https://www.shibuyahifi.com/event-details/oliver-nelson-the-blues-and-the-abstract-truth",soldOut:false,genres:['jazz','hard bop','modal jazz'],relatedArtists:['John Coltrane','Miles Davis','Eric Dolphy']},
        {title:"IV",artist:"Led Zeppelin",date:"2026-07-30",time:"6:00 PM – 7:30 PM",host:"Casual Hero",url:"https://www.shibuyahifi.com/event-details/led-zeppelin-iv-6",soldOut:true,genres:['hard rock','blues rock','classic rock'],relatedArtists:['Led Zeppelin','Black Sabbath','Deep Purple']},
        {title:"Is This It",artist:"The Strokes",date:"2026-07-30",time:"7:30 PM – 9:00 PM",host:"Andrew",url:"https://www.shibuyahifi.com/event-details/the-strokes-is-this-it-2",soldOut:true,genres:['indie rock','garage rock','post-punk revival'],relatedArtists:['The Strokes','Arctic Monkeys']},
        {title:"LUX",artist:"Rosalía",date:"2026-07-30",time:"9:00 PM – 10:30 PM",host:"Andrew",url:"https://www.shibuyahifi.com/event-details/rosalia-lux-21",soldOut:true,genres:['avant-pop','art pop','orchestral','experimental'],relatedArtists:['Rosalía','Björk','FKA Twigs']},
        {title:"A Love Supreme",artist:"John Coltrane",date:"2026-07-31",time:"5:00 PM – 6:00 PM",host:"Casual Hero",url:"https://www.shibuyahifi.com/event-details/john-coltrane-a-love-supreme-6",soldOut:false,genres:['jazz','spiritual jazz','modal jazz','avant-garde jazz'],relatedArtists:['John Coltrane','Pharoah Sanders','Miles Davis']},
        {title:"Audioslave",artist:"Audioslave",date:"2026-07-31",time:"6:00 PM – 7:30 PM",host:"Casual Hero",url:"https://www.shibuyahifi.com/event-details/audioslave-audioslave",soldOut:false,genres:['alternative rock','hard rock','grunge'],relatedArtists:['Soundgarden','Rage Against the Machine']},
        {title:"Blonde",artist:"Frank Ocean",date:"2026-07-31",time:"7:30 PM – 9:00 PM",host:"Brian",url:"https://www.shibuyahifi.com/event-details/frank-ocean-blonde-6",soldOut:true,genres:['r&b','art pop','experimental','alternative r&b'],relatedArtists:['Frank Ocean','Tyler the Creator']},
        {title:"Channel Orange",artist:"Frank Ocean",date:"2026-07-31",time:"9:00 PM – 10:30 PM",host:"Brian",url:"https://www.shibuyahifi.com/event-details/frank-ocean-channel-orange-7",soldOut:true,genres:['r&b','soul','funk','psychedelic'],relatedArtists:['Frank Ocean','Stevie Wonder','Prince']},
        {title:"Revolver",artist:"The Beatles",date:"2026-08-01",time:"5:00 PM – 6:00 PM",host:"Kevin",url:"https://www.shibuyahifi.com/event-details/the-beatles-revolver-2",soldOut:true,genres:['psychedelic rock','art rock','pop rock','experimental'],relatedArtists:['The Beatles','The Kinks']},
        {title:"Dark Side of The Moon",artist:"Pink Floyd",date:"2026-08-01",time:"6:00 PM – 7:30 PM",host:"Casual Hero",url:"https://www.shibuyahifi.com/event-details/pink-floyd-dark-side-of-the-moon-16",soldOut:true,genres:['progressive rock','art rock','psychedelic rock'],relatedArtists:['Pink Floyd','King Crimson','Yes']},
        {title:"Little Earthquakes",artist:"Tori Amos",date:"2026-08-01",time:"7:30 PM – 9:30 PM",host:"Brian",url:"https://www.shibuyahifi.com/event-details/tori-amos-little-earthquakes",soldOut:false,genres:['art rock','singer-songwriter','piano rock','alternative'],relatedArtists:['Tori Amos','Kate Bush','Fiona Apple']},
        {title:"Tourist",artist:"St. Germain",date:"2026-08-01",time:"9:00 PM – 11:00 PM",host:"Brian",url:"https://www.shibuyahifi.com/event-details/st-germain-tourist",soldOut:false,genres:['electronic','jazz','house','deep house'],relatedArtists:['St. Germain','Kruder & Dorfmeister','Bonobo']},
        {title:"Who's Next",artist:"The Who",date:"2026-08-04",time:"5:00 PM – 7:00 PM",host:"Kevin",url:"https://www.shibuyahifi.com/event-details/the-who-whos-next-1",soldOut:false,genres:['classic rock','hard rock','rock opera'],relatedArtists:['The Who','The Rolling Stones']},
        {title:"Pink Flag",artist:"Wire",date:"2026-08-04",time:"7:00 PM – 9:00 PM",host:"Casual Hero",url:"https://www.shibuyahifi.com/event-details/wire-pink-flag",soldOut:false,genres:['post-punk','punk','art punk','new wave'],relatedArtists:['Wire','Gang of Four','Joy Division']},
        {title:"Alive",artist:"KISS",date:"2026-08-04",time:"9:00 PM – 11:00 PM",host:"Casual Hero",url:"https://www.shibuyahifi.com/event-details/kiss-alive",soldOut:false,genres:['hard rock','glam rock','arena rock'],relatedArtists:['KISS','AC/DC','Def Leppard']},
        {title:"Also Sprach Zarathustra",artist:"Richard Strauss / CSO / Fritz Reiner",date:"2026-08-05",time:"6:00 PM – 8:00 PM",host:"Studio Q",url:"https://www.shibuyahifi.com/event-details/richard-strauss-also-sprach-zarathustra-chicago-symphony-orchestra-fritz-reiner",soldOut:false,genres:['classical','orchestral'],relatedArtists:['Richard Strauss','Gustav Mahler']},
        {title:"Lake Fire",artist:"Loscil",date:"2026-08-05",time:"8:00 PM – 10:00 PM",host:"Studio Q",url:"https://www.shibuyahifi.com/event-details/loscil-lake-fire",soldOut:false,genres:['ambient','electronic','drone','experimental'],relatedArtists:['Loscil','Boards of Canada','Tim Hecker']},
        {title:"My Favorite Things (Mono)",artist:"John Coltrane",date:"2026-08-06",time:"5:00 PM – 6:00 PM",host:"Casual Hero",url:"https://www.shibuyahifi.com/event-details/coltrane-in-mono-john-coltrane-my-favorite-things",soldOut:false,genres:['jazz','modal jazz','spiritual jazz'],relatedArtists:['John Coltrane','McCoy Tyner','Miles Davis']},
    ];
}

// ============================================================
// RENDER HELPERS
// ============================================================
function renderCard(event) {
    const color = getScoreColor(event.score);
    const circ = 2 * Math.PI * 18, offset = circ - (event.score / 100) * circ;
    const spotifyLink = event.spotifyUri || `spotify:search:${encodeURIComponent(event.artist + ' ' + event.title)}`;
    const artHtml = event.image ? `<img src="${event.image}" alt="">` : placeholderArt(event.artist, event.title);

    return `
    <div class="card ${event.soldOut ? 'sold-out' : ''}">
        <a href="${spotifyLink}" class="album-art-link">${artHtml}</a>
        <div class="card-info">
            <div class="card-title">${event.title}</div>
            <div class="card-artist">${event.artist}</div>
            <div class="card-meta">${event.time?`<span>🕐 ${event.time}</span>`:''}${event.host?`<span>by ${event.host}</span>`:''}</div>
            <div class="match-reasons">${(event.reasons||[]).map(r=>`<span class="match-reason">${r}</span>`).join('')}</div>
            ${event.soldOut?'<span class="sold-out-badge">Sold Out</span>':event.url?`<a href="${event.url}" target="_blank" class="ticket-btn">Buy Tickets</a>`:''}
        </div>
        <div class="score-container">
            <div class="score-ring"><svg viewBox="0 0 40 40"><circle class="score-ring-bg" cx="20" cy="20" r="18"/><circle class="score-ring-fill" cx="20" cy="20" r="18" style="stroke:${color};stroke-dasharray:${circ};stroke-dashoffset:${offset}"/></svg><span class="score-number" style="color:${color}">${event.score}</span></div>
            <span class="score-label">Score</span>
        </div>
    </div>`;
}

function placeholderArt(artist, title) {
    const hue = ((artist||'').length * 37 + (title||'').length * 53) % 360;
    return `<div class="album-art-placeholder" style="background:linear-gradient(135deg,hsl(${hue},30%,25%),hsl(${(hue+40)%360},25%,15%))">${(title||'?')[0]}</div>`;
}

// ============================================================
// RENDER: Upcoming
// ============================================================
function renderUpcoming(filter) {
    const container = document.getElementById('upcomingContainer');
    let events = scheduleEvents.map(e => ({...e, ...calculateScore(e)}));
    if (filter === 'top') events = events.filter(e => e.score >= 70);
    else if (filter === 'available') events = events.filter(e => !e.soldOut);
    events.sort((a,b) => { if(a.date!==b.date) return (a.date||'').localeCompare(b.date||''); return b.score-a.score; });

    if (!events.length) { container.innerHTML = '<div class="loading">No events match this filter.</div>'; return; }
    const grouped = {}; events.forEach(e=>{const k=e.date||'x';if(!grouped[k])grouped[k]=[];grouped[k].push(e);});
    let html = '';
    Object.keys(grouped).sort().forEach(date => {
        const d = new Date(date+'T12:00:00');
        const label = isNaN(d)?'Upcoming':d.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'});
        html += `<div class="date-group"><div class="date-header">${label}</div>`;
        grouped[date].forEach(e => { html += renderCard(e); });
        html += '</div>';
    });
    container.innerHTML = html;
}

// ============================================================
// RENDER: Discover
// ============================================================
// Discover pool: a broad, DIVERSE set spanning the full taste spectrum so the
// Vibe sliders (and your history) meaningfully reorder it. Deep/atmospheric
// picks rise for a deep-listener profile; vocal/energetic/pop picks rise if you
// slide the other way. Scored by the same engine as the calendar, with reasons
// generated live — nothing here is hand-ranked. Albums already in your history
// are filtered out at render time.
const discoverAlbums = [
    // --- deep / atmospheric / instrumental ---
    {artist:"Pharoah Sanders",title:"Karma",genres:['spiritual jazz','avant-garde jazz','modal jazz'],description:"Transcendent spiritual jazz. Sanders was Coltrane's protégé."},
    {artist:"Can",title:"Future Days",genres:['krautrock','ambient','experimental','electronic'],description:"Can at their most serene and hypnotic."},
    {artist:"Boards of Canada",title:"Music Has the Right to Children",genres:['ambient','electronic','downtempo'],description:"Nostalgic, sun-bleached electronics."},
    {artist:"Godspeed You! Black Emperor",title:"Lift Your Skinny Fists Like Antennas to Heaven",genres:['post-rock','ambient','experimental'],description:"The emotional peak of post-rock."},
    {artist:"Talk Talk",title:"Spirit of Eden",genres:['post-rock','art rock','ambient','experimental'],description:"Arguably invented post-rock."},
    {artist:"Tangerine Dream",title:"Phaedra",genres:['electronic','ambient','progressive rock'],description:"Proto-ambient electronic prog."},
    {artist:"Nils Frahm",title:"All Melody",genres:['ambient','electronic','classical'],description:"Piano, organ, and synths in a custom studio."},
    {artist:"Stars of the Lid",title:"The Tired Sounds of Stars of the Lid",genres:['ambient','drone','experimental'],description:"Vast, slow-moving ambient drones."},
    {artist:"Brian Eno",title:"Another Green World",genres:['ambient','art rock','experimental'],description:"The blueprint for atmospheric art-rock."},
    {artist:"Bark Psychosis",title:"Hex",genres:['post-rock','art rock','ambient'],description:"Hushed, jazz-touched post-rock."},
    // --- immersive prog / psych / journeys ---
    {artist:"King Crimson",title:"In the Court of the Crimson King",genres:['progressive rock','art rock','experimental'],description:"The album that launched prog rock."},
    {artist:"Spiritualized",title:"Ladies and Gentlemen We Are Floating in Space",genres:['space rock','art rock','experimental'],description:"Symphonic, narcotic space-gospel."},
    {artist:"Kikagaku Moyo",title:"Masana Temples",genres:['psychedelic rock','post-rock'],description:"Japanese psych meets sitar drones and krautrock."},
    {artist:"Miles Davis",title:"Bitches Brew",genres:['jazz','fusion','experimental','psychedelic rock'],description:"Where jazz met rock and exploded."},
    {artist:"Ennio Morricone",title:"The Good, the Bad and the Ugly",genres:['soundtrack','orchestral','cinematic'],description:"Iconic film scoring."},
    // --- grooves / world / funk (mid) ---
    {artist:"Khruangbin",title:"Con Todo El Mundo",genres:['psychedelic rock','funk','instrumental'],description:"Thai funk meets surf rock meets dub."},
    {artist:"Mulatu Astatke",title:"Éthiopiques Vol. 4",genres:['afrobeat','jazz','funk'],description:"The father of Ethio-jazz."},
    {artist:"Mdou Moctar",title:"Afrique Victime",genres:['psychedelic rock','afrobeat','blues rock'],description:"Tuareg guitar at maximum voltage."},
    {artist:"Portishead",title:"Dummy",genres:['trip-hop','downtempo','electronic'],description:"Dark, cinematic trip-hop."},
    // --- vocal-forward / soul / r&b ---
    {artist:"D'Angelo",title:"Voodoo",genres:['neo-soul','r&b','funk'],description:"Loose, deep-pocket neo-soul."},
    {artist:"Marvin Gaye",title:"What's Going On",genres:['soul','r&b','funk'],description:"The landmark soul song-cycle."},
    {artist:"Sade",title:"Love Deluxe",genres:['sophisti-pop','soul','r&b'],description:"Smooth, immaculate late-night soul."},
    {artist:"Frank Ocean",title:"Blonde",genres:['r&b','art pop','alternative r&b'],description:"Fragmented, intimate modern R&B."},
    // --- energetic / pop / danceable ---
    {artist:"Stevie Wonder",title:"Innervisions",genres:['soul','funk','r&b'],description:"Peak-era Stevie: joyful and virtuosic."},
    {artist:"Talking Heads",title:"Remain in Light",genres:['art pop','funk','new wave'],description:"Polyrhythmic, ecstatic art-funk."},
    {artist:"Daft Punk",title:"Discovery",genres:['electronic','french house','disco'],description:"Euphoric, filtered French house."},
    {artist:"Michael Jackson",title:"Off the Wall",genres:['disco','funk','pop','r&b'],description:"The great modern dance-pop record."},
    {artist:"Robyn",title:"Body Talk",genres:['dance-pop','electropop','pop'],description:"Heartbroken bangers, wall to wall."},
];

const DISCOVER_SHOW = 10; // how many top matches to surface

async function renderDiscover() {
    const container = document.getElementById('discoverContainer');

    // Exclude albums already in the user's Shibuya history (no point recommending
    // what they've already heard/rated).
    const heard = new Set(loadFeedback().map(f => `${lc(f.artist)}|${lc(f.album)}`));
    const pool = discoverAlbums.filter(a => !heard.has(`${lc(a.artist)}|${lc(a.title)}`));

    // Give each album axis positions so the Vibe sliders actually move it, then
    // score with the SAME engine as the calendar (history + vibe + genre).
    const scored = pool
        .map(a => ({ ...a, axes: a.axes || axesFromGenres(a.genres), ...calculateScore(a) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, DISCOVER_SHOW);

    // Fetch art only for what we'll actually show
    const artResults = await fetchJSON('/api/album-art-batch', {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({albums:scored.map(a=>({artist:a.artist,album:a.title}))}),
    });
    if(Array.isArray(artResults)){artResults.forEach(r=>{const a=scored.find(x=>x.artist===r.artist&&x.title===r.album);if(a&&r.image){a.image=r.image;a.spotifyUri=r.spotifyUri;}});}

    let html = '<div class="section-header">Albums matched to your vibe — off the calendar</div>';
    scored.forEach(album => {
        const color = getScoreColor(album.score);
        const circ = 2*Math.PI*18, offset = circ-(album.score/100)*circ;
        const link = album.spotifyUri||`spotify:search:${encodeURIComponent(album.artist+' '+album.title)}`;
        const art = album.image?`<img src="${album.image}" alt="">`  :placeholderArt(album.artist,album.title);
        // Live reasons from the scoring engine (falls back to the description)
        const reasonTags = (album.reasons && album.reasons.length)
            ? album.reasons.map(r=>`<span class="match-reason feedback">${r}</span>`).join('')
            : '';
        html += `<div class="card"><a href="${link}" class="album-art-link">${art}</a><div class="card-info"><div class="card-title">${album.title}</div><div class="card-artist">${album.artist}</div><div class="card-desc">${album.description}</div><div class="genre-tags">${album.genres.map(g=>`<span class="genre-tag">${g}</span>`).join('')}</div><div class="match-reasons">${reasonTags}</div></div><div class="score-container"><div class="score-ring"><svg viewBox="0 0 40 40"><circle class="score-ring-bg" cx="20" cy="20" r="18"/><circle class="score-ring-fill" cx="20" cy="20" r="18" style="stroke:${color};stroke-dasharray:${circ};stroke-dashoffset:${offset}"/></svg><span class="score-number" style="color:${color}">${album.score}</span></div><span class="score-label">Score</span></div></div>`;
    });
    container.innerHTML = html;
}

// ============================================================
// RENDER: History
// ============================================================
async function renderHistory() {
    const container = document.getElementById('historyContainer');
    const feedback = loadFeedback();
    const ratingEmojis = {5:'🤯',4:'🔥',3:'👍',2:'😐',1:'👎'};
    const ratingLabels = {5:'Mind-blown',4:'Loved it',3:'Good',2:'Meh',1:'Not for me'};

    // Load art for history
    await loadAllHistoryArt();

    let sorted = [...feedback].map((e,i)=>({...e,_idx:i}));
    if (historySort==='alpha') sorted.sort((a,b)=>a.artist.localeCompare(b.artist));
    else sorted.sort((a,b)=>b.rating-a.rating||a.artist.localeCompare(b.artist));

    let html = `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0 12px"><span style="font-size:0.65rem;color:var(--text-secondary)">${feedback.length} sessions</span><div style="display:flex;gap:6px"><button class="sort-btn ${historySort==='rating'?'active':''}" data-sort="rating">By Rating</button><button class="sort-btn ${historySort==='alpha'?'active':''}" data-sort="alpha">A–Z</button></div></div>`;

    sorted.forEach(entry => {
        const cached = historyArtCache[`${entry.artist}|${entry.album}`];
        const spotifyLink = cached?.spotifyUri || `spotify:search:${encodeURIComponent(entry.artist+' '+entry.album)}`;
        const art = cached?.image ? `<img src="${cached.image}" alt="">` : placeholderArt(entry.artist, entry.album);

        html += `<div class="card"><a href="${spotifyLink}" class="album-art-link">${art}</a><div class="card-info"><div class="card-title">${entry.album}</div><div class="card-artist">${entry.artist}</div><div class="rating-row">${[1,2,3,4,5].map(r=>`<button class="rating-btn ${entry.rating===r?'selected':''}" data-idx="${entry._idx}" data-r="${r}">${ratingEmojis[r]}</button>`).join('')}<span class="rating-label">${ratingLabels[entry.rating]}</span><button class="delete-btn" data-idx="${entry._idx}" title="Remove">✕</button></div></div></div>`;
    });

    html += '<button class="add-session-btn" id="addBtn">+ Add a session I attended</button>';
    container.innerHTML = html;

    container.querySelectorAll('.sort-btn').forEach(b=>b.addEventListener('click',()=>{historySort=b.dataset.sort;renderHistory();}));
    container.querySelectorAll('.rating-btn').forEach(b=>b.addEventListener('click',()=>{const d=loadFeedback();d[parseInt(b.dataset.idx)].rating=parseInt(b.dataset.r);saveFeedback(d);renderHistory();renderUpcoming(getCurrentFilter());renderDiscover();}));
    container.querySelectorAll('.delete-btn').forEach(b=>b.addEventListener('click',()=>{if(!confirm('Remove this session?'))return;const d=loadFeedback();d.splice(parseInt(b.dataset.idx),1);saveFeedback(d);renderHistory();renderUpcoming(getCurrentFilter());}));

    document.getElementById('addBtn')?.addEventListener('click', async ()=>{
        const input = prompt('Artist and album (e.g. "led zepelin houses of the holy"):');
        if(!input) return;
        const rating = parseInt(prompt('Rating (1-5):')||'3');

        // Resolve via Spotify
        const resolved = await fetchJSON(`/api/resolve-album?q=${encodeURIComponent(input)}`);
        let artist = resolved?.artist, album = resolved?.album, genres = resolved?.genres || [];

        if (!artist || !album) {
            const parts = input.split(/\s*[-–]\s*/);
            artist = parts[0]?.trim() || input;
            album = parts.length > 1 ? parts.slice(1).join(' - ').trim() : input;
        }
        if (!genres.length) genres = ['unknown'];

        const d = loadFeedback();
        d.push({artist, album, genres, rating: Math.max(1,Math.min(5,rating))});
        saveFeedback(d);
        renderHistory(); renderUpcoming(getCurrentFilter());
    });
}

// ============================================================
// FEEDBACK PERSISTENCE
// ============================================================
// History belongs to the logged-in Spotify account and lives SERVER-SIDE, so it
// follows the user across devices. localStorage is only a synchronous local
// cache: loadFeedback() reads it (keeping every call site simple), saveFeedback()
// writes it AND pushes to the server. On login we pull the server copy first.
let serverHistoryLoaded = false; // true once we've synced from the server this session

function loadFeedback(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY))||[];}catch{return[];}}

function saveFeedback(d){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    // Push to server when authenticated (fire-and-forget; local cache is source
    // of truth for this tab, server is the cross-device record).
    if (isAuthenticated) {
        fetch('/api/history', {
            method:'PUT', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ history: d }),
        }).catch(()=>{});
    }
}

// Pull the user's server-side history into the local cache after login. Server
// is authoritative on load, so a fresh device/browser shows their real history.
async function syncHistoryFromServer(){
    const resp = await fetchJSON('/api/history');
    if (resp && Array.isArray(resp.history)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(resp.history));
        serverHistoryLoaded = true;
        return true;
    }
    return false;
}

// ============================================================
// LISTENING-INTENT PREFERENCES  { axisKey: -1..1 }  (0 = no preference)
// ============================================================
function loadPreferences(){try{return JSON.parse(localStorage.getItem(PREFS_KEY))||{};}catch{return{};}}
function savePreferences(p){localStorage.setItem(PREFS_KEY,JSON.stringify(p));}
function hasPreferences(){return Object.values(loadPreferences()).some(v=>Math.abs(v)>0.05);}

// Infer a starting axis profile from rated history: position the user where
// their liked albums cluster on each axis. Each album's axis position is
// weighted by (rating-3) — 5-star albums pull hardest toward their pole,
// 1-star albums push away. The result is a weighted-average position per axis.
function inferPreferencesFrom(items){
    // items: [{ axes:{axisKey:-1..1}, rating }]
    const num = {}, den = {};
    (axisVocab.length ? axisVocab.map(a => a.key) : []).forEach(k => { num[k] = 0; den[k] = 0; });
    items.forEach(it => {
        const w = (it.rating != null ? it.rating : 4) - 3; // 5→+2 … 3→0 … 1→−2
        if (w === 0 || !it.axes) return;
        Object.keys(num).forEach(k => {
            const pos = typeof it.axes[k] === 'number' ? it.axes[k] : 0;
            // A liked album (w>0) pulls the profile toward its position; a
            // disliked album (w<0) pulls toward the OPPOSITE position.
            num[k] += w * pos;
            den[k] += Math.abs(w);
        });
    });
    // Per-album axis positions are deliberately conservative (derived + capped),
    // and averaging flattens them further. A gain factor sharpens a consistent
    // lean into a decisive preference (then clamp to [-1,1]).
    const GAIN = 2.2;
    const prefs = {};
    Object.keys(num).forEach(k => {
        if (den[k] > 0) {
            const v = Math.max(-1, Math.min(1, (num[k] / den[k]) * GAIN));
            if (Math.abs(v) > 0.05) prefs[k] = Math.round(v * 100) / 100;
        }
    });
    return prefs;
}

// Build inference items from rated history, using each album's axis positions
// (derived from its genres, mirroring the server).
function preferenceItemsFromHistory(){
    return loadFeedback().map(f => ({ axes: axesFromGenres(f.genres || []), rating: f.rating }));
}

// On first run only, pre-fill the sliders from the user's rated history. If they
// have no history, leave prefs empty (all sliders centered = neutral scoring).
function maybeSeedPreferences(){
    if (localStorage.getItem(PREFS_KEY) !== null) return; // already set (even if empty)
    const fb = loadFeedback();
    if (!fb.length) return;
    savePreferences(inferPreferencesFrom(preferenceItemsFromHistory()));
}

// Wire up the preferences panel: toggle button, sliders, reset.
function setupPreferences(){
    const btn = document.getElementById('prefsBtn');
    const panel = document.getElementById('prefsPanel');
    if (!btn || !panel) return;
    btn.addEventListener('click', () => {
        panel.classList.toggle('open');
        if (panel.classList.contains('open')) renderPreferences();
    });
}

function renderPreferences(){
    const body = document.getElementById('prefsBody');
    if (!body) return;
    const prefs = loadPreferences();
    const intro = `<p class="prefs-intro">Slide toward whichever side fits how you want to listen at Shibuya. Leave a slider centered if you don't care about that quality. Hover a label to see what it means.</p>`;
    const rows = axisVocab.map(ax => {
        const val = Math.round((prefs[ax.key] || 0) * 100); // -100..100
        return `<div class="axis-row" title="${ax.tip.replace(/"/g,'&quot;')}">
            <div class="axis-poles">
                <span class="axis-pole left">${ax.left.label}</span>
                <span class="axis-pole right">${ax.right.label}</span>
            </div>
            <input type="range" min="-100" max="100" step="10" value="${val}" data-axis="${ax.key}" class="axis-slider">
            <div class="axis-examples"><span>${ax.left.examples}</span><span>${ax.right.examples}</span></div>
        </div>`;
    }).join('');
    body.innerHTML = intro + rows + `<div class="pref-actions">
        <button id="prefsReset" class="pref-btn-secondary">Reset from my ratings</button>
    </div>`;

    body.querySelectorAll('.axis-slider').forEach(sl => {
        sl.addEventListener('input', () => {
            const p = loadPreferences();
            const v = parseInt(sl.value) / 100; // -1..1
            if (Math.abs(v) > 0.05) p[sl.dataset.axis] = v; else delete p[sl.dataset.axis];
            savePreferences(p);
            renderUpcoming(getCurrentFilter()); renderDiscover(); // live rescore
        });
    });
    document.getElementById('prefsReset')?.addEventListener('click', () => {
        savePreferences(inferPreferencesFrom(preferenceItemsFromHistory()));
        renderPreferences();
        renderUpcoming(getCurrentFilter()); renderDiscover();
    });
}

// (No default seed — every user starts with an empty My History and builds
// their own. History is loaded from the server for logged-in users.)

// ============================================================
// NAVIGATION
// ============================================================
function setupNavigation() {
    document.querySelectorAll('.nav-tab').forEach(tab=>{tab.addEventListener('click',()=>{document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));tab.classList.add('active');document.getElementById(`view-${tab.dataset.view}`).classList.add('active');
        // Sub-tab filter bar lives in the sticky header, so toggle it with the view
        document.getElementById('upcomingFilters').classList.toggle('active', tab.dataset.view==='upcoming');
        window.scrollTo(0,0);});});
    document.querySelectorAll('.filter-tab').forEach(tab=>{tab.addEventListener('click',()=>{document.querySelectorAll('.filter-tab').forEach(t=>t.classList.remove('active'));tab.classList.add('active');renderUpcoming(tab.dataset.filter);});});
}
function getCurrentFilter(){return document.querySelector('.filter-tab.active')?.dataset.filter||'all';}

// ============================================================
// GUIDED TOUR (coach marks) — points out the 3 key features with a benefit
// + call-to-action. Auto-shows once for new visitors; replayable via the "?".
// ============================================================
const TOUR_SEEN_KEY = 'my-shibuya-tour-seen';
const TOUR_STEPS = [
    {
        target: '#spotifyBadge',
        title: 'Connect Spotify',
        body: 'We read who you follow, your top artists, and your library to tailor every score to your taste.',
        cta: '→ Tap to connect — it takes 5 seconds.',
    },
    {
        target: '[data-view="history"]',
        title: 'Rate what you\'ve heard',
        body: 'Your strongest signal: add albums you\'ve caught at Shibuya and rate them. A great (or bad) rating shapes future picks more than anything else — and it follows you to any device.',
        cta: '→ Open My History and add a session.',
    },
    {
        target: '#prefsBtn',
        title: 'Set your Vibe',
        body: 'Slide toward how you like to listen — immersive & instrumental, or vocal & upbeat. Scores and Discover update instantly to match.',
        cta: '→ Tap Vibe and try the sliders.',
    },
];
let tourIndex = 0;

function setupTour() {
    document.getElementById('helpBtn')?.addEventListener('click', () => startTour());
    document.getElementById('tourNext')?.addEventListener('click', () => {
        tourIndex++;
        if (tourIndex >= TOUR_STEPS.length) endTour(); else showTourStep();
    });
    document.getElementById('tourSkip')?.addEventListener('click', endTour);
    document.getElementById('tourOverlay')?.addEventListener('click', (e) => {
        if (e.target.id === 'tourOverlay') endTour(); // click backdrop to dismiss
    });
    window.addEventListener('resize', () => {
        if (document.getElementById('tourOverlay')?.classList.contains('active')) positionTour();
    });
    // Auto-show once for first-time visitors
    if (!localStorage.getItem(TOUR_SEEN_KEY)) startTour();
}

function startTour() {
    tourIndex = 0;
    document.getElementById('tourOverlay').classList.add('active');
    // Render the progress dots once
    const dots = document.getElementById('tourDots');
    dots.innerHTML = TOUR_STEPS.map((_, i) => `<span class="tour-dot" data-i="${i}"></span>`).join('');
    showTourStep();
}

function showTourStep() {
    const step = TOUR_STEPS[tourIndex];
    document.getElementById('tourTitle').textContent = step.title;
    document.getElementById('tourBody').textContent = step.body;
    document.getElementById('tourCta').textContent = step.cta;
    document.getElementById('tourNext').textContent = (tourIndex === TOUR_STEPS.length - 1) ? 'Got it' : 'Next';
    document.querySelectorAll('.tour-dot').forEach((d, i) => d.classList.toggle('active', i === tourIndex));
    positionTour();
}

function positionTour() {
    const step = TOUR_STEPS[tourIndex];
    const el = document.querySelector(step.target);
    const ring = document.getElementById('tourRing');
    const bubble = document.getElementById('tourBubble');
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 6;
    // Spotlight ring around the target
    ring.style.left = `${r.left - pad}px`;
    ring.style.top = `${r.top - pad}px`;
    ring.style.width = `${r.width + pad * 2}px`;
    ring.style.height = `${r.height + pad * 2}px`;
    // Bubble below the target (or above if too low), clamped to viewport
    const bw = Math.min(280, window.innerWidth - 24);
    bubble.style.width = `${bw}px`;
    let left = Math.min(Math.max(12, r.left + r.width / 2 - bw / 2), window.innerWidth - bw - 12);
    let top = r.bottom + 14;
    // Measure height after positioning width
    const bh = bubble.offsetHeight || 160;
    if (top + bh > window.innerHeight - 12) top = Math.max(12, r.top - bh - 14);
    bubble.style.left = `${left}px`;
    bubble.style.top = `${top}px`;
}

function endTour() {
    document.getElementById('tourOverlay')?.classList.remove('active');
    localStorage.setItem(TOUR_SEEN_KEY, '1');
}

// GO
init();
