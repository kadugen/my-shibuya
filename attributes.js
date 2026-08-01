// ============================================================
// SONIC ATTRIBUTES ("listening intent")
//
// A hi-fi listening room like Shibuya is a *destination* experience — what you
// want there (immersive, atmospheric, journey-like records for vintage
// Klipschorns) is only loosely related to what you stream day-to-day. Analysis
// of the rating history showed genre barely predicts enjoyment (correlation
// ~0), while these sonic attributes correlate ~0.68. So the score leans on
// attribute-match against the listener's stated/inferred preferences.
//
// Vocabulary (12):
//   immersive     one continuous journey; cohesive front-to-back
//   atmospheric   textural, spacious, ambient washes
//   cinematic     epic, filmic, orchestral scope
//   dynamic       wide dynamic range, quiet↔loud contrast
//   longform      long tracks / sprawling runtime
//   production    audiophile production; a stereo-imaging showcase
//   instrumental  mood/texture over lyrics
//   hypnotic      repetitive, krautrock/drone, trance-groove
//   warm          vintage/analog/tape warmth
//   melancholic   emotional, wistful, bittersweet
//   meditative    calm, contemplative, slow-burning
//   build         crescendo/swell; post-rock quiet-to-overwhelming
// ============================================================

const ATTRIBUTES = [
    'immersive', 'atmospheric', 'cinematic', 'dynamic', 'longform', 'production',
    'instrumental', 'hypnotic', 'warm', 'melancholic', 'meditative', 'build',
];

const ATTR_LABELS = {
    immersive: 'Immersive journey',
    atmospheric: 'Atmospheric',
    cinematic: 'Cinematic',
    dynamic: 'Dynamic range',
    longform: 'Long-form',
    production: 'Audiophile production',
    instrumental: 'Instrumental',
    hypnotic: 'Hypnotic',
    warm: 'Warm / analog',
    melancholic: 'Melancholic',
    meditative: 'Meditative',
    build: 'Builds / crescendos',
};

const lc = s => (s || '').toLowerCase().trim();
const key = (artist, album) => `${lc(artist)}|${lc(album)}`;

// Curated per-album attributes (calendar + rating history). Keyed "artist|album".
const ALBUM_ATTRIBUTES = {
    // --- rating-history albums (used to validate the model) ---
    'miles davis|in a silent way': ['immersive', 'atmospheric', 'hypnotic', 'instrumental', 'longform', 'meditative', 'warm'],
    'miles davis|kind of blue': ['immersive', 'atmospheric', 'instrumental', 'warm', 'meditative'],
    'alice coltrane|journey in satchidananda': ['immersive', 'atmospheric', 'instrumental', 'hypnotic', 'cinematic', 'meditative'],
    'sigur rós|ágætis byrjun': ['immersive', 'atmospheric', 'cinematic', 'dynamic', 'build', 'melancholic'],
    'radiohead|ok computer': ['immersive', 'atmospheric', 'production', 'cinematic', 'dynamic', 'melancholic'],
    'radiohead|in rainbows': ['immersive', 'atmospheric', 'production', 'warm'],
    'radiohead|kid a': ['immersive', 'atmospheric', 'production', 'hypnotic', 'melancholic'],
    'floating points|promises': ['immersive', 'atmospheric', 'longform', 'instrumental', 'dynamic', 'meditative', 'build'],
    'tame impala|currents': ['production', 'immersive', 'atmospheric', 'warm'],
    'led zeppelin|ii': ['dynamic', 'production', 'warm'],
    'led zeppelin|iv': ['dynamic', 'production', 'warm', 'build'],
    'pink floyd|dark side of the moon': ['immersive', 'atmospheric', 'production', 'cinematic', 'dynamic', 'longform'],
    'pink floyd|dark side of the moon (2023 remaster)': ['immersive', 'atmospheric', 'production', 'cinematic', 'dynamic', 'longform'],
    'pink floyd|wish you were here': ['immersive', 'atmospheric', 'production', 'longform', 'melancholic', 'build'],
    'pink floyd|animals': ['immersive', 'longform', 'production', 'dynamic'],
    'pink floyd|the wall': ['immersive', 'cinematic', 'longform', 'dynamic', 'production'],
    'pink floyd|meddle': ['immersive', 'atmospheric', 'longform', 'hypnotic', 'build'],
    'massive attack|mezzanine': ['immersive', 'atmospheric', 'production', 'hypnotic', 'melancholic'],
    'the mars volta|frances the mute': ['immersive', 'dynamic', 'longform', 'cinematic', 'build'],
    'john coltrane|a love supreme': ['immersive', 'instrumental', 'longform', 'dynamic', 'meditative'],
    'fela kuti|london scene': ['hypnotic', 'longform', 'instrumental', 'warm'],
    'tom waits|mule variations': ['production', 'warm'],
    'kamasi washington|the epic': ['immersive', 'cinematic', 'longform', 'instrumental', 'build'],
    'thom yorke|the eraser': ['atmospheric', 'production', 'hypnotic', 'melancholic'],
    'herbie hancock|head hunters': ['hypnotic', 'instrumental', 'warm'],
    'daft punk|random access memories': ['production', 'warm'],
    'tool|lateralus': ['dynamic', 'longform', 'build'],
    'gorillaz|demon days': ['production'],
    'air|moon safari': ['atmospheric', 'production', 'instrumental', 'warm'],

    // --- current calendar standouts ---
    'talk talk|spirit of eden': ['immersive', 'atmospheric', 'dynamic', 'instrumental', 'meditative', 'build', 'melancholic'],
    'portishead|dummy': ['immersive', 'atmospheric', 'production', 'hypnotic', 'melancholic', 'warm'],
    'loscil|lake fire': ['atmospheric', 'immersive', 'hypnotic', 'instrumental', 'meditative', 'longform'],
    'philip glass|glassworks': ['hypnotic', 'instrumental', 'meditative', 'immersive', 'build'],
    'ryuichi sakamoto|beauty': ['atmospheric', 'instrumental', 'cinematic', 'meditative', 'warm'],
    'dj shadow|endtroducing': ['immersive', 'atmospheric', 'hypnotic', 'instrumental', 'production'],
    'cocteau twins|heaven or las vegas': ['atmospheric', 'immersive', 'production', 'melancholic', 'build'],
    'marvin gaye|what\'s going on': ['immersive', 'warm', 'production', 'melancholic'],
    'miles davis|kind of blue ': ['immersive', 'atmospheric', 'instrumental', 'warm', 'meditative'],
    'herbie hancock|mwandishi': ['atmospheric', 'hypnotic', 'instrumental', 'longform', 'immersive'],
    'the who|who\'s next': ['dynamic', 'production', 'build', 'warm'],
    'pink floyd|dark side of the moon (live)': ['immersive', 'atmospheric', 'production', 'cinematic', 'longform'],
    'frank ocean|blonde': ['atmospheric', 'immersive', 'production', 'melancholic', 'warm'],
    'frank ocean|channel orange': ['immersive', 'production', 'warm', 'melancholic'],
    'jeff buckley|grace': ['dynamic', 'immersive', 'melancholic', 'build', 'warm'],
    'nina simone|silk and soul': ['warm', 'instrumental', 'melancholic', 'immersive'],
    'billie holiday|lady in satin': ['warm', 'melancholic', 'instrumental', 'immersive'],
    'sam cooke|night beat': ['warm', 'melancholic', 'immersive', 'instrumental'],
    'peter gabriel|so': ['production', 'dynamic', 'cinematic', 'warm'],
    'u2|the unforgettable fire': ['atmospheric', 'immersive', 'build', 'cinematic'],
    'prince|purple rain': ['dynamic', 'production', 'cinematic', 'build'],
    'stevie wonder|talking book': ['warm', 'production', 'immersive'],
    'steely dan|aja': ['production', 'warm', 'immersive', 'instrumental'],
    'oliver nelson|the blues and the abstract truth': ['instrumental', 'warm', 'immersive'],
    'sonny rollins|way out west': ['instrumental', 'warm', 'dynamic'],
    'king gizzard and the lizard wizard|omnium gatherium': ['hypnotic', 'longform', 'dynamic', 'build'],
    'khruangbin and leon bridges|texas sun/texas moon': ['warm', 'atmospheric', 'instrumental', 'meditative'],

    // --- remainder of the current calendar (hand-curated) ---
    'rosalía|lux': ['cinematic', 'dynamic', 'production', 'immersive', 'build'],
    'the strokes|is this it': ['warm', 'production'],
    'audioslave|audioslave': ['dynamic', 'production'],
    'the beatles|revolver': ['immersive', 'production', 'warm', 'psychedelic'],
    'the beatles|let it be': ['warm', 'immersive', 'production'],
    'tori amos|little earthquakes': ['dynamic', 'melancholic', 'immersive', 'build'],
    'kiss|alive': ['dynamic', 'production'],
    'wire|pink flag': ['dynamic'],
    'richard strauss|also sprach zarathustra, chicago symphony orchestra, fritz reiner': ['cinematic', 'dynamic', 'instrumental', 'immersive', 'build'],
    'beastie boys|the in sound from way out': ['instrumental', 'warm', 'hypnotic'],
    'coltrane in mono|john coltrane - my favorite things': ['instrumental', 'immersive', 'longform', 'meditative', 'warm'],
    'solange|a seat at the table': ['atmospheric', 'immersive', 'production', 'warm', 'melancholic'],
    'wolf alice|blue weekend': ['dynamic', 'atmospheric', 'build', 'production'],
    'jack white|frozen charlotte': ['dynamic', 'production'],
    'mac miller|watching movies with the sound off': ['atmospheric', 'melancholic', 'production', 'warm'],
    'nas|ilmatic': ['warm', 'production'],
    'fleetwood mac|rumours': ['warm', 'production', 'immersive'],
    'cigarettes after sex|cigarettes after sex': ['atmospheric', 'immersive', 'melancholic', 'hypnotic', 'meditative'],
    'tom petty|wildflowers': ['warm', 'production', 'immersive'],
    'jungle|sunshine': ['warm', 'hypnotic', 'production'],
    'kamasi washington|the epic volume ii': ['immersive', 'cinematic', 'longform', 'instrumental', 'build'],
    'digable planets|blowout combo': ['warm', 'hypnotic', 'instrumental', 'atmospheric'],
    'lana del rey|norman fucking rockwell': ['cinematic', 'melancholic', 'atmospheric', 'immersive', 'longform'],
    'thundercat|drunk': ['warm', 'instrumental', 'production', 'atmospheric'],
    'eden|dark': ['atmospheric', 'melancholic', 'production'],
    "howlin' wolf|the real folk blues": ['warm', 'instrumental'],
    'madonna|confessions ii': ['production', 'hypnotic'],
    'kendrick lamar|good kid, m.a.a.d. city': ['immersive', 'cinematic', 'production', 'longform'],
    'ray charles|modern sounds in country and western music': ['warm', 'immersive', 'instrumental'],
    "the who|live at leeds": ['dynamic', 'warm', 'build'],
    'the who|who\'s next': ['dynamic', 'production', 'build', 'warm'],
    'van halen|van halen': ['dynamic', 'production'],
    'metallica|ride the lightning': ['dynamic', 'build', 'longform'],
    'olivia dean|the art of loving': ['warm', 'production', 'melancholic'],
    'oklou|choke enough': ['atmospheric', 'production', 'melancholic', 'immersive'],
    'american football|american football': ['atmospheric', 'melancholic', 'immersive', 'build', 'warm'],
    'raye|this music may contain hope': ['production', 'dynamic', 'warm'],
    'sza|ctrl': ['atmospheric', 'production', 'melancholic', 'warm'],
    'd’angelo|voodoo': ['warm', 'immersive', 'hypnotic', 'instrumental', 'production'],
    "d'angelo|voodoo": ['warm', 'immersive', 'hypnotic', 'instrumental', 'production'],
    'julia wolf|pressure': ['production', 'melancholic'],
    'lauryn hill|the miseducation of lauryn hill': ['warm', 'immersive', 'production', 'melancholic'],
    'nirvana|in utero': ['dynamic', 'build', 'production'],
    'mike d|thank you': ['warm', 'production', 'instrumental'],
    'a tribe called quest|the low end theory': ['warm', 'hypnotic', 'instrumental', 'immersive'],
    'tatsuro yamashida|for you': ['warm', 'production', 'immersive'],
    'daft punk|discovery': ['production', 'warm', 'immersive', 'hypnotic'],
    'gorillaz|the mountain': ['production', 'atmospheric'],
    'gorillaz|demon days': ['production', 'cinematic'],
};

// Genre-based inference for albums not individually curated. Maps a genre
// keyword to attributes it typically implies. Multiple genres accumulate.
const GENRE_ATTRIBUTES = {
    'ambient': ['atmospheric', 'immersive', 'instrumental', 'meditative', 'hypnotic'],
    'drone': ['atmospheric', 'hypnotic', 'meditative', 'longform'],
    'post-rock': ['atmospheric', 'immersive', 'dynamic', 'build', 'instrumental'],
    'progressive rock': ['immersive', 'longform', 'dynamic', 'cinematic'],
    'art rock': ['immersive', 'atmospheric', 'production'],
    'psychedelic rock': ['immersive', 'hypnotic', 'atmospheric', 'warm'],
    'krautrock': ['hypnotic', 'immersive', 'longform', 'instrumental'],
    'spiritual jazz': ['immersive', 'instrumental', 'meditative', 'longform', 'build'],
    'modal jazz': ['instrumental', 'immersive', 'meditative', 'warm'],
    'jazz': ['instrumental', 'warm', 'immersive'],
    'fusion': ['instrumental', 'dynamic', 'longform'],
    'trip-hop': ['atmospheric', 'hypnotic', 'production', 'melancholic'],
    'downtempo': ['atmospheric', 'hypnotic', 'meditative'],
    'electronic': ['production', 'hypnotic', 'atmospheric'],
    'classical': ['cinematic', 'instrumental', 'dynamic', 'immersive'],
    'orchestral': ['cinematic', 'instrumental', 'dynamic'],
    'soul': ['warm', 'immersive', 'melancholic'],
    'r&b': ['warm', 'production', 'immersive'],
    'funk': ['warm', 'hypnotic', 'instrumental'],
    'dream pop': ['atmospheric', 'immersive', 'melancholic', 'production'],
    'shoegaze': ['atmospheric', 'immersive', 'build', 'dynamic'],
    'blues': ['warm', 'instrumental'],
    'classic rock': ['warm', 'dynamic', 'production'],
    'hard rock': ['dynamic', 'production'],
    'folk': ['warm', 'melancholic', 'instrumental'],
    'hip-hop': ['production', 'warm'],
    'soundtrack': ['cinematic', 'instrumental', 'atmospheric'],
    'experimental': ['immersive', 'atmospheric', 'dynamic'],
};

// Return the sonic attributes for an album: curated if known, else inferred
// from its genres. `genres` is the array already attached to the event.
function attributesForAlbum(artist, album, genres = []) {
    const curated = ALBUM_ATTRIBUTES[key(artist, album)];
    if (curated) return curated;

    const set = new Set();
    for (const g of genres) {
        const attrs = GENRE_ATTRIBUTES[lc(g)];
        if (attrs) attrs.forEach(a => set.add(a));
    }
    return [...set];
}

module.exports = { ATTRIBUTES, ATTR_LABELS, ALBUM_ATTRIBUTES, attributesForAlbum };
