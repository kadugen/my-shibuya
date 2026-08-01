// ============================================================
// GENRE MAP
//
// Spotify DEPRECATED the `genres` field on artist objects in 2024, so we can no
// longer read an artist's genres from the API. To give live-scraped calendar
// events real genres (which the scoring algorithm depends on), we maintain a
// curated artist -> genres map, keyed by lowercased artist name.
//
// Covers every artist currently on the Shibuya calendar plus common repeats.
// Unknown artists fall back to keyword inference from the album/title text.
// ============================================================

const ARTIST_GENRES = {
    // --- Currently on the Shibuya calendar ---
    'audioslave': ['alternative rock', 'hard rock', 'grunge'],
    'beastie boys': ['hip-hop', 'rap rock', 'alternative'],
    'billie holiday': ['jazz', 'vocal jazz', 'blues'],
    'cigarettes after sex': ['dream pop', 'ambient pop', 'shoegaze'],
    'coltrane in mono': ['jazz', 'modal jazz', 'spiritual jazz'],
    'daft punk': ['electronic', 'french house', 'disco', 'funk'],
    'digable planets': ['hip-hop', 'jazz rap', 'alternative hip-hop'],
    'eden': ['indie pop', 'electronic', 'alternative'],
    'fleetwood mac': ['classic rock', 'soft rock', 'pop rock'],
    'frank ocean': ['r&b', 'art pop', 'alternative r&b', 'experimental'],
    "howlin' wolf": ['blues', 'chicago blues', 'electric blues'],
    'jack white': ['garage rock', 'blues rock', 'alternative rock'],
    'jeff buckley': ['alternative rock', 'art rock', 'singer-songwriter'],
    'john coltrane': ['jazz', 'spiritual jazz', 'modal jazz', 'avant-garde jazz'],
    'jungle': ['funk', 'electronic', 'neo-soul', 'disco'],
    'kiss': ['hard rock', 'glam rock', 'arena rock'],
    'kamasi washington': ['spiritual jazz', 'jazz', 'fusion'],
    'kendrick lamar': ['hip-hop', 'conscious hip-hop', 'jazz rap'],
    'khruangbin and leon bridges': ['psychedelic soul', 'funk', 'r&b', 'instrumental'],
    'khruangbin': ['psychedelic rock', 'funk', 'instrumental', 'dub'],
    'lana del rey': ['art pop', 'baroque pop', 'indie pop'],
    'led zeppelin': ['hard rock', 'blues rock', 'classic rock'],
    'loscil': ['ambient', 'electronic', 'drone', 'experimental'],
    'mac miller': ['hip-hop', 'jazz rap', 'neo-soul'],
    'madonna': ['pop', 'dance-pop', 'electronic'],
    'nas': ['hip-hop', 'east coast hip-hop', 'jazz rap'],
    'oliver nelson': ['jazz', 'hard bop', 'modal jazz'],
    'pink floyd': ['progressive rock', 'art rock', 'psychedelic rock'],
    'portishead': ['trip-hop', 'downtempo', 'electronic'],
    'ray charles': ['soul', 'r&b', 'blues', 'jazz'],
    'richard strauss': ['classical', 'orchestral'],
    'richard strauss, also sprach zarathustra, chicago symphony orchestra, fritz reiner': ['classical', 'orchestral'],
    'rosalía': ['avant-pop', 'art pop', 'flamenco', 'experimental'],
    'ryuichi sakamoto': ['ambient', 'classical', 'electronic', 'experimental'],
    'ryuichi sakamoto- beauty': ['ambient', 'classical', 'electronic', 'experimental'],
    'solange': ['r&b', 'neo-soul', 'art pop'],
    'steely dan': ['jazz rock', 'soft rock', 'yacht rock', 'fusion'],
    'stevie wonder': ['soul', 'funk', 'r&b', 'jazz'],
    'tame impala': ['psychedelic rock', 'synth-pop', 'electronic'],
    'the beatles': ['psychedelic rock', 'art rock', 'pop rock', 'experimental'],
    'the strokes': ['indie rock', 'garage rock', 'post-punk revival'],
    'the who': ['classic rock', 'hard rock', 'rock opera'],
    'thundercat': ['jazz fusion', 'funk', 'r&b', 'electronic'],
    'tom petty': ['classic rock', 'heartland rock', 'rock'],
    'tori amos': ['art rock', 'singer-songwriter', 'piano rock', 'alternative'],
    'tortoise': ['post-rock', 'jazz', 'electronic', 'instrumental', 'experimental'],
    'wire': ['post-punk', 'punk', 'art punk', 'new wave'],
    'wolf alice': ['alternative rock', 'indie rock', 'dream pop'],

    // --- Newer additions on the calendar ---
    "d’angelo": ['neo-soul', 'r&b', 'funk', 'soul'],
    "d'angelo": ['neo-soul', 'r&b', 'funk', 'soul'],
    'nirvana': ['grunge', 'alternative rock', 'punk'],
    'sza': ['r&b', 'alternative r&b', 'neo-soul'],
    'lauryn hill': ['neo-soul', 'r&b', 'hip-hop'],
    'a tribe called quest': ['hip-hop', 'jazz rap', 'alternative hip-hop'],
    'mike d': ['hip-hop', 'alternative'],
    'tatsuro yamashida': ['city pop', 'funk', 'soul'],
    'tatsuro yamashita': ['city pop', 'funk', 'soul'],
    'olivia dean': ['soul', 'r&b', 'pop'],
    'oklou': ['art pop', 'electronic', 'ambient pop'],
    'american football': ['emo', 'midwest emo', 'indie rock'],
    'raye': ['r&b', 'pop', 'soul'],
    'julia wolf': ['alt-pop', 'electropop'],
    'van halen': ['hard rock', 'heavy metal', 'arena rock'],
    'metallica': ['thrash metal', 'heavy metal', 'metal'],
    'nina simone': ['jazz', 'soul', 'vocal jazz'],
    'sam cooke': ['soul', 'r&b', 'gospel'],
    'marvin gaye': ['soul', 'r&b', 'funk'],
    'sonny rollins': ['jazz', 'hard bop', 'bebop'],
    'steely dan': ['jazz rock', 'yacht rock', 'soft rock', 'fusion'],
    'peter gabriel': ['art rock', 'progressive rock', 'worldbeat'],
    'prince': ['funk', 'pop', 'r&b', 'rock'],
    'u2': ['rock', 'post-punk', 'art rock'],
    'the beatles': ['psychedelic rock', 'art rock', 'pop rock', 'experimental'],
    'cocteau twins': ['dream pop', 'ethereal wave', 'shoegaze'],
    'king gizzard and the lizard wizard': ['psychedelic rock', 'garage rock', 'progressive rock'],
    'philip glass': ['classical', 'minimalism', 'contemporary classical'],
    'dj shadow': ['trip-hop', 'instrumental hip-hop', 'electronic'],

    // --- Common Shibuya repeats / discover artists ---
    'miles davis': ['jazz', 'fusion', 'modal jazz'],
    'alice coltrane': ['spiritual jazz', 'modal jazz', 'ambient'],
    'fela kuti': ['afrobeat', 'funk', 'jazz'],
    'herbie hancock': ['jazz', 'fusion', 'funk'],
    'radiohead': ['alternative rock', 'art rock', 'electronic'],
    'massive attack': ['trip-hop', 'electronic', 'downtempo'],
    'sigur rós': ['post-rock', 'ambient', 'art rock'],
    'floating points': ['ambient', 'electronic', 'spiritual jazz'],
    'the mars volta': ['progressive rock', 'experimental'],
    'tool': ['progressive rock', 'progressive metal', 'art rock'],
    'tom waits': ['experimental', 'blues', 'alternative'],
    'gorillaz': ['alternative rock', 'electronic', 'hip-hop'],
    'air': ['electronic', 'downtempo', 'dream pop'],
    'st. germain': ['electronic', 'jazz', 'house', 'deep house'],
    'black sabbath': ['heavy metal', 'hard rock', 'doom metal'],
    'thom yorke': ['electronic', 'art rock', 'experimental'],
    'daft punk': ['electronic', 'french house', 'disco', 'funk'],
};

// Keyword fallback for artists not in the map
const KEYWORD_GENRES = [
    ['jazz', 'jazz'], ['blues', 'blues'], ['soul', 'soul'], ['funk', 'funk'],
    ['ambient', 'ambient'], ['electronic', 'electronic'], ['punk', 'punk'],
    ['classical', 'classical'], ['metal', 'metal'], ['psychedelic', 'psychedelic rock'],
    ['prog', 'progressive rock'], ['post-rock', 'post-rock'], ['trip-hop', 'trip-hop'],
    ['grunge', 'grunge'], ['hip-hop', 'hip-hop'], ['rap', 'hip-hop'], ['rock', 'rock'],
];

const lc = s => (s || '').toLowerCase().trim();

// Return curated genres for an artist, falling back to keyword inference
function genresForEvent(artist, album) {
    const key = lc(artist);
    if (ARTIST_GENRES[key]) return ARTIST_GENRES[key];

    // Try a looser match (e.g. long orchestral titles that start with the artist)
    for (const mapKey of Object.keys(ARTIST_GENRES)) {
        if (key.startsWith(mapKey) || mapKey.startsWith(key)) return ARTIST_GENRES[mapKey];
    }

    // Keyword inference from artist + album text
    const text = `${lc(album)} ${lc(artist)}`;
    const inferred = [];
    for (const [kw, genre] of KEYWORD_GENRES) {
        if (text.includes(kw) && !inferred.includes(genre)) inferred.push(genre);
    }
    return inferred.length ? inferred : ['rock'];
}

module.exports = { genresForEvent, ARTIST_GENRES };
