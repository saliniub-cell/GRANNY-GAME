/* GRANNY'S HOUSE - multiplayer relay server
   Run:  npm install && npm start      then open  http://localhost:3000
   The server also serves granny.html, so everyone just opens the same URL.
   Rooms: add ?room=NAME to the URL (or type it on the join screen). */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
let WebSocketServer;
try { ({ WebSocketServer } = require('ws')); }
catch (e) { console.error("Missing dependency 'ws'. Run:  npm install   then   npm start"); process.exit(1); }

// Never let one bad packet or socket take the whole server down.
process.on('uncaughtException', e => console.error('[server] uncaught:', e && e.message));
process.on('unhandledRejection', e => console.error('[server] unhandled:', e && e.message));

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HTML_FILE = path.join(__dirname, 'granny.html');
const MAX_PLAYERS = 8;

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (url === '/' || url === '/index.html' || url === '/granny.html') {
    fs.readFile(HTML_FILE, (err, data) => {
      if (err) { res.writeHead(500); res.end('granny.html not found next to server.js'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } else if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }); res.end('ok');
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) {} });
const wss = new WebSocketServer({ server, maxPayload: 8 * 1024, perMessageDeflate: false });
wss.on('error', e => { if (e && e.code === 'EADDRINUSE') return; console.error('[ws] error:', e && e.message); });
const rooms = new Map();
let nextId = 1;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
function makeRoom(id) {
  const o = shuffle(['pliers', 'hammer', 'gasCan', 'battery', 'sparkPlug', 'carKey']);
  return {
    id, players: new Map(), order: [], hostId: null, difficulty: null,
    pool: [o[0], 'padlockKey', o[1], 'masterKey', o[2], o[3], o[4], o[5]],
    rots: Array.from({ length: 8 }, () => Math.random() * Math.PI * 2),
    cabTaken: new Set(), dropped: new Map(), nextItem: 1,
    door: { alarm: false, plank: false, padlock: false, knob: false },
    car: { fuel: false, battery: false, spark: false },
    vases: [false, false]
  };
}
function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(room, obj, exceptId) {
  const s = JSON.stringify(obj);
  room.players.forEach(p => { if (p.id !== exceptId && p.ws.readyState === 1) p.ws.send(s); });
}
function electHost(room) {
  const cur = room.players.get(room.hostId);
  if (cur && cur.ready && !cur.out) return;
  let nh = null;
  for (const id of room.order) {
    const p = room.players.get(id);
    if (p && p.ready && !p.out) { nh = id; break; }
  }
  if (nh !== room.hostId) { room.hostId = nh; broadcast(room, { t: 'host', id: nh }); }
}
function cleanName(s) {
  s = String(s || '').replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  return s || 'Player';
}
function uniqueName(room, name) {
  const taken = new Set([...room.players.values()].map(p => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let i = 2; i < 100; i++) { const n = (name.slice(0, 13) + i); if (!taken.has(n.toLowerCase())) return n; }
  return name + Math.floor(Math.random() * 1000);
}
const num = v => (typeof v === 'number' && isFinite(v)) ? v : 0;

wss.on('connection', (ws) => {
  let room = null, me = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'join') {
      if (me) return;
      const rid = String(m.room || 'main').replace(/[^\w\-]/g, '').slice(0, 20) || 'main';
      room = rooms.get(rid);
      if (!room) { room = makeRoom(rid); rooms.set(rid, room); }
      if (room.players.size >= MAX_PLAYERS) { send(ws, { t: 'error', msg: 'Room is full (' + MAX_PLAYERS + ' players max).' }); ws.close(); room = null; return; }
      const id = 'p' + (nextId++);
      me = { id, ws, name: uniqueName(room, cleanName(m.name)), ci: room.order.length % 8, ready: false, out: false, diff: 'medium', lastChat: 0 };
      room.players.set(id, me); room.order.push(id);
      send(ws, {
        t: 'welcome', id, ci: me.ci, name: me.name, room: room.id,
        pool: room.pool, rots: room.rots, hostId: room.hostId,
        players: [...room.players.values()].filter(p => p.id !== id).map(p => ({ id: p.id, name: p.name, ci: p.ci, ready: p.ready, out: p.out, diff: p.diff })),
        world: {
          cabTaken: [...room.cabTaken],
          dropped: [...room.dropped.values()],
          door: room.door, car: room.car, vases: room.vases
        }
      });
      broadcast(room, { t: 'joined', id, name: me.name, ci: me.ci }, id);
      return;
    }
    if (!me || !room) return;

    switch (m.t) {
      case 'ping': break;
      case 'difficulty': // each player has their own difficulty; Granny treats each player accordingly
        if (['easy', 'medium', 'hard', 'nightmare', 'impossible'].includes(m.d)) {
          me.diff = m.d; broadcast(room, { t: 'pdiff', id: me.id, d: m.d }, me.id);
        }
        break;
      case 'ready': me.ready = true; me.out = false; electHost(room); break;
      case 'out': me.out = true; broadcast(room, { t: 'out', id: me.id, why: m.why === 'failed' ? 'failed' : 'escaped' }, me.id); electHost(room); break;
      case 'escaped': me.out = true; broadcast(room, { t: 'escaped', id: me.id, name: me.name, how: String(m.how || '').slice(0, 40) }, me.id); electHost(room); break;
      case 'state':
        broadcast(room, {
          t: 'state', id: me.id, x: num(m.x), y: num(m.y), z: num(m.z), ry: num(m.ry), rp: num(m.rp),
          c: m.c ? 1 : 0, h: m.h ? 1 : 0, k: m.k ? 1 : 0, m: m.m ? 1 : 0,
          it: typeof m.it === 'string' ? m.it.slice(0, 20) : null, ic: num(m.ic)
        }, me.id);
        break;
      case 'granny':
        if (room.hostId === me.id) broadcast(room, {
          t: 'granny', x: num(m.x), y: num(m.y), z: num(m.z), f: num(m.f),
          s: String(m.s || '').slice(0, 16), m: m.m ? 1 : 0, ct: typeof m.ct === 'string' ? m.ct.slice(0, 12) : null
        }, me.id);
        break;
      case 'noise':
        if (room.hostId && room.hostId !== me.id) {
          const h = room.players.get(room.hostId);
          if (h) send(h.ws, { t: 'noise', from: me.id, x: num(m.x), y: num(m.y), z: num(m.z), r: Math.min(60, Math.max(0, num(m.r))) });
        }
        break;
      case 'pickup': {
        const id = String(m.id || '');
        let ok = false;
        if (/^c[0-7]$/.test(id)) { const i = +id[1]; if (!room.cabTaken.has(i)) { room.cabTaken.add(i); ok = true; } }
        else if (room.dropped.has(id)) { room.dropped.delete(id); ok = true; }
        send(ws, { t: 'pickupResult', id, ok });
        if (ok) broadcast(room, { t: 'itemGone', id }, me.id);
        break;
      }
      case 'drop': {
        const it = {
          id: 'd' + (room.nextItem++), name: String(m.name || '').slice(0, 20), color: num(m.color),
          x: num(m.x), y: num(m.y), z: num(m.z), gy: num(m.gy)
        };
        if (!['pliers', 'hammer', 'padlockKey', 'masterKey', 'gasCan', 'battery', 'sparkPlug', 'carKey'].includes(it.name)) break;
        room.dropped.set(it.id, it);
        broadcast(room, Object.assign({ t: 'itemDropped', by: me.id }, it));
        break;
      }
      case 'door':
        if (m.step in room.door) { room.door[m.step] = true; broadcast(room, { t: 'door', step: m.step }, me.id); }
        break;
      case 'car':
        if (m.part in room.car) { room.car[m.part] = true; broadcast(room, { t: 'car', part: m.part }, me.id); }
        break;
      case 'vase': {
        const i = m.i | 0;
        if (i === 0 || i === 1) { room.vases[i] = true; broadcast(room, { t: 'vase', i }, me.id); }
        break;
      }
      case 'caught':
        if (room.hostId === me.id) { const p = room.players.get(String(m.id)); if (p) send(p.ws, { t: 'caught' }); }
        break;
      case 'chat': {
        const now = Date.now();
        if (now - me.lastChat < 400) break;
        me.lastChat = now;
        const text = String(m.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 120);
        if (text) broadcast(room, { t: 'chat', id: me.id, name: me.name, ci: me.ci, text });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room || !me) return;
    room.players.delete(me.id);
    room.order = room.order.filter(i => i !== me.id);
    broadcast(room, { t: 'left', id: me.id, name: me.name });
    if (room.hostId === me.id) { room.hostId = null; }
    electHost(room);
    if (room.players.size === 0) rooms.delete(room.id);
  });
  ws.on('error', () => {});
});

setInterval(() => {
  wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; try { ws.ping(); } catch (e) {} });
}, 20000);

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(n => (nets[n] || []).forEach(i => { if (i.family === 'IPv4' && !i.internal) out.push(i.address); }));
  return out;
}
function start(port, triesLeft) {
  const onError = (err) => {
    server.removeListener('listening', onListening);
    if (err.code === 'EADDRINUSE' && triesLeft > 0) {
      console.warn('Port ' + port + ' is already in use - trying ' + (port + 1) + '...');
      start(port + 1, triesLeft - 1);
    } else {
      console.error('Server failed to start: ' + err.message);
      process.exit(1);
    }
  };
  const onListening = () => {
    server.removeListener('error', onError);
    server.on('error', e => console.error('[http] error:', e && e.message));
    console.log("GRANNY'S HOUSE multiplayer server is running!");
    console.log('  This computer :  http://localhost:' + port);
    lanAddresses().forEach(ip => console.log('  Same Wi-Fi    :  http://' + ip + ':' + port));
    console.log('Rooms: add ?room=NAME to the address.   Stop with Ctrl+C.');
  };
  server.once('error', onError);
  server.once('listening', onListening);
  server.listen(port, '0.0.0.0');
}
start(PORT, 10);

function shutdown() {
  console.log('\nShutting down...');
  wss.clients.forEach(c => { try { c.close(1001); } catch (e) {} });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
