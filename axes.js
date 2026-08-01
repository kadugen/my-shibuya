// ============================================================
// TASTE AXES (semantic-differential preferences)
//
// The earlier single-attribute sliders had two flaws: every slider read as a
// "benefit" (so users would just max them all), and the vocabulary only
// described one aesthetic (immersive/ambient), so it couldn't represent very
// different listeners.
//
// Instead we use BIPOLAR axes. Each axis runs between two opposite poles with
// no universally-"better" end (e.g. Instrumental ↔ Vocal-forward). A listener's
// position on an axis is in [-1, +1]; 0 means "no preference" (that axis won't
// influence their scores). Distance from center = how much it matters. Two very
// different people (a jazz-head, a pop fan) use the SAME axes from opposite ends.
//
// ORIENTATION: every axis is oriented so the LEFT pole (negative) is the
// "deep / immersive listening" trait — instrumental, journey, mellow, moody,
// enveloping, warm, complex — and the RIGHT pole (positive) is the
// "accessible / pop" trait. A deep listener slides everything left; a pop fan
// slides everything right. No per-slider mental gymnastics.
//
// Albums are positioned on the same [-1, +1] scale. Match = alignment between
// the listener's position and the album's position, per axis.
// ============================================================

const AXES = [
    {
        key: 'voice',
        left:  { label: 'Instrumental', examples: 'Floating Points, Tortoise' },
        right: { label: 'Vocal-forward', examples: 'Adele, Frank Ocean' },
        tip: 'Is it about instruments and textures, or is the human voice the centerpiece?',
    },
    {
        key: 'shape',
        left:  { label: 'Continuous journey', examples: 'Dark Side of the Moon, Godspeed' },
        right: { label: 'Individual songs', examples: 'hits, singles, playlists' },
        tip: 'One cohesive front-to-back experience, or a collection of standalone tracks?',
    },
    {
        key: 'energy',
        left:  { label: 'Mellow / meditative', examples: 'Brian Eno, Alice Coltrane' },
        right: { label: 'Energetic / danceable', examples: 'Daft Punk, Prince' },
        tip: 'Calm and contemplative, or driving and full of momentum?',
    },
    {
        key: 'mood',
        left:  { label: 'Moody / melancholy', examples: 'Portishead, Elliott Smith' },
        right: { label: 'Bright / uplifting', examples: 'Stevie Wonder, Earth, Wind & Fire' },
        tip: 'Emotionally dark and wistful, or bright and joyful?',
    },
    {
        key: 'space',
        left:  { label: 'Enveloping / lush', examples: 'Sigur Rós, My Bloody Valentine' },
        right: { label: 'Sparse / direct', examples: 'Nils Frahm, The xx' },
        tip: 'A rich, immersive wall of sound, or open space and directness?',
    },
    {
        key: 'sound',
        left:  { label: 'Warm / vintage', examples: '70s analog soul, tape warmth' },
        right: { label: 'Crisp / modern', examples: 'clean digital production' },
        tip: 'Warm, analog, of-its-era, or clean and modern-sounding?',
    },
    {
        key: 'access',
        left:  { label: 'Complex / demanding', examples: 'free jazz, prog, avant-garde' },
        right: { label: 'Immediate / catchy', examples: 'pop hooks, sing-alongs' },
        tip: 'Rewarding of repeated, attentive listens, or instantly enjoyable?',
    },
];

const lc = s => (s || '').toLowerCase().trim();
const clamp = x => Math.max(-1, Math.min(1, x));
const has = (arr, v) => (arr || []).includes(v);
const anyGenre = (genres, list) => (genres || []).some(g => list.some(t => lc(g).includes(t)));

// Derive an album's position on each axis from its curated sonic attributes
// (see attributes.js) plus its genres. NEGATIVE = left/deep pole, POSITIVE =
// right/accessible pole. Values accumulate then clamp to [-1, 1].
function deriveAxes(attributes = [], genres = []) {
    const A = attributes, G = genres;
    const ax = { voice: 0, shape: 0, energy: 0, mood: 0, space: 0, sound: 0, access: 0 };

    // VOICE: instrumental (−) ↔ vocal-forward (+)
    // An album-specific 'instrumental' attribute is more accurate than the
    // artist's default genre (e.g. Beastie Boys' all-instrumental "The In Sound
    // From Way Out" — hip-hop artist, but the RECORD has no vocals), so when it's
    // set we trust it and skip the vocal-forward genre bump.
    if (has(A, 'instrumental')) {
        ax.voice -= 0.7;
    } else {
        if (anyGenre(G, ['ambient', 'drone', 'post-rock', 'krautrock', 'classical', 'orchestral', 'minimalism'])) ax.voice -= 0.5;
        if (anyGenre(G, ['soul', 'r&b', 'neo-soul', 'pop', 'singer-songwriter', 'vocal jazz', 'gospel', 'dance-pop', 'hip-hop', 'rap', 'city pop'])) ax.voice += 0.7;
        if (anyGenre(G, ['dream pop', 'baroque pop', 'art pop'])) ax.voice += 0.3;
    }

    // SHAPE: continuous journey (−) ↔ individual songs (+)
    if (has(A, 'immersive')) ax.shape -= 0.5;
    if (has(A, 'longform')) ax.shape -= 0.4;
    if (has(A, 'build')) ax.shape -= 0.2;
    if (anyGenre(G, ['pop', 'dance-pop', 'garage rock', 'punk', 'arena rock', 'glam rock', 'city pop'])) ax.shape += 0.4;

    // ENERGY: mellow/meditative (−) ↔ energetic/danceable (+)
    if (has(A, 'meditative')) ax.energy -= 0.6;
    if (has(A, 'atmospheric')) ax.energy -= 0.3;
    if (has(A, 'dynamic')) ax.energy += 0.4;
    if (has(A, 'build')) ax.energy += 0.2;
    if (anyGenre(G, ['dance', 'disco', 'funk', 'house', 'hard rock', 'metal', 'punk', 'thrash', 'arena rock'])) ax.energy += 0.5;
    if (anyGenre(G, ['ambient', 'drone', 'downtempo'])) ax.energy -= 0.5;

    // MOOD: moody/melancholy (−) ↔ bright/uplifting (+)
    if (has(A, 'melancholic')) ax.mood -= 0.6;
    if (anyGenre(G, ['soul', 'funk', 'disco', 'gospel', 'afrobeat'])) ax.mood += 0.4;
    if (anyGenre(G, ['doom', 'shoegaze'])) ax.mood -= 0.3;

    // SPACE: enveloping/lush (−) ↔ sparse/direct (+)
    if (has(A, 'atmospheric')) ax.space -= 0.3;
    if (anyGenre(G, ['shoegaze', 'dream pop', 'orchestral', 'wall of sound'])) ax.space -= 0.5;
    if (anyGenre(G, ['folk', 'singer-songwriter', 'minimalism', 'minimal'])) ax.space += 0.5;
    if (has(A, 'meditative') && !has(A, 'immersive')) ax.space += 0.2;

    // SOUND: warm/vintage (−) ↔ crisp/modern (+)
    if (has(A, 'warm')) ax.sound -= 0.6;
    if (anyGenre(G, ['soul', 'blues', 'classic rock', 'jazz', 'funk', 'folk', 'city pop'])) ax.sound -= 0.4;
    if (anyGenre(G, ['electronic', 'dance-pop', 'idm', 'techno', 'house', 'hyperpop', 'alt-pop', 'electropop'])) ax.sound += 0.5;
    if (has(A, 'production') && !has(A, 'warm')) ax.sound += 0.2;

    // ACCESS: complex/demanding (−) ↔ immediate/catchy (+)
    if (has(A, 'hypnotic')) ax.access -= 0.3;
    if (has(A, 'longform')) ax.access -= 0.3;
    if (anyGenre(G, ['experimental', 'avant-garde', 'free jazz', 'progressive', 'krautrock', 'modal jazz', 'contemporary classical', 'minimalism'])) ax.access -= 0.6;
    if (anyGenre(G, ['pop', 'dance-pop', 'garage rock', 'arena rock', 'glam rock'])) ax.access += 0.5;

    Object.keys(ax).forEach(k => { ax[k] = clamp(ax[k]); });
    return ax;
}

module.exports = { AXES, deriveAxes };
