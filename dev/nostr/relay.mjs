// Minimal Nostr relay for tests: EVENT/REQ/CLOSE, #x and kinds filters, ephemeral kinds never stored.
// Usage: node relay.mjs PORT   Logs one line per received EVENT to stdout.
import { WebSocketServer } from '/tmp/ui/relay/node_modules/ws/wrapper.mjs';
const port = Number(process.argv[2] || 7447);
const wss = new WebSocketServer({ port });
const stored = [];
const match = (f, ev) => (!f.kinds || f.kinds.includes(ev.kind)) && (!f['#x'] || ev.tags.some(t => t[0] === 'x' && f['#x'].includes(t[1])))
  && (!f.since || ev.created_at >= f.since);
wss.on('connection', ws => {
  ws.subs = new Map();
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (m[0] === 'EVENT') {
      const ev = m[1];
      ws.send(JSON.stringify(['OK', ev.id, true, '']));
      console.log('EVENT', ev.kind, ev.tags?.[0]?.[1], ev.content);
      if (ev.kind < 20000 || ev.kind >= 30000) stored.push(ev);
      for (const c of wss.clients) for (const [id, fs] of c.subs) if (fs.some(f => match(f, ev))) c.send(JSON.stringify(['EVENT', id, ev]));
    } else if (m[0] === 'REQ') {
      const [, id, ...fs] = m;
      ws.subs.set(id, fs);
      for (const ev of stored) if (fs.some(f => match(f, ev))) ws.send(JSON.stringify(['EVENT', id, ev]));
      ws.send(JSON.stringify(['EOSE', id]));
    } else if (m[0] === 'CLOSE') ws.subs.delete(m[1]);
  });
});
console.log('relay on', port);
