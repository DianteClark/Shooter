// V11 attachments wave: signature attachments and conversion kits. Data only; attachments.js appends these to
// ATTACHMENTS after the older table, so every older id keeps its place in packKit's slot lists (append, never reorder).
//
// kind: 'sig'  a signature attachment: made for one gun, leans into what that gun already is.
//       'kit'  a conversion kit: one slot that changes how the gun plays (fire mode, feed, what it shoots).
// for:    one line, what it is for (the gunsmith shows it under the name).
// desc:   what it changes, plainly.
// unlock: weapon level 1-30, or 31-35 for mastery ladder tier I-V (attachments.js LADDER_BASE).
// mods:   multipliers as in attachments.js, plus the identity keys only these may touch (damage, rpm, settleShots,
//         settleFrom, spinupShots, spinupFrom, chargeTime, burstGap, boltKick, adsGate, lunge, falloffMin, heatLockout).
// set:    fields replaced outright, applied before the mods (fire mode, pellets, falloff, botUse...). A field set to
//         undefined is removed (a kit that takes the bolt kick or the wind-up away).
// notes:  what `set` does, in words, for the gunsmith (mode changes have no number to show): a string (neither better
//         nor worse) or {text, better}.
// look:   the part the gun model draws for it, as {slot: existing attachment id}. Uses parts each gun's own model
//         already knows how to fit, so nothing floats; a kit may also fill an empty slot's look.

const sig = (id, weapon, slot, name, unlock, fr, desc, mods, extra = {}) =>
  ({ id, slot, name, kind: 'sig', weapons: [weapon], unlock, for: fr, desc, mods, ...extra });
const conv = (id, weapon, slot, name, unlock, fr, desc, mods, extra = {}) =>
  ({ id, slot, name, kind: 'kit', weapons: [weapon], unlock, for: fr, desc, mods, ...extra });

const M1 = 31;   // Mastery ladder tier I.

const LIST = [
  // ---------------- Assault ----------------
  sig('s_trueline', 'ar', 'barrel', 'Trueline Upper', 7,
    'Keeps the Halyard on a head at 25 m once you know its pull.',
    'Less recoil sway and settles sooner. Fires a little slower, a touch slower to aim.',
    { patternAmp: 0.78, bloomRecover: 1.15, rpm: 0.94, adsTime: 1.04 }, { look: { barrel: 'longbarrel' } }),
  sig('s_matchmag', 'ar', 'mag', 'Match Mags', M1,
    'Short, careful strings for the player who fires in fours.',
    'Settles faster with less sway. Fewer rounds, slightly slower reload.',
    { bloomRecover: 1.25, patternAmp: 0.88, magazine: 0.84, reload: 1.06 }, { look: { mag: 'lightmag' } }),
  conv('k_triburst', 'ar', 'grip', 'Tri-Burst Group', 25,
    'Turns the Halyard into a three-round burst rifle that reaches out to 30 m.',
    'Fires three-round bursts: much tighter and steadier, but a slower cadence and committed bursts.',
    { rpm: 0.82, adsSpread: 0.78, bloomPerShot: 0.7, patternAmp: 0.6, hipSpread: 1.12, sprintToFire: 1.06 },
    { set: { burst: { count: 3, gap: 0.055 } }, notes: ['Fires three-round bursts'], look: { grip: 'vertical' } }),

  sig('s_metronome', 'burst', 'grip', 'Metronome Spring', 7,
    'Packs each burst tighter so a clean burst lands before they react.',
    'Rounds in a burst come much closer together. Each burst kicks harder and blooms more.',
    { burstGap: 0.7, patternAmp: 1.3, bloomPerShot: 1.2 }, { look: { grip: 'angled' } }),
  conv('k_openbolt', 'burst', 'grip', 'Open Bolt', 25,
    'A full-auto Cadence for close fights the burst cannot win.',
    'Full auto and faster. Four to the body, looser aimed fire, more bloom.',
    { rpm: 1.25, damage: 0.93, bloomPerShot: 1.4, adsSpread: 1.3 },
    { set: { burst: undefined }, notes: ['Full auto: no bursts'], look: { grip: 'vertical' } }),

  sig('s_mule', 'heavyar', 'mag', 'Mule Rounds', 7,
    'Stretches the Drayman\'s three-to-the-body range.',
    'Heavier rounds: three to the body further out. Slower fire, fewer rounds, slower reload.',
    { damage: 1.08, rpm: 0.88, magazine: 0.8, reload: 1.1 }, { look: { mag: 'apmag' } }),

  sig('s_dashsling', 'carbine', 'grip', 'Dash Sling', 7,
    'Out of a sprint and onto a target before anything else in the class.',
    'Much faster to swap and to fire out of a sprint. More recoil sway, looser aimed fire.',
    { swapTime: 0.75, sprintToFire: 0.8, patternAmp: 1.22, adsSpread: 1.15 }, { look: { grip: 'wrap' } }),
  conv('k_whisper', 'carbine', 'barrel', 'Whisper Barrel', 25,
    'An integrally suppressed Shunter: stealth without the Hush Can\'s weight.',
    'Suppressed with no handling cost. Shorter range and a slower rate of fire.',
    { suppressed: true, range: 0.75, rpm: 0.93 },
    { notes: [{ text: 'Suppressed: off the minimap', better: true }], look: { barrel: 'suppressor' } }),

  sig('s_lightwheel', 'rampar', 'grip', 'Light Flywheel', 7,
    'Takes the sting out of the Flywheel\'s slow first rounds.',
    'Winds up much faster and starts quicker. Lower top speed.',
    { spinupShots: 0.6, spinupFrom: 1.25, rpm: 0.92 }, { look: { grip: 'angled' } }),
  sig('s_heavywheel', 'rampar', 'grip', 'Heavy Flywheel', M1,
    'For holding a lane: once it is spinning nothing out-fires it.',
    'Higher top speed. Slower to wind up and starts slower.',
    { rpm: 1.08, spinupShots: 1.4, spinupFrom: 0.85 }, { look: { grip: 'vertical' } }),

  sig('s_baffles', 'heatar', 'barrel', 'Kiln Baffles', 7,
    'Overheat on purpose: the lockout is short enough to ride.',
    'Much shorter overheat lockout. Fewer rounds to overheat, slower to aim.',
    { heatLockout: 0.55, heatRounds: 0.85, adsTime: 1.05 }, { look: { barrel: 'compensator' } }),
  sig('s_firebrick', 'heatar', 'mag', 'Firebrick Liner', M1,
    'Longer strings before the heat bites.',
    'More rounds before overheating. Cools slower, heavier on foot.',
    { heatRounds: 1.3, heatCool: 1.35, moveMult: 0.97 }, { look: { mag: 'extmag' } }),

  // ---------------- SMG ----------------
  sig('s_featherframe', 'smg', 'grip', 'Featherweight Frame', 16,
    'Leans into the Skitter\'s feet: the fastest thing on the map.',
    'Faster on foot and out of a sprint. Shorter range, more recoil sway.',
    { moveMult: 1.03, sprintToFire: 0.85, range: 0.85, patternAmp: 1.2 }, { look: { grip: 'skelstock' } }),
  conv('k_hivedrum', 'smg', 'mag', 'Hive Drum', 26,
    'A Skitter that clears a whole room on one load.',
    'Twice the rounds and a slower, steadier rate. A long reload, heavier, slower to aim.',
    { magazine: 2, rpm: 0.92, reload: 1.55, moveMult: 0.95, adsTime: 1.1 },
    { notes: ['72-round drum'], look: { mag: 'drummag' } }),

  sig('s_rattle', 'pdw', 'mag', 'Rattle Spring', 27,
    'Makes the fastest kill in a room faster still.',
    'Fires faster. Much more recoil sway, fewer rounds.',
    { rpm: 1.08, patternAmp: 1.3, magazine: 0.86 }, { look: { mag: 'speedmag' } }),
  sig('s_burr', 'pdw', 'barrel', 'Burr Muzzle', 24,
    'Keeps the Rasp from being spent just past a room.',
    'Damage holds up better past 14 m. Wider from the hip, slower out of a sprint.',
    { falloffMin: 1.2, range: 1.1, hipSpread: 1.1, sprintToFire: 1.1 }, { look: { barrel: 'compensator' } }),

  sig('s_needlesight', 'tacsmg', 'optic', 'Needle Sight', 25,
    'Makes the SMG you aim even more of a laser.',
    'Tighter aimed fire, quicker to aim. Very wide from the hip, slower while aimed.',
    { adsSpread: 0.75, adsTime: 0.92, hipSpread: 1.3, adsMoveMult: 0.85 }, { look: { optic: 'reflex' } }),
  sig('s_suture', 'tacsmg', 'barrel', 'Suture Barrel', M1,
    'Pushes Stitch\'s four-to-the-body range further down the lane.',
    'Damage holds further and fades less. Wide from the hip, slower on foot.',
    { range: 1.15, falloffMin: 1.12, hipSpread: 1.25, moveMult: 0.97 }, { look: { barrel: 'longbarrel' } }),

  sig('s_ramrounds', 'heavysmg', 'mag', 'Ram Rounds', 25,
    'The bruiser that shoots through the crate you hide behind.',
    'Keeps more damage through cover. Slower fire, fewer rounds.',
    { penetrate: 1.35, rpm: 0.92, magazine: 0.85 }, { look: { mag: 'apmag' } }),

  sig('s_muffledbolt', 'hushsmg', 'grip', 'Muffled Bolt', 16,
    'For the ghost who is always moving.',
    'Fires sooner out of a sprint, moves faster aimed. Shorter range, slower fire.',
    { sprintToFire: 0.85, adsMoveMult: 1.1, range: 0.9, rpm: 0.94 }, { look: { grip: 'wrap' } }),
  conv('k_openmuzzle', 'hushsmg', 'barrel', 'Open Muzzle', 26,
    'Trades the Murmur\'s silence for real reach.',
    'No longer suppressed: shows on the minimap and is loud. Reaches much further and fades less.',
    { range: 1.3, falloffMin: 1.15 },
    { set: { suppressed: false }, notes: [{ text: 'Not suppressed: shows on the minimap', better: false }], look: { barrel: 'compensator' } }),

  sig('s_gyro', 'drumsmg', 'grip', 'Hopper Gyro', 25,
    'Keeps a 64-round pan on target to the last round.',
    'Much less bloom and sway. Heavier on foot, slower out of a sprint.',
    { bloomPerShot: 0.7, patternAmp: 0.8, moveMult: 0.96, sprintToFire: 1.15 }, { look: { grip: 'vertical' } }),

  // ---------------- Shotgun ----------------
  sig('s_breachpump', 'shotgun', 'grip', 'Breach Pump', 27,
    'A second shell before they recover from the first.',
    'Pumps faster. Slower to swap, slower on foot.',
    { rpm: 1.15, swapTime: 1.1, moveMult: 0.97 }, { look: { grip: 'angled' } }),
  conv('k_slugbarrel', 'shotgun', 'barrel', 'Slug Barrel', 24,
    'Turns the pump into a two-shot slug gun for mid range.',
    'Fires one heavy slug: two to the body out to 16 m and through cover. Loses the one-shot fan.',
    {},
    {
      set: {
        pellets: 1, damage: 70, adsSpread: 0.007, hipSpread: 0.05, bloomScale: 1, range: 40, penetrate: 0.6, tracerWidth: 1.2,
        falloff: { start: 16, end: 28, min: 0.55 },
        botUse: { pref: 10, hold: 0.7, flank: 1.2, advance: 3, rush: 20, precise: true },
      },
      notes: ['Fires a single slug'], look: { barrel: 'rifled' },
    }),

  sig('s_runnerchoke', 'autoshot', 'barrel', 'Runner\'s Choke', 26,
    'Tightens the Squall\'s fan for the shot you take on the run.',
    'Tighter from the hip, a little more reach. Fires slower.',
    { hipSpread: 0.85, range: 1.08, rpm: 0.88 }, { look: { barrel: 'choke' } }),
  sig('s_squalldrum', 'autoshot', 'mag', 'Squall Drum', M1,
    'Enough shells to clear two rooms.',
    'More shells. A long reload, heavier on foot.',
    { magazine: 1.6, reload: 1.3, moveMult: 0.95 }, { look: { mag: 'extmag' } }),

  sig('s_twintriggers', 'coach', 'grip', 'Twin Triggers', 26,
    'Both barrels before they can turn.',
    'The second barrel follows much faster. Wider fan, slower reload.',
    { rpm: 1.6, hipSpread: 1.15, adsSpread: 1.1, reload: 1.15 }, { look: { grip: 'wrap' } }),
  sig('s_buckball', 'coach', 'mag', 'Buck and Ball', M1,
    'Fewer, heavier pellets for the ambush that starts a little further out.',
    'Six heavy pellets that carry further and fly tighter aimed. Less forgiving from the hip.',
    { range: 1.25, adsSpread: 0.85, hipSpread: 1.1 },
    { set: { pellets: 6, damage: 30 }, notes: ['Six heavy pellets'], look: { mag: 'speedmag' } }),

  sig('s_sabot', 'slug', 'mag', 'Sabot Slugs', 27,
    'Railspike at its best: through cover and down a lane.',
    'Keeps more damage through cover and reaches further. Fewer shells, slower reload.',
    { penetrate: 1.15, range: 1.15, magazine: 0.84, reload: 1.1 }, { look: { mag: 'speedmag' } }),
  conv('k_bucktube', 'slug', 'mag', 'Buckshot Tube', 24,
    'A fast-pumping buckshot gun built on the Railspike.',
    'Fires seven pellets: kills up close in one shell, far less reach, cover stops it.',
    {},
    {
      set: {
        pellets: 7, damage: 17, adsSpread: 0.04, hipSpread: 0.065, bloomScale: 0.45, range: 18, penetrate: undefined, tracerWidth: 0.55,
        falloff: { start: 7.5, end: 12, min: 0.3 },
        botUse: { pref: 4, hold: 0.5, flank: 1.5, advance: 3, rush: 9, fireMax: 12, precise: true },
      },
      notes: ['Fires buckshot'], look: { mag: 'extmag' },
    }),

  sig('s_boxtwelve', 'magshot', 'mag', 'Box Twelve', 26,
    'Twelve shells in a box: the shotgun that never pauses.',
    'Half again as many shells. Slower reload, heavier, slower to aim.',
    { magazine: 1.5, reload: 1.25, moveMult: 0.96, adsTime: 1.06 }, { look: { mag: 'extmag' } }),

  sig('s_needlechoke', 'flechette', 'barrel', 'Needle Choke', 26,
    'Flechettes keep their bite much further down the sights.',
    'Damage fades far less and reaches further, tighter aimed. Wide from the hip, slower to aim.',
    { falloffMin: 1.3, range: 1.15, adsSpread: 0.8, hipSpread: 1.25, adsTime: 1.08 }, { look: { barrel: 'choke' } }),
  sig('s_barbed', 'flechette', 'mag', 'Barbed Darts', M1,
    'Heavier darts: fewer needed to finish the job.',
    'More damage per dart. Fewer shells, slower to load.',
    { damage: 1.1, magazine: 0.8, reload: 1.1 }),

  // ---------------- LMG ----------------
  sig('s_prespun', 'lmg', 'grip', 'Pre-Spun Motor', 14,
    'Fixes the Bulwark\'s slow start for the corner fight.',
    'Starts much closer to full rate. Fewer rounds before overheating.',
    { spinupFrom: 1.3, heatRounds: 0.85 }, { look: { grip: 'vertical' } }),
  conv('k_assaultbox', 'lmg', 'mag', 'Assault Box', 22,
    'A Bulwark you can walk with: no wind-up, half the belt.',
    'No wind-up, much lighter and quicker to aim and swing. Half the rounds, overheats sooner, wider from the hip.',
    { magazine: 0.5, heatRounds: 0.75, moveMult: 1.08, adsTime: 0.85, turnCap: 1.3, hipSpread: 1.1 },
    { set: { spinup: undefined }, notes: ['No wind-up'], look: { mag: 'speedmag' } }),

  sig('s_droversling', 'saw', 'grip', 'Drover Sling', 14,
    'The LMG that walks, walking faster with the sights up.',
    'Moves much faster while aimed. Fewer rounds to overheat, more recoil sway.',
    { adsMoveMult: 1.2, moveMult: 1.02, heatRounds: 0.85, patternAmp: 1.15 }, { look: { grip: 'angled' } }),
  sig('s_quickbarrel', 'saw', 'barrel', 'Quick-Change Barrel', M1,
    'Overheat and be back in the fight before they push.',
    'Much shorter overheat lockout. Fewer rounds to overheat, slower to aim.',
    { heatLockout: 0.55, heatRounds: 0.85, adsTime: 1.05 }, { look: { barrel: 'shroud' } }),

  sig('s_lightbarrels', 'rotary', 'barrel', 'Light Barrels', 14,
    'Lets the freight car turn a corner.',
    'Swings faster and winds up quicker. Lower top rate, fewer rounds to overheat.',
    { turnCap: 1.25, spinupShots: 0.75, rpm: 0.88, heatRounds: 0.9 }, { look: { barrel: 'longbarrel' } }),
  sig('s_overdrive', 'rotary', 'mag', 'Overdrive Motor', M1,
    'More rounds in the air than anything in the game.',
    'Fires faster. Overheats much sooner, swings slower.',
    { rpm: 1.1, heatRounds: 0.8, turnCap: 0.9 }, { look: { mag: 'extmag' } }),

  sig('s_box75', 'lightlmg', 'mag', 'Gantry 75 Box', 14,
    'The box-fed gun that never needs to reload mid-fight.',
    'A much bigger box. Slow to reload, heavier, slower to aim.',
    { magazine: 1.67, reload: 1.3, moveMult: 0.96, adsTime: 1.06 }, { look: { mag: 'extmag' } }),

  sig('s_longbelt', 'beltlmg', 'mag', 'Long Belt', 14,
    'Stays settled longer: more rounds once it has tightened.',
    'A much longer belt. Very slow to reload, heavier on foot.',
    { magazine: 1.45, reload: 1.35, moveMult: 0.95 }, { look: { mag: 'extmag' } }),
  sig('s_bedded', 'beltlmg', 'grip', 'Bedded Receiver', M1,
    'Settles in faster: less spraying before it bites.',
    'Starts tighter and settles in fewer rounds. Slower while aimed, slower to swap.',
    { settleFrom: 0.72, settleShots: 0.8, adsMoveMult: 0.85, swapTime: 1.15 }, { look: { grip: 'vertical' } }),

  // ---------------- Marksman ----------------
  sig('s_cheekpiece', 'dmr', 'optic', 'Tally Cheekpiece', 19,
    'Stay on the scope between shots for the follow-up.',
    'The shot knocks you far less out of the scope. Slower to aim, heavier on foot.',
    { boltKick: 1.2, adsTime: 1.08, moveMult: 0.97 }, { look: { optic: 'reticle' } }),
  conv('k_runaway', 'dmr', 'grip', 'Runaway Sear', 25,
    'A full-auto Tallyman: three to the body instead of two.',
    'Full auto at twice the rate, more rounds. Three to the body, a head hit no longer kills alone, looser aimed fire.',
    { rpm: 2.2, damage: 0.73, magazine: 1.67, bloomPerShot: 0.5, adsSpread: 1.6 },
    {
      set: {
        auto: true, boltKick: undefined, headMax: 2.4, pattern: { amp: 0.012, freq: 0.8, ramp: 3 },
        botUse: { pref: 18, hold: 1.3, flank: 0.8, advance: 3, scoped: true, sight: 2 },
      },
      notes: ['Full auto'], look: { grip: 'vertical' },
    }),

  sig('s_hairtrigger', 'battle', 'grip', 'Hair Trigger', 19,
    'Foreman\'s taps come out faster for those who can keep them on target.',
    'Fires faster. Much more bloom per shot, wider from the hip.',
    { rpm: 1.15, bloomPerShot: 1.35, hipSpread: 1.1 }, { look: { grip: 'wrap' } }),
  sig('s_pinbarrel', 'battle', 'barrel', 'Pin Barrel', M1,
    'Keeps a target pinned out past 45 m.',
    'Damage holds further and fades less. Fires slower, slower to aim.',
    { range: 1.12, falloffMin: 1.1, rpm: 0.9, adsTime: 1.06 }, { look: { barrel: 'heavybarrel' } }),

  sig('s_looplever', 'lever', 'grip', 'Loop Lever', 19,
    'Work the lever from the hip at a run.',
    'Fires faster. Looser aimed fire, slower to aim.',
    { rpm: 1.2, adsSpread: 1.2, adsTime: 1.05 }, { look: { grip: 'wrap' } }),
  conv('k_scatterloads', 'lever', 'mag', 'Scatter Loads', 25,
    'A lever-action shotgun: kills in a shell up close, nothing at range.',
    'Fires six pellets: one shell kills inside 7 m. Far less reach and cover stops it.',
    {},
    {
      set: {
        pellets: 6, damage: 20, adsSpread: 0.03, hipSpread: 0.05, bloomScale: 0.5, range: 20, penetrate: undefined, tracerWidth: 0.6,
        falloff: { start: 7, end: 12, min: 0.3 },
        botUse: { pref: 5, hold: 0.5, flank: 1.4, advance: 3, rush: 10, fireMax: 13, precise: true },
      },
      notes: ['Fires buckshot'], look: { mag: 'extmag' },
    }),

  sig('s_broadhead', 'crossbow', 'mag', 'Broadhead Bolts', 19,
    'A hip-fired bolt that still kills.',
    'More damage and a hip shot kills up close. Bolts drop sooner, slower to load.',
    { damage: 1.1, adsGate: 1.25, range: 0.8, reload: 1.2 }, { look: { mag: 'speedmag' } }),
  sig('s_recurve', 'crossbow', 'grip', 'Recurve Limbs', M1,
    'The silent hunter reaching across a lane.',
    'Kills from further away. Slower to aim, heavier on foot.',
    { range: 1.25, adsTime: 1.1, moveMult: 0.97 }, { look: { grip: 'vertical' } }),

  sig('s_lockstep', 'twinshot', 'grip', 'Lockstep Sear', 19,
    'Both rounds of the pair land before the target moves.',
    'The second round follows much sooner. More recoil sway and bloom.',
    { burstGap: 0.6, patternAmp: 1.3, bloomPerShot: 1.2 }, { look: { grip: 'vertical' } }),

  sig('s_hollowpoint', 'hushdmr', 'mag', 'Hollow Points', 19,
    'Hits harder in the open; cover now stops it.',
    'More damage per round. Cover stops every round, fewer rounds.',
    { damage: 1.15, magazine: 0.9 }, { set: { penetrate: undefined }, notes: [{ text: 'Cover stops every round', better: false }], look: { mag: 'speedmag' } }),

  // ---------------- Sniper ----------------
  sig('s_heavybolt', 'sniper', 'grip', 'Heavy Bolt', 16,
    'Keep the scope up between shots for the second kill.',
    'Working the bolt costs far less of the scope. Fires slower.',
    { boltKick: 1.6, rpm: 0.88 }, { look: { grip: 'wrap' } }),
  conv('k_selfloader', 'sniper', 'mag', 'Self-Loader', 25,
    'A semi-auto Lancet: two quick body shots instead of one slow one.',
    'Fires over twice as fast with more rounds and keeps the scope. Two to the body, looser aimed fire.',
    { rpm: 2.2, damage: 0.78, magazine: 1.6, boltKick: 2, adsSpread: 1.35 },
    { notes: ['Semi-automatic'], look: { mag: 'extmag' } }),

  sig('s_siege', 'antimat', 'mag', 'Siege Rounds', 16,
    'A Monolith round that kills unaimed, for the rusher who gets too close.',
    'Hip and half-aimed shots hit much harder. Fewer rounds, slower reload, less reach.',
    { adsGate: 1.45, magazine: 0.75, reload: 1.15, range: 0.85 }, { look: { mag: 'apmag' } }),
  sig('s_monobrake', 'antimat', 'barrel', 'Monolith Brake', M1,
    'Stay on the scope after the shot.',
    'Firing knocks you far less out of the scope. Slower to aim, heavier on foot.',
    { boltKick: 1.5, adsTime: 1.06, moveMult: 0.96 }, { look: { barrel: 'compensator' } }),

  sig('s_hotchamber', 'semisnipe', 'grip', 'Hot Chamber', 16,
    'For the quickscoper who misses and needs the next one now.',
    'Fires faster. Looser aimed fire.',
    { rpm: 1.25, adsSpread: 1.3 }, { look: { grip: 'angled' } }),
  sig('s_kestreleye', 'semisnipe', 'optic', 'Kestrel Eye', M1,
    'The flick shot from barely aimed.',
    'Aims faster and half-aimed shots hit harder. One-shot range drops, looser aimed fire.',
    { adsTime: 0.85, adsGate: 1.15, range: 0.8, adsSpread: 1.4 }, { look: { optic: 'snapsight' } }),

  sig('s_stripper', 'scout', 'mag', 'Stripper Clips', 16,
    'Seven rounds back in the gun before they push.',
    'Reloads much faster. Heavier on foot, slower to swap.',
    { reload: 0.7, moveMult: 0.97, swapTime: 1.1 }, { look: { mag: 'speedmag' } }),
  sig('s_wingbolt', 'scout', 'grip', 'Wing Bolt', M1,
    'A straight-pull that cycles even faster.',
    'Fires faster. Looser aimed fire.',
    { rpm: 1.12, adsSpread: 1.2 }, { look: { grip: 'wrap' } }),

  sig('s_capacitor', 'rail', 'mag', 'Capacitor Bank', 16,
    'Lets the round go before they finish their peek.',
    'Charges much faster. Fewer rounds, slower reload, a little less damage.',
    { chargeTime: 0.65, magazine: 0.75, reload: 1.15, damage: 0.92 }, { look: { mag: 'speedmag' } }),
  sig('s_overcharge', 'rail', 'barrel', 'Overcharge Coil', M1,
    'A heavier slug that drops anything at any range.',
    'More damage. Much longer charge, heavier on foot.',
    { damage: 1.15, chargeTime: 1.6, moveMult: 0.96 }, { look: { barrel: 'heavybarrel' } }),

  // ---------------- Pistol ----------------
  sig('s_snapholster', 'pistol', 'grip', 'Snap Holster', 24,
    'The swap that wins the fight your primary started.',
    'Comes up and fires out of a sprint much faster. Looser aimed fire, shorter range.',
    { swapTime: 0.6, sprintToFire: 0.8, adsSpread: 1.25, range: 0.85 }, { look: { grip: 'wrap' } }),

  sig('s_speedloader', 'revolver', 'mag', 'Speedloader', 25,
    'All six back in one motion.',
    'Reloads much faster. Heavier on foot, slower to swap.',
    { reload: 0.6, moveMult: 0.97, swapTime: 1.15 }, { look: { mag: 'speedmag' } }),
  sig('s_heavyframe', 'revolver', 'barrel', 'Heavy Frame', M1,
    'A hand cannon that stays on target.',
    'Much less kick and bloom. Fires slower, slower to swap.',
    { patternAmp: 0.7, bloomPerShot: 0.7, rpm: 0.9, swapTime: 1.15 }, { look: { barrel: 'ported' } }),

  sig('s_gnatstock', 'machpistol', 'grip', 'Gnat Stock', 25,
    'A panic button you can aim.',
    'Much less sway, tighter aimed fire. Slow to swap, a little slower on foot.',
    { patternAmp: 0.65, adsSpread: 0.8, swapTime: 1.35, moveMult: 0.98 }, { look: { grip: 'knurl' } }),

  conv('k_tripletap', 'deuce', 'grip', 'Triple Tap', 22,
    'Three rounds a pull: the Deuce as a burst pistol.',
    'Fires three-round bursts with a bigger magazine. Less damage per round.',
    { damage: 0.84, rpm: 1.1, magazine: 1.29 },
    { set: { burst: { count: 3, gap: 0.065 } }, notes: ['Fires three-round bursts'], look: { grip: 'wrap' } }),
  sig('s_longslide', 'deuce', 'barrel', 'Long Slide', 26,
    'A double tap that lands together further out.',
    'Reaches further, the pair lands closer together. Slower to swap and out of a sprint.',
    { range: 1.15, burstGap: 0.85, swapTime: 1.2, sprintToFire: 1.15 }, { look: { barrel: 'longbarrel' } }),

  sig('s_spreader', 'scatter', 'barrel', 'Bramble Spreader', 25,
    'More pellets, wider: a doorway gun that cannot miss.',
    'Eight pellets in a wider fan. Shorter reach.',
    { hipSpread: 1.25, adsSpread: 1.2, range: 0.85 },
    { set: { pellets: 8, damage: 14.5 }, notes: ['Eight pellets'], look: { barrel: 'compensator' } }),

  sig('s_crossfire', 'akimbo', 'grip', 'Crossfire Grips', 25,
    'Both guns on one point.',
    'Tighter from the hip. Fires slower, slower to swap.',
    { hipSpread: 0.85, rpm: 0.9, swapTime: 1.15 }, { look: { grip: 'wrap' } }),

  sig('s_framingdrive', 'nailer', 'mag', 'Framing Drive', 25,
    'Heavier nails: fewer to finish.',
    'More damage per nail. Fires slower, fewer nails.',
    { damage: 1.15, rpm: 0.85, magazine: 0.75 }, { look: { mag: 'speedmag' } }),

  // ---------------- Launcher ----------------
  sig('s_twintube', 'launcher', 'mag', 'Twin Tube', 24,
    'Two rockets before a reload.',
    'A second rocket. A much longer reload, heavier on foot.',
    { magazine: 2, reload: 1.6, moveMult: 0.93 }, { look: { mag: 'warhead' } }),
  sig('s_pumpdrum', 'thumper', 'mag', 'Pump Drum', 24,
    'Six grenades for holding a room.',
    'More grenades. Slower reload, heavier on foot.',
    { magazine: 1.5, reload: 1.3, moveMult: 0.96 }, { look: { mag: 'warhead' } }),
  sig('s_tightpack', 'salvo', 'barrel', 'Tight Pack', 24,
    'All three rockets on one doorway.',
    'Rockets leave closer together and fly truer. Smaller blasts.',
    { burstGap: 0.6, adsSpread: 0.8, blastRadius: 0.85 }, { look: { barrel: 'longtube' } }),

  // ---------------- Melee ----------------
  sig('s_serrated', 'knife', 'barrel', 'Serrated Hook', 5,
    'Reach the target your lunge did not quite.',
    'Longer reach. Slower on foot.',
    { range: 1.2, moveMult: 0.97 }),
  sig('s_lungestrap', 'knife', 'grip', 'Lunge Strap', 15,
    'Throw yourself across the gap.',
    'Lunges much further. Swings slower.',
    { lunge: 1.3, rpm: 0.85 }),
  sig('s_ironhead', 'maul', 'barrel', 'Iron Head', 5,
    'A heavier head: longer reach and through armour.',
    'More damage and reach. Swings slower, heavier on foot.',
    { damage: 1.15, range: 1.15, rpm: 0.82, moveMult: 0.96 }),
  sig('s_lighthaft', 'maul', 'grip', 'Ash Haft', 15,
    'A lighter Maul you can swing twice.',
    'Swings much faster and moves faster. Less damage and reach.',
    { rpm: 1.3, moveMult: 1.03, damage: 0.78, range: 0.88 }),
];

export const V11_ATTACHMENTS = Object.fromEntries(LIST.map(a => [a.id, a]));
