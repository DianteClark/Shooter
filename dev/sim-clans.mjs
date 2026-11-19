// Player clans (js/shared/clans.js, Clan in js/ui/progress.js, the Clans board in js/shared/boards.js).
// node dev/sim-clans.mjs
//   tags      2-4 of A-Z 0-9; every bot clan tag (js/shared/botpool.js CLANS) is refused, in any case; the pool's
//             clans, seed, tag order and members are untouched
//   store     found, join (by object and by code), rename (rv goes up, id stays), a clanmate's newer rename is taken,
//             an older one is not, leave; storage junk reads as no clan
//   codes     a join code round-trips every field but `own`; a typo or a code with a bot tag is refused
//   card      careerCard carries the clan (no `own`); cleanCard keeps it, drops a bad or bot-tagged one, keeps `rg` so
//             a cleaned card is still a friend's card (seeFriend); Friends round-trip keeps it
//   boards    the Clans board ranks bot clans by their members' summed pool rows, your clan with you and friends who
//             carry it, newest rename names a player clan; a friend clan you are not in still ranks
//   names     taggedName and the host's guest naming; a tournament bracket shows your clan for your squad
//   reset     wipeProgress removes switchyard.clan
const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k),
  get length() { return store.size; }, key: i => [...store.keys()][i] ?? null };

const C = await import('../js/shared/clans.js');
const B = await import('../js/shared/boards.js');
const Pool = await import('../js/shared/botpool.js');
const T = await import('../js/shared/tournaments.js');
const R = await import('../js/shared/reset.js');
const { Progress, Friends, Clan } = await import('../js/ui/progress.js');

let failed = 0;
const ok = (cond, label, info = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${info ? `: ${info}` : ''}`); if (!cond) failed++; };
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

console.log('tags');
{
  ok(Pool.CLANS.length === 23 && Pool.CLANS[0].tag === 'VXN' && Pool.CLANS[22].tag === 'HWL' && Pool.POOL_SEED === 0x5717c4a2, 'bot pool clans and seed untouched');
  ok(Pool.CLANS.every(c => C.tagProblem(c.tag) && C.tagProblem(c.tag.toLowerCase())), 'every bot clan tag is refused (any case)', Pool.CLANS.length);
  ok(Pool.CLANS.every(c => Clan.create({ tag: c.tag, name: 'Copy' }).error) && !Clan.get(), 'founding with a bot tag fails and stores nothing');
  ok(!C.tagProblem('RAIL') && !C.tagProblem('A1') && !C.tagProblem('9Z9Z'), 'letters and digits, 2 to 4');
  ok(C.tagProblem('A') && C.tagProblem('ABCDE') && C.tagProblem('A-B') && C.tagProblem('') && C.tagProblem('ÄB'), 'too short, too long, other characters refused');
  ok(C.normName('  Rail   Dogs!! <x>  ') === 'Rail Dogs x' && C.normName('x'.repeat(30)).length === C.NAME_MAX, 'names cleaned and cut to 16');
}

console.log('store');
{
  const r = Clan.create({ tag: 'rail', name: 'Rail Dogs', c: 3, mk: 5 }, rand);
  ok(r.clan && r.clan.tag === 'RAIL' && r.clan.own && /^[0-9a-f]{6}$/.test(r.clan.id), 'found: tag uppercased, id rolled, founder flag', JSON.stringify(r.clan));
  const raw = JSON.parse(store.get('switchyard.clan'));
  ok(raw.clan.tag === 'RAIL' && raw.clan.own === true, 'stored under switchyard.clan');
  Clan.reload();
  ok(Clan.get()?.id === r.clan.id && Clan.get().own, 'reads back after a reload');
  const id = r.clan.id;
  const rn = Clan.rename({ tag: 'RD', name: 'Rail Dogs Two' });
  ok(rn.clan && rn.clan.id === id && rn.clan.rv === 1 && rn.clan.tag === 'RD' && rn.clan.own, 'rename keeps the id, bumps rv');
  ok(Clan.rename({ tag: 'VXN' }).error && Clan.tag() === 'RD', 'rename to a bot tag refused');
  // A clanmate's card with a newer rename is taken; older or another clan's is not.
  ok(!Clan.sawCard({ cl: { id, tag: 'OLD', name: 'Old', c: 0, mk: 0, rv: 0 } }) && Clan.tag() === 'RD', 'an older rename is ignored');
  ok(!Clan.sawCard({ cl: { id: 'ffffff', tag: 'ZZ9', name: 'Other', c: 0, mk: 0, rv: 9 } }) && Clan.tag() === 'RD', 'another clan on a card changes nothing');
  ok(Clan.sawCard({ cl: { id, tag: 'RDX', name: 'Rail Dogs X', c: 2, mk: 1, rv: 4 } }) && Clan.tag() === 'RDX' && Clan.get().rv === 4 && Clan.get().own, 'a newer rename is taken, founder flag kept');
  Clan.leave();
  ok(Clan.get() === null && !store.has('switchyard.clan'), 'leave clears the clan and its key');
  store.set('switchyard.clan', '{"v":1,"clan":{"id":"zz","tag":"VXN","name":"x"}}');
  Clan.reload();
  ok(Clan.get() === null, 'junk in storage reads as no clan');
  store.set('switchyard.clan', 'not json');
  Clan.reload();
  ok(Clan.get() === null, 'unreadable storage reads as no clan');
}

console.log('codes');
{
  const { clan } = C.foundClan({ tag: 'K9', name: 'Night Shift-2', c: 7, mk: 7 }, rand);
  const code = C.clanCode(clan), back = C.readClanCode(code);
  ok(/^[0-9A-Z-]+$/.test(code) && code.replace(/-/g, '').length <= 30, 'a short code of letters and digits', code);
  ok(back && back.id === clan.id && back.tag === 'K9' && back.name === 'Night Shift-2' && back.c === 7 && back.mk === 7 && !back.own, 'round trip keeps every field but own');
  ok(C.readClanCode(code.toLowerCase().replace(/-/g, ' '))?.id === clan.id, 'lower case and spaces are fine');
  let typos = 0;
  const flat = code.replace(/-/g, '');
  for (let i = 0; i < flat.length; i++) {
    const ch = flat[i] === 'A' ? 'B' : 'A';
    if (C.readClanCode(flat.slice(0, i) + ch + flat.slice(i + 1))) typos++;
  }
  ok(typos <= 1, 'a one-character typo is (nearly always) caught', `${typos} of ${flat.length} slipped through`);
  ok(C.readClanCode('') === null && C.readClanCode('HELLO') === null && C.readClanCode('ABCD-1234') === null, 'junk refused');
  ok(C.clanCode({ ...clan, tag: 'VXN' }) === null, 'a bot-tagged clan has no code');
  const r = Clan.join(code);
  ok(r.clan?.tag === 'K9' && !Clan.get().own, 'join with a code: a member, not the founder');
  ok(Clan.join('NOPE-NOPE').error && Clan.tag() === 'K9', 'a bad code leaves the clan as it was');
  ok(Clan.rename({ name: 'Mine Now' }).clan && Clan.get().rv === 1, 'store rename works for any member (the screen offers it to the founder)');
  Clan.leave();
}

console.log('card');
{
  Progress.name = 'Dee';
  ok(!('cl' in Progress.careerCard()), 'no clan: no field on the card');
  const { clan } = Clan.create({ tag: 'RAIL', name: 'Rail Dogs', c: 1, mk: 2 }, rand);
  const card = Progress.careerCard();
  ok(card.cl && card.cl.tag === 'RAIL' && card.cl.id === clan.id && !('own' in card.cl), 'careerCard carries the clan without own', JSON.stringify(card.cl));
  const clean = B.cleanCard(JSON.parse(JSON.stringify(card)));
  ok(clean.cl && clean.cl.tag === 'RAIL' && clean.rg === card.rg, 'cleanCard keeps the clan and the reset generation');
  ok(!B.cleanCard({ ...card, cl: { ...card.cl, tag: 'VXN' } }).cl, 'a bot tag on a card is dropped');
  ok(!B.cleanCard({ ...card, cl: { id: 'xyz', tag: 'RAIL', name: 'x' } }).cl && !B.cleanCard({ ...card, cl: 'RAIL' }).cl, 'a bad clan on a card is dropped');
  ok(B.cleanCard({ ...card, cl: undefined }) && !B.cleanCard({ ...card, cl: undefined }).cl, 'an older card (no clan) still reads');
  // A cleaned card must still be a friend's card (main.js stores the cleaned card).
  ok(Friends.see('Ppal1', clean, Date.now(), 'Pme'), 'a cleaned card is kept as a friend');
  Friends.clear();
  Friends.see('Ppal1', { ...card, name: 'Pal' }, Date.now(), 'Pme');
  ok(Friends.list('Pme')[0]?.card.cl?.id === clan.id, 'the friends store keeps the clan');
  Friends.clear();
}

console.log('boards');
{
  const now = Date.UTC(2026, 11, 20, 12);
  const me = { ...Progress.careerCard(), k: 120, xp: 9000, wk: { key: '', k: 0, w: 0 } };
  const mine = me.cl;
  const pal = (id, name, k, cl) => ({ id, at: now - 1000, card: B.cleanCard({ v: 1, rg: 1, name, k, xp: k * 10, cl }) });
  const friends = [
    pal('Pa', 'Ann', 300, { ...mine, rv: 0 }),
    pal('Pb', 'Bo', 50, { ...mine, tag: 'RLX', name: 'Rail Renamed', rv: 2 }),
    pal('Pc', 'Cy', 5000, { id: 'abcdef', tag: 'Q7', name: 'Quiet Seven', c: 4, mk: 1, rv: 0 }),
    pal('Pd', 'Di', 70, null),
  ];
  const b = B.clanBoard({ me, myId: 'Pme', friends, cat: 'kills', now });
  const poolSum = tag => B.poolEntries(now).filter(e => e.clan === tag).reduce((a, e) => a + e.k, 0);
  const vxn = b.rows.find(r => r.key === 'bot:VXN');
  ok(b.rows.filter(r => r.kind === 'pool').length === Pool.CLANS.length, 'every bot clan has a row', b.rows.length);
  ok(vxn && vxn.value === poolSum('VXN') && vxn.members.length === Pool.CLANS[0].members.length, 'a bot clan sums its members\' pool rows', vxn?.value);
  const ours = b.rows[b.me];
  ok(ours && ours.mine && ours.members.length === 3 && ours.value === 120 + 300 + 50, 'your clan: you and the friends who carry it', ours && `${ours.members.length} / ${ours.value}`);
  ok(ours.tag === 'RLX' && ours.name === 'Rail Renamed', 'the newest rename names it', ours.tag);
  const q7 = b.rows.find(r => r.tag === 'Q7');
  ok(q7 && !q7.mine && q7.value === 5000 && q7.kind === 'player', 'a friend\'s clan you are not in still ranks');
  ok(b.rows.every((r, i) => !i || b.rows[i - 1].value >= r.value) && b.rows[0].rank === 1, 'highest first');
  ok(!b.rows.some(r => r.members.some(e => e.name === 'Di')), 'a friend in no clan is in no row');
  ok(B.CLAN_CATEGORIES.every(c => B.clanBoard({ me, friends, cat: c.id, now }).rows.length === b.rows.length), 'every clan category ranks', B.CLAN_CATEGORIES.map(c => c.id).join(','));
  const xp = B.clanBoard({ me, friends, cat: 'xp', now });
  ok(xp.rows[xp.me].value === 9000 + 3000 + 500, 'XP sums total XP');
  // Players' rows on the player boards show the tag like a pool bot's.
  const pb = B.buildBoard({ me, myId: 'Pme', friends, cat: 'kills', view: 'friends', now });
  ok(pb.rows.find(r => r.e.kind === 'me')?.e.clan === 'RAIL' && pb.rows.find(r => r.e.name === 'Cy')?.e.clan === 'Q7' && pb.rows.find(r => r.e.name === 'Di')?.e.clan === null,
    'the player boards tag you and friends');
  const none = B.clanBoard({ me: { v: 1, name: 'Solo' }, friends: [], cat: 'kills', now });
  ok(none.me === -1 && none.total === Pool.CLANS.length, 'no clan: bot clans only, no row of yours');
}

console.log('names and tournaments');
{
  ok(C.taggedName('Dee', 'RAIL') === '[RAIL] Dee' && C.taggedName('Dee', 'VXN') === 'Dee' && C.taggedName('Dee', null) === 'Dee', 'taggedName: only a good player tag');
  const key = (await import('../js/shared/tourney-items.js')).FIRST_WEEKEND;
  const plain = T.bracketFor(key, 'Pme', { name: "Dee's squad" });
  const tagged = T.bracketFor(key, 'Pme', { name: "Dee's squad", clan: Clan.get() });
  const you = s => s.squads.find(q => q.kind === 'you');
  ok(you(tagged).tag === 'RAIL' && you(tagged).name === 'Rail Dogs' && you(plain).tag === null, 'the bracket shows your clan for your squad');
  ok(JSON.stringify(plain.squads.map(s => [s.seed, s.members])) === JSON.stringify(tagged.squads.map(s => [s.seed, s.members])), 'the clan changes the label only, never the draw');
  ok(you(T.bracketFor(key, 'Pme', { name: 'X', clan: { tag: 'VXN', name: 'Fake' } })).tag === null, 'a bot tag is not shown as yours');
  ok(T.roundTitle(0, you(tagged)).includes('[RAIL] Rail Dogs'), 'round titles read the tag');
}

console.log('reset');
{
  ok(R.WIPE_KEYS.includes('switchyard.clan'), 'switchyard.clan is in the reset sweep');
  store.set('switchyard.resetGen', '0');
  const res = R.wipeProgress(localStorage);
  Clan.reload();
  ok(res.wiped.includes('switchyard.clan') && !store.has('switchyard.clan') && Clan.get() === null, 'a wipe removes the clan', res.wiped.join(','));
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
