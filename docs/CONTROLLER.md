# Controllers and voice (roadmap items 28 and 29)

## Controllers

`js/ui/gamepad.js` reads game controllers through the Gamepad API: PlayStation (DualShock 4, DualSense), Xbox and MFi
pads, on iPhone Safari and the Home Screen app (iOS pairs them over Bluetooth) and on Android Chrome. Only the W3C
"standard" button layout is read; every pad those browsers support reports it.

One poll per animation frame (`GamepadInput.tick`) does one of three things:

| Situation | What the pad does |
|---|---|
| In a match, nothing open over it | Twin-stick play. `Controls.read()` calls `pad.merge(input)` last, so the controller writes the same Input object the touch sticks write; match.js, aim assist and the sim see no difference. |
| In a menu, or a panel over the match (pause board, quick chat wheel, death screen and loadout picker, BR map, BR/extraction out screen, contract phone, armory) | Focus ring navigation over the topmost layer's tappable elements (`button, [data-act], [data-tap]`, as tap.js). The sticks never move the player while a panel is open. |
| Options > Controller waiting for a button | The next press goes to the remap screen and nowhere else. |

**In use.** The pad counts as in use from its first button press or stick push until the next touch on the glass. While
in use `<body>` has `.pad-on`: the on-screen sticks, buttons and throw rig fade out (opacity only, so measured rects stay
valid), the focus ring shows, and prompts show glyphs. A touch removes `.pad-on` and touch play carries on as before.

**Connect and disconnect** show a toast (the match feed in a match): "Xbox controller connected", "PlayStation
controller disconnected". iOS only reports a pad after its first button press; polling covers that too. A pad that
disconnects, or a page that loses focus, lets go of everything held (fire, sprint, push to talk, a peeked board).

### Default buttons

| Action | Xbox / MFi | PlayStation | Notes |
|---|---|---|---|
| Move | Left stick | Left stick | Radial deadzone (Options), rescaled so the edge of the deadzone is zero |
| Aim | Right stick | Right stick | Absolute direction, eased by Aim sensitivity; Invert Y flips it |
| Aim (ADS) | LT | L2 | Also on whenever the right stick is pushed, as the touch aim stick does |
| Fire | RT | R2 | With the right stick at rest the gun keeps its facing, so aim assist still pulls |
| Sprint | LS click | L3 | Toggle; ends when you stop, fire or aim |
| Slide | B | Circle | |
| Reload | X | Square | New `input.reload`: a manual reload of a part-empty magazine (touch keeps auto top-off) |
| Swap weapon | Y | Triangle | |
| Tactical / Lethal | LB / RB | L1 / R1 | Tap: throw where you face at the default range. Hold: the arc shows; the right stick's push sets the range. Stim and a satchel's detonator fire on the press |
| Melee | RS click | R3 | New `input.melee`: swings a blade in hand, or brings out the one in the other slot (match.js) |
| Interact | A | Cross | Presses the first visible of: Jump, Take (BR loot), Buy/Open (zombies), Call exfil, Contracts, Self-revive, Respawn |
| Streak (next ready) | D-pad left | D-pad left | Calls the first lit streak tile. Streak 1/2/3 can be bound separately (unbound by default) |
| Ping | D-pad up | D-pad up | Sends the "Enemy spotted" callout, which pings your position for the team |
| Quick chat | D-pad down | D-pad down | Opens the callout wheel; the ring picks, A sends, B closes |
| Push to talk | D-pad right | D-pad right | Only in Hold to talk mode |
| Scoreboard | View | Create | Shown while held |
| Pause | Menu | Options | Opens the scoreboard as a menu (Leave match, mutes); B or Pause again closes it |

Menus always use the fixed layout: d-pad or left stick moves the ring (hold to repeat), A/Cross presses, B/Circle goes
back (the screen's Back/Done/Close), LB/RB (L1/R1) step through the first tab strip on screen.

**Spatial navigation.** From the focused element's centre, the nearest candidate ahead in the pressed direction wins;
sideways distance costs 2.5x distance ahead, and an element overlapping on the cross axis has no sideways cost, so a row
is walked before the ring jumps rows. The focus survives repaints (lobby, vote, tabs rebuild their markup) by a key made
of the tag, first class and data attributes. With nothing focused, the ring starts on the screen's primary button.

Pressing is `el.click()`, the call tap.js makes for a finger, preceded by a synthetic `pointerdown`/`pointerup` for the
few handlers that look for one (the respawn picker's cards). Sounds come from tap.js's click listener as for a tap.

### Glyphs

Two CSS variables on `<body>` carry the prompts, rewritten only when the family or a binding changes: `--pad-interact`
(a badge on Take, Buy, Exfil, Jump, Respawn and Self-revive buttons) and `--pad-streak` (under lit streak tiles). The
family is PlayStation when the pad's id names Sony (054c, DualSense, DualShock, or Chrome's bare "Wireless
Controller"), otherwise Xbox-style letters (Xbox and MFi share the A/B/X/Y layout).

### Options > Controller

`js/ui/controllerscreen.js`, opened from the Controller button on the Controls column of Options. Saved in Options
(this phone only, like every setting):

- `padDead` Stick deadzone, 5% to 35% (default 15%), both sticks and menu navigation.
- `padSens` Aim sensitivity, 0.5x to 2x: how fast the facing eases onto the right stick (rate 22/s at 1x).
- `padInvertY` Invert Y for the right stick.
- `padMap` only the actions moved off their default: action id to button index, -1 unbound. Binding a button that
  another action holds swaps the two, so no button ever does two things. Default buttons clears the map.

The remap list: tap an action (or press A on it), then press the button within six seconds.

### Hooks other code relies on

- `Controls.pad` (set by GamepadInput) and the `reload`/`melee` fields of the Input object.
- `hud.boardOpen`, `hud.boardEl`, `hud.toggleBoard()` for pause and the scoreboard peek.
- `quickChat.btn`, `quickChat.send(i)`, `quickChat.ctx` for ping and the wheel.
- The panel and interact selectors at the top of gamepad.js (`MATCH_PANELS`, `INTERACT`). A HUD redesign that renames
  those elements should update the lists there.

### Test

`python3 dev/ui-gamepad-test.py [port]` fakes `navigator.getGamepads` (a standard Xbox pad whose buttons and axes the
test writes): connect toast, controller mode, remap with swap and reset, B back out of Options, title to Custom to a solo
match by d-pad and A, move, aim, fire, reload, pause open/close with the ring on the board, the scoreboard peek, ping,
quick chat by the ring, touch leaving controller mode, the disconnect toast in the match feed.

## Voice

`js/net/voice.js` (one `Voice` per room session, made in main.js `wireSharedNet`) carries audio peer to peer over the
Trystero mesh; incoming voice plays through `<audio>` elements and never through Web Audio (iOS crackles otherwise).

- **Open mic or push to talk** (Options, the Mic chip on the Audio heading; `voiceMode` 'open' | 'ptt'). Open mic: a tap
  on the mic toggles it, as before. Push to talk: hold the HUD mic, the lobby mic, or the controller's Talk button. The
  first hold asks for the microphone; the capture is then kept and its track is enabled only for the hold. Switching
  modes stops the mic. The mic button shows `data-state="ptt"` (sodium) when ready and `on` while sending.
- **Party voice in the lobby.** Before and between matches `updateVoiceTeam` sends to every human in the friend lobby;
  in a match it narrows to your team (everyone in free-for-all and zombies), as before. The lobby header has a Mic chip
  when the room has voice.
- **Per-player mute.** A mute plate on every other player's lobby car and on each scoreboard row of a player whose voice
  reaches you. Muting silences that player's `<audio>` element on this phone only; mutes outlive a room session (a
  module-level set), so a rematch or host change keeps them.
- **Speaking marks.** `voice.speaking()` reads each incoming track's RTP audio level with
  `RTCRtpReceiver.getSynchronizationSources()` (no Web Audio); above 0.03 a player is talking, held for 450 ms so the mark
  does not flicker. You count as talking while you hold push to talk, or in open mic while the sender's `media-source`
  stats report a level above the floor. `js/ui/voice-ui.js` paints every `[data-voice="<id>"]` element with `.talking`
  (a pulsing mic beside the name in the lobby and on the scoreboard) and lists talking teammates under the HUD's corner
  chips in a match.

Markup hooks (voice-ui.js paints them every 150 ms): `[data-voice]` (talking mark), `[data-voice-mute]` (mute plate,
hidden unless that player's voice reaches this phone), `.lb-mic` (lobby mic state and label). hud.js only tags each
scoreboard row with `data-voice`; voice-ui.js adds the dot and mute button inside `.lb-name`. Styles: css/voice.css.

Test: `python3 dev/ui-voice-test.py [port]` builds a real Voice on a fake room (peer connections whose receivers report
levels the test sets, getUserMedia stubbed): the Options chip, push to talk on the lobby mic, party voice reaching the
whole lobby, mute plates, muting one player only, talking marks on and off, open mic toggling.
