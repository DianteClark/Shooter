// Opus settings for team voice. Trystero gives no hook for codec parameters, so they are set where it does let us in:
// the rtcPolyfill peer-connection class (see net.js) and the RTCRtpSender of each outgoing mic track.
//
// The fmtp line in an SDP tells the remote encoder what this side wants to receive, so both the offer and the answer are
// rewritten; a peer that ignores a value simply keeps its default.
export const VOICE_BITRATE = 32000;    // Mono wideband speech at this rate is clean, and leaves room for FEC.

const OPUS_PARAMS = {
  useinbandfec: 1,                     // In-band forward error correction: a lost packet is rebuilt from the next one.
  usedtx: 0,                           // Silence suppression makes the receiver's jitter buffer guess; it is audible as clicks.
  stereo: 0,
  'sprop-stereo': 0,
  maxaveragebitrate: VOICE_BITRATE,
};

// Rewrites the fmtp line of every Opus payload in the SDP. Lines of other codecs are untouched.
export function mungeOpus(sdp) {
  if (typeof sdp !== 'string') return sdp;
  const eol = sdp.includes('\r\n') ? '\r\n' : '\n';
  const lines = sdp.split(eol);
  const payloads = [];
  for (const line of lines) {
    const m = /^a=rtpmap:(\d+) opus\/48000/i.exec(line);
    if (m) payloads.push(m[1]);
  }
  for (const pt of payloads) {
    const at = lines.findIndex(l => l.startsWith(`a=fmtp:${pt} `));
    if (at >= 0) {
      lines[at] = `a=fmtp:${pt} ${mergeParams(lines[at].slice(`a=fmtp:${pt} `.length))}`;
    } else {
      const rtpmap = lines.findIndex(l => l.startsWith(`a=rtpmap:${pt} `));
      lines.splice(rtpmap + 1, 0, `a=fmtp:${pt} ${mergeParams('')}`);
    }
  }
  return lines.join(eol);
}

function mergeParams(existing) {
  const kept = existing.split(';').map(s => s.trim()).filter(s => s && !(s.split('=')[0].toLowerCase() in OPUS_PARAMS));
  return [...kept, ...Object.entries(OPUS_PARAMS).map(([k, v]) => `${k}=${v}`)].join(';');
}

// Caps and prioritises one outgoing audio sender. Browsers that refuse a field keep working without it.
export async function tuneAudioSender(sender) {
  if (!sender?.track || sender.track.kind !== 'audio' || !sender.getParameters || !sender.setParameters) return;
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) return;
    for (const e of params.encodings) {
      e.maxBitrate = VOICE_BITRATE;
      e.priority = 'high';
      e.networkPriority = 'high';
    }
    await sender.setParameters(params);
  } catch { /* An optional refinement: the SDP already asked for the same rate. */ }
}
