// Leaderboards (js/shared/boards.js, the career in js/shared/progression.js, Friends in js/ui/progress.js).
// node dev/sim-boards.mjs
//   career    matches, kills, deaths, wins, BR matches/wins/top 5, extractions tracked per match; a weekly window that
//             starts again on Monday (local time); old saves and SY4 codes without a career load and seed it from the
//             lifetime tally; the career survives a save code round trip
//   friends   a card carries totals and looks only; junk and bad ids are refused; a newer card replaces the older
//             one; the store keeps 100, dropping whoever was seen longest ago; never yourself
//   ranking   highest first, shared ranks on ties, K/D only at the minimum matches (and the note for you below it),
//             views Everyone / Friends / Around me
//   pool      the bots' rows on the board are identical for two phones (fresh processes, different time zones) on the
//             same date; totals never fall from day to day
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const store = new Map();
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };

const P = await import('../js/shared/progression.js');
const B = await import('../js/shared/boards.js');
const { Progress, Friends } = await import('../js/ui/progress.js');

let failed = 0;
const ok = (cond, label, info = '') => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${info ? `: ${info}` : ''}`); if (!cond) failed++; };
const DAY = 864e5;

// ---- Career ----
console.log('career');
{
  const s = P.blankSave();
  const mon = new Date(2026, 10, 9, 10), sun = new Date(2026, 10, 15, 23, 30), nextMon = new Date(2026, 10, 16, 0, 5);
  P.recordCareer(s, { kills: 12, deaths: 8, won: true }, mon);
  P.recordCareer(s, { kills: 5, deaths: 9, won: false }, sun);
  P.recordCareer(s, { kills: 7, deaths: 3, won: true, br: true, place: 1 }, sun);
  P.recordCareer(s, { kills: 2, deaths: 1, won: false, br: true, place: 4 }, sun);
  P.recordCareer(s, { kills: 1, deaths: 1, won: false, br: true, place: 9 }, sun);
  P.recordCareer(s, { kills: 3, deaths: 2, won: false, extracted: true }, sun);
  const c = s.career;
  ok(c.m === 6 && c.k === 30 && c.d === 24 && c.kdm === 6 && c.kdk === 30, 'matches, kills, deaths', JSON.stringify(c));
  ok(c.w === 1, 'wins count team matches only', c.w);
  ok(c.brm === 3 && c.brw === 1 && c.br5 === 2, 'BR matches, wins, top 5', `${c.brm}/${c.brw}/${c.br5}`);
  ok(c.ex === 1, 'extractions hook (extracted: true)', c.ex);
  ok(c.wk.key === P.periodKey('weekly', mon) && c.wk.m === 6 && c.wk.k === 30 && c.wk.w === 2, 'one week window Monday to Sunday', JSON.stringify(c.wk));
  P.recordCareer(s, { kills: 4, deaths: 4, won: true }, nextMon);
  ok(c.wk.key === P.periodKey('weekly', nextMon) && c.wk.m === 1 && c.wk.k === 4 && c.wk.w === 1, 'a new Monday starts the week at zero', JSON.stringify(c.wk));
  ok(c.m === 7 && c.k === 34, 'lifetime keeps counting across weeks');
  const later = new Date(2026, 10, 25);
  ok(P.careerWeek(P.cleanCareer(c), later).k === 0, 'a stale week reads as zero');

  // Round trip through a save code.
  const back = P.decodeSave(P.encodeSave(P.sanitizeSave(s)));
  ok(back.ok && JSON.stringify(back.save.career) === JSON.stringify(P.cleanCareer(c)), 'career survives an SY4 code round trip');

  // An old save (no career): seeded from the lifetime tally; deaths unknown, so no K/D until it is tracked.
  const old = P.blankSave();
  delete old.career;
  old.life = { played: 40, kills: 600, wins: 22, 'played:br': 6, 'won:br': 2 };
  const seeded = P.sanitizeSave(JSON.parse(JSON.stringify(old))).career;
  ok(seeded.m === 40 && seeded.k === 600 && seeded.w === 20 && seeded.brm === 6 && seeded.brw === 2 && seeded.br5 === 2 && seeded.d === 0 && seeded.kdm === 0,
    'an old save seeds the career from its lifetime tally', JSON.stringify(seeded));
  // An SY4 code made before the career existed: the packed array has no 18th entry.
  const code = P.encodeSave(P.sanitizeSave(old));
  const body = code.split('.')[1];
  const arr = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  arr.length = 17;
  const body2 = Buffer.from(JSON.stringify(arr)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let h = 0x811c9dc5; for (let i = 0; i < body2.length; i++) { h ^= body2.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const legacy = P.decodeSave(`SY4.${body2}.${(h >>> 0).toString(36)}`);
  ok(legacy.ok && legacy.save.career.m === 40 && legacy.save.career.k === 600, 'an SY4 code without a career still loads', legacy.error ?? '');
  // Junk in the career field.
  const junk = P.sanitizeSave({ version: 4, career: { m: -5, k: 'x', brw: 9, brm: 2, kdm: 99, m2: 1, wk: { key: '<b>', k: 5 } } }).career;
  ok(junk.m === 0 && junk.k === 0 && junk.brw === 2 && junk.kdm === 0 && junk.wk.key === '', 'a bad career field is cleaned', JSON.stringify(junk));

  // Through Progress (the real save module): applyMatch records, careerCard reads it back.
  Progress.applyMatch({ xp: 1000, weapons: {}, won: true, career: { kills: 9, deaths: 4 } });
  Progress.applyMatch({ xp: 1000, weapons: {}, won: false, career: { kills: 3, deaths: 6, br: true, place: 3 } });
  const me = Progress.careerCard();
  ok(me.m === 2 && me.k === 12 && me.d === 10 && me.w === 1 && me.brm === 1 && me.br5 === 1 && me.wk.k === 12, 'Progress.applyMatch feeds careerCard', JSON.stringify(me));
  const keys = Object.keys(me).sort().join(',');
  ok(keys === 'br5,brm,brw,card,d,emblem,ex,k,kdk,kdm,level,m,mst,name,op,prestige,skin,sn,v,w,wk,xp', 'the card holds totals and looks only', keys);
  ok(JSON.stringify(me).length < 400, 'the card is compact', `${JSON.stringify(me).length} bytes`);
  ok(B.cleanCard(me) !== null, 'my own card passes cleanCard');
}

// ---- Friends ----
console.log('friends');
{
  const card = (name, k = 10, extra = {}) => ({ v: 1, name, level: 10, prestige: 0, xp: 1000, m: 30, k, w: 5, brm: 0, brw: 0, br5: 0, ex: 0, kdm: 30, kdk: k, d: 10, mst: 0, wk: { key: 'W2026-11-09', k: 3, w: 1 }, op: 'anvil', skin: null, card: 'yard', emblem: null, ...extra });
  ok(B.cleanCard(null) === null && B.cleanCard({ v: 2, name: 'x' }) === null && B.cleanCard({ v: 1, name: '' }) === null, 'junk is not a card');
  const dirty = B.cleanCard({ ...card('<script>Ann'), op: 'nope', card: 'nope', emblem: 'nope', skin: 'skin:wisp-base', level: 999, prestige: -2, brw: 50, brm: 3, extra: 'leak', wk: { key: 'bad', k: 9 } });
  ok(dirty.name === 'scriptAnn' && dirty.op === null && dirty.card === 'yard' && dirty.emblem === null && dirty.skin === null && dirty.level === 50 && dirty.prestige === 0 && dirty.brw === 3 && !('extra' in dirty) && dirty.wk.key === '',
    'a dirty card is cleaned field by field', JSON.stringify(dirty));
  Friends.clear();
  const t0 = Date.UTC(2026, 10, 1);
  ok(!Friends.see('bad id!', card('A'), t0), 'a bad player id is refused');
  ok(!Friends.see('Pself', card('Me'), t0, 'Pself'), 'your own card is never stored as a friend');
  ok(Friends.see('Pann', card('Ann', 10), t0) && Friends.see('Pann', card('Ann', 50), t0 + DAY), 'a card is stored, then replaced');
  let list = Friends.list();
  ok(list.length === 1 && list[0].card.k === 50 && list[0].at === t0 + DAY, 'the newer card wins, dated when it was seen');
  for (let i = 0; i < 130; i++) Friends.see(`Pf${i}`, card(`F${i}`), t0 + (i + 2) * 3600e3);
  list = Friends.list();
  ok(list.length === B.FRIENDS_MAX, `capped at ${B.FRIENDS_MAX}`, list.length);
  ok(!list.some(f => f.id === 'Pann') && !list.some(f => f.id === 'Pf0') && list.some(f => f.id === 'Pf129') && list[0].id === 'Pf129', 'the friends seen longest ago drop off');
  // The store survives a reload (a fresh read of storage).
  const raw = JSON.parse(store.get('switchyard.friends'));
  ok(B.cleanFriends(raw).length === 100 && B.cleanFriends({ list: [{ id: 'P1', at: 1, card: { v: 1 } }, 'x'] }).length === 0, 'stored list reloads; junk rows drop');
  Friends.clear();
}

// ---- Ranking ----
console.log('ranking');
{
  const e = (id, kind, k, d, kdm, extra = {}) => ({ id, kind, name: id, level: 1, prestige: 0, xp: 0, m: kdm, k, w: 0, brm: 0, brw: 0, br5: 0, ex: 0, kdm, kdk: k, d, mst: 0, wk: { key: '', k: 0, w: 0 }, ...extra });
  const list = [e('a', 'pool', 100, 50, 30), e('b', 'pool', 100, 40, 30), e('c', 'pool', 80, 10, 10), e('d', 'pool', 100, 50, 30), e('me', 'me', 5, 1, 3)];
  const kills = B.rankEntries(list, 'kills');
  ok(kills.rows.map(r => `${r.e.id}${r.rank}`).join(' ') === 'a1 b1 d1 c4 me5', 'ties share a rank, then the next rank skips', kills.rows.map(r => `${r.e.id}${r.rank}`).join(' '));
  const kd = B.rankEntries(list, 'kd');
  ok(kd.rows.map(r => r.e.id).join('') === 'bad' && kd.unranked.map(x => x.id).join('') === 'cme', `K/D ranks only ${B.KD_MIN_MATCHES}+ matches (c has 8.0 over 10)`);
  const pals = [{ id: 'Pann', at: Date.now(), card: { ...B.cleanCard({ v: 1, name: 'Ann', m: 40, k: 99999, kdm: 40, kdk: 99999, d: 1 }) } }];
  const meCard = { v: 1, name: 'Me', level: 3, m: 3, k: 30, kdm: 3, kdk: 30, d: 10 };
  const kdBoard = B.buildBoard({ me: meCard, friends: pals, cat: 'kd' });
  ok(kdBoard.me === -1 && /22 more matches/.test(kdBoard.note), 'under the minimum: unranked, with how many matches to go', kdBoard.note);
  ok(kdBoard.rows[0].e.id === 'Pann' && kdBoard.rows[0].e.kind === 'friend', 'a friend ranks among the pool');
  const all = B.buildBoard({ me: meCard, friends: pals, cat: 'kills' });
  const { BOT_POOL: POOL } = await import('../js/shared/botpool.js');
  ok(all.total === POOL.length + 2 && all.rows.length === POOL.length + 2 && all.rows[all.me].e.kind === 'me', `Everyone: you, friends and the whole pool (${POOL.length})`, all.total);
  ok(all.rows.every((r, i) => !i || r.value <= all.rows[i - 1].value), 'sorted highest first');
  const fr = B.buildBoard({ me: meCard, friends: pals, cat: 'kills', view: 'friends' });
  ok(fr.rows.length === 2 && fr.rows[0].rank === 1 && fr.rows[1].e.kind === 'me' && fr.rows[1].rank === 2, 'Friends: you and them, ranked among yourselves');
  const ar = B.buildBoard({ me: meCard, friends: pals, cat: 'kills', view: 'around' });
  ok(ar.rows.length <= 2 * B.AROUND + 1 && ar.rows[ar.me].e.kind === 'me' && ar.rows[ar.me].rank === all.rows[all.me].rank, 'Around me: your rank with its neighbours', `${ar.rows.length} rows, rank ${ar.rows[ar.me].rank}`);
  const lvl = B.buildBoard({ me: { ...meCard, level: 50, prestige: 10, xp: 9e9 }, cat: 'level' });
  ok(lvl.rows[0].e.kind === 'me' && lvl.rows[0].text.startsWith('Master 1000'), 'level ranks prestige, then Master level, first', lvl.rows[0].text);
  const wk = B.buildBoard({ me: meCard, friends: [{ id: 'Pold', at: 1, card: B.cleanCard({ v: 1, name: 'Old', wk: { key: 'W2020-01-06', k: 9999, w: 99 } }) }], cat: 'wkills', view: 'friends' });
  ok(wk.rows.find(r => r.e.id === 'Pold').value === 0, "a friend's card from an earlier week counts zero on the weekly boards");
  const pool = B.poolEntries(Date.now());
  ok(pool.every(p => p.wk.k >= 0 && p.wk.k <= p.k && p.wk.w >= 0), 'pool weekly numbers are within their totals');
  ok(pool.every(p => p.mst >= 0 && p.mst <= P.MASTERY_TOTAL()), 'pool mastery within what there is to finish');
  ok(pool.every(p => p.ex === 0), 'no extractions before the mode launches');
  const { BOT_POOL } = await import('../js/shared/botpool.js');
  ok(pool.length === BOT_POOL.length && pool.every((p, i) => p.name === BOT_POOL[i].name && p.card === BOT_POOL[i].card && p.emblem === BOT_POOL[i].emblem), 'pool rows wear the tag, card and emblem they wear in lobbies');
  ok(pool.every(p => p.clan === null || /^[A-Z0-9]{2,4}$/.test(p.clan)), 'clan tags only from clanOf, when the pool has it');
  const wkStart = P.weekStart(new Date()), win = B.poolWindow(wkStart, Date.now());
  ok(win.length === BOT_POOL.length && win.every((w, i) => w.k === pool[i].wk.k), 'poolWindow (the hook for seasonal boards) gives the weekly numbers for this week');
}

// ---- Master Prestige on the Level board (docs/PRESTIGE.md) ----
console.log('master');
{
  const S = P.MASTER_START_XP, X = P.MASTER_LEVEL_XP;
  const card = (name, prestige, level, xp) => ({ v: 1, name, prestige, level, xp });
  const pals = [
    { id: 'Pm1', at: 1, card: B.cleanCard(card('Grinder', 10, 50, S + 300 * X + 5)) },       // Master 301
    { id: 'Pm2', at: 1, card: B.cleanCard(card('Edge', 10, 50, S)) },                       // Master 1
    { id: 'Pm3', at: 1, card: B.cleanCard(card('Almost', 10, 49, S + 900 * X)) },           // Not a Master yet, however much XP
    { id: 'Pm4', at: 1, card: B.cleanCard(card('Nine', 9, 50, 9e6)) },
    { id: 'Pm5', at: 1, card: B.cleanCard(card('Tied', 10, 50, S + 300 * X + 900)) },       // Master 301 too, more XP
  ];
  const lv = B.buildBoard({ me: card('Me', 10, 50, S + 40 * X), friends: pals, cat: 'level', view: 'friends' });
  ok(lv.rows.map(r => r.e.name).join(',') === 'Tied,Grinder,Me,Edge,Almost,Nine', 'Level board: Master level first, then XP within it; prestige and level below', lv.rows.map(r => `${r.e.name} ${r.text}`).join(' | '));
  ok(lv.rows[0].rank === 1 && lv.rows[1].rank === 2 && lv.rows[0].text.startsWith('Master 301') && lv.rows[2].text.startsWith('Master 41'), 'one Master level is ranked by XP within it; rows read "Master N"');
  ok(lv.rows.find(r => r.e.name === 'Almost').text === 'P10 · 49' && lv.rows.find(r => r.e.name === 'Nine').text === 'P9 · 50', 'below Master the row reads prestige and level as before');
  // A card from a build before Master levels has no such field: its Master level is read from its XP all the same.
  ok(B.masterOfEntry(pals[0].card) === 301 && B.masterOfEntry(pals[2].card) === 0 && B.masterOfEntry({ prestige: 10, level: 50, xp: 0 }) === 1, 'Master level comes from rank and total XP (older cards too)');
  const all = B.buildBoard({ me: card('Me', 10, 50, S + 40 * X), cat: 'level' });
  ok(all.rows.every((r, i) => !i || r.value <= all.rows[i - 1].value), 'whole Level board sorted highest first');
  const bots = all.rows.filter(r => r.e.kind === 'pool' && B.masterOfEntry(r.e) > 0);
  ok(bots.length > 10 && bots.every(r => r.text.startsWith(`Master ${B.masterOfEntry(r.e)}`)), 'pool Masters rank and read as Masters', `${bots.length} on the board, top ${bots[0]?.text}`);
}

// ---- Pool: identical for two phones on the same date ----
console.log('pool');
{
  const here = fileURLToPath(new URL('../js/shared/boards.js', import.meta.url));
  const script = `import('${here}').then(B => { const t = new Date(2026, 10, 11, 15).getTime(); const r = B.buildBoard({ me: { v: 1, name: 'X' }, cat: 'kills', now: t }); process.stdout.write(JSON.stringify(B.poolEntries(t)) + '|' + r.rows.map(x => x.e.id + x.rank).join(',')); })`;
  const run = tz => execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, TZ: tz }, maxBuffer: 1 << 26 }).toString();
  const a = run('America/Los_Angeles'), b = run('Asia/Tokyo'), c = run('UTC');
  ok(a === b && b === c && a.length > 1000, 'two phones (fresh processes, LA and Tokyo) build the same pool rows and ranks on the same date');
  // Never falling: every total over 60 days of boards.
  let prev = null, fine = true;
  for (let d = 0; d < 60; d++) {
    const rows = B.poolEntries(Date.UTC(2026, 10, 1) + d * DAY + 12 * 3600e3);
    if (prev) for (let i = 0; i < rows.length; i++) {
      for (const k of ['m', 'k', 'd', 'w', 'brm', 'brw', 'br5', 'xp', 'mst']) if (rows[i][k] < prev[i][k]) fine = false;
      if (B.getCategory('level').value(rows[i]) < B.getCategory('level').value(prev[i])) fine = false;     // Level, Master included.
    }
    prev = rows;
  }
  ok(fine, 'pool totals never fall from one day to the next (60 days)');
  const t = performance.now();
  B.poolEntries(Date.UTC(2027, 5, 1));
  const ms = performance.now() - t;
  ok(ms < 200, 'a day of pool rows is cheap', `${ms.toFixed(0)} ms`);
}

console.log(failed ? `\n${failed} FAILED` : '\nall ok');
process.exit(failed ? 1 : 0);
