'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { makeMatch, beginRound, input, tick, publicState, MODES } = require('./engine');

const PUBLIC = path.resolve(__dirname, '../public');
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MSG = 4096;
function code() { return Array.from(crypto.randomBytes(6), b => alphabet[b % alphabet.length]).join(''); }
function token() { return crypto.randomBytes(24).toString('base64url'); }
function cleanName(value) { return typeof value === 'string' ? value.replace(/[<>\x00-\x1f]/g, '').trim().slice(0, 18) : ''; }

function makeSocket(raw, onMessage, onClose) {
  let buffer = Buffer.alloc(0), closed = false, lastActivity = Date.now(), rateCount = 0, rateStart = Date.now();
  function frame(op, body = Buffer.alloc(0)) {
    if (closed || !raw.writable || raw.destroyed) return;
    if (!Buffer.isBuffer(body)) body = Buffer.from(body);
    const n = body.length;
    const header = Buffer.alloc(n < 126 ? 2 : 4);
    header[0] = 0x80 | op;
    if (n < 126) header[1] = n;
    else { header[1] = 126; header.writeUInt16BE(n, 2); }
    if (raw.writableLength < 600_000) raw.write(Buffer.concat([header, body]));
  }
  const ws = {
    send(data) { frame(0x1, Buffer.from(JSON.stringify(data))); },
    ping() { frame(0x9); },
    close() { if (closed) return; frame(0x8); raw.end(); },
    get lastActivity() { return lastActivity; },
    get closed() { return closed; },
  };
  const fail = () => { if (!closed) raw.destroy(); };
  raw.on('data', data => {
    buffer = Buffer.concat([buffer, data]);
    if (buffer.length > 96 * 1024) return fail();
    while (buffer.length >= 2) {
      const b0 = buffer[0], b1 = buffer[1];
      const opcode = b0 & 15, fin = Boolean(b0 & 0x80), masked = Boolean(b1 & 0x80);
      let len = b1 & 127, offset = 2;
      if (!fin || !masked || (b0 & 0x70) !== 0) return fail();
      if (len === 127) return fail();
      if (len === 126) { if (buffer.length < 4) break; len = buffer.readUInt16BE(2); offset = 4; }
      if (len > MAX_MSG) return fail();
      if (buffer.length < offset + 4 + len) break;
      const mask = buffer.subarray(offset, offset + 4), payload = Buffer.from(buffer.subarray(offset + 4, offset + 4 + len));
      buffer = buffer.subarray(offset + 4 + len);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      lastActivity = Date.now();
      if (opcode === 0x8) { ws.close(); return; }
      if (opcode === 0x9) { frame(0xA, payload); continue; }
      if (opcode === 0xA) continue;
      if (opcode !== 0x1) return fail();
      const now = Date.now();
      if (now - rateStart > 1000) { rateStart = now; rateCount = 0; }
      if (++rateCount > 70) return fail();
      try { onMessage(ws, JSON.parse(payload.toString('utf8'))); } catch (e) {
        if (e instanceof SyntaxError) ws.send({ type: 'error', message: 'Invalid message.' });
        else { console.error('WS message error:', e); ws.send({ type: 'error', message: 'Could not process action.' }); }
      }
    }
  });
  raw.on('close', () => { closed = true; onClose(ws); });
  raw.on('error', () => {});
  return ws;
}

function createGameServer() {
  const rooms = new Map();
  const clients = new Map();
  const files = {
    '/': ['index.html', 'text/html; charset=utf-8'],
    '/index.html': ['index.html', 'text/html; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
    '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
    '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  };
  const server = http.createServer((req, res) => {
    const route = (req.url || '').split('?')[0];
    if (route === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, service: 'dodge-arena', rooms: rooms.size }));
    }
    const file = files[route];
    if (!file || req.method !== 'GET') { res.writeHead(404); return res.end('Not found'); }
    const abs = path.join(PUBLIC, file[0]);
    fs.readFile(abs, (err, contents) => {
      if (err) { res.writeHead(500); return res.end('Missing game assets'); }
      res.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(contents);
    });
  });
  function playerInfo(room) { return room.seats.map((s, i) => s ? ({ seat: i, name: s.name, ready: s.ready, connected: Boolean(s.ws && !s.ws.closed) }) : null); }
  function state(room) {
    return { type: 'state', room: { code: room.code, mode: room.mode, players: playerInfo(room), phase: room.match?.phase || 'lobby' }, game: room.match ? publicState(room.match) : null };
  }
  function sendState(room) {
    const data = state(room);
    for (const s of room.seats) if (s?.ws && !s.ws.closed) s.ws.send(data);
  }
  function error(ws, message) { ws.send({ type: 'error', message }); }
  function bind(ws, room, seat) {
    if (clients.has(ws)) { error(ws, 'Already in a room.'); return; }
    const s = room.seats[seat];
    if (s.ws && s.ws !== ws && !s.ws.closed) s.ws.close();
    s.ws = ws; clients.set(ws, { room, seat }); room.lastActive = Date.now();
    ws.send({ type: 'joined', code: room.code, seat, token: s.token });
    if (room.match?.phase === 'paused' && room.seats.every(p => p?.ws && !p.ws.closed)) {
      room.match.phase = 'resume'; room.match.countdown = 3.1;
    }
    sendState(room);
  }
  function handle(ws, msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    const t = msg.type;
    if (t === 'create') {
      if (clients.has(ws)) return error(ws, 'Already in a room.');
      const name = cleanName(msg.name); if (!name) return error(ws, 'Enter a player name first.');
      let c; do { c = code(); } while (rooms.has(c));
      const room = { code: c, seats: [{ name, token: token(), ready: false, ws: null }, null], mode: 'classic', match: null, lastActive: Date.now() };
      rooms.set(c, room); bind(ws, room, 0); return;
    }
    if (t === 'join') {
      if (clients.has(ws)) return error(ws, 'Already in a room.');
      const name = cleanName(msg.name); if (!name) return error(ws, 'Enter a player name first.');
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) return error(ws, 'Room not found. Check the six-character code.');
      if (room.seats[1] || room.match) return error(ws, 'This room already has two players.');
      room.seats[1] = { name, token: token(), ready: false, ws: null };
      bind(ws, room, 1); return;
    }
    if (t === 'rejoin') {
      if (clients.has(ws)) return;
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      const seat = room?.seats.findIndex(s => s?.token && s.token === msg.token);
      if (!room || seat < 0 || typeof msg.token !== 'string') return error(ws, 'Your old room expired. Please join a new room.');
      bind(ws, room, seat); return;
    }
    const context = clients.get(ws);
    if (!context) return error(ws, 'Create or join a room first.');
    const { room, seat } = context;
    const s = room.seats[seat];
    if (!s || s.ws !== ws) return;
    room.lastActive = Date.now();
    if (t === 'ready') {
      if (room.match) return;
      s.ready = Boolean(msg.value); sendState(room); return;
    }
    if (t === 'mode') {
      if (seat !== 0 || room.match) return;
      if (!Object.hasOwn(MODES, msg.mode)) return;
      room.mode = msg.mode; sendState(room); return;
    }
    if (t === 'start') {
      if (seat !== 0 || room.match) return;
      if (!room.seats.every(p => p?.ready && p.ws && !p.ws.closed)) return error(ws, 'Both players must be connected and ready.');
      room.match = makeMatch(room.seats.map(p => p.name), crypto.randomBytes(4).readUInt32BE(), room.mode);
      beginRound(room.match); sendState(room); return;
    }
    if (t === 'input') { if (room.match) input(room.match, seat, msg.left, msg.right, msg.shield); return; }
    if (t === 'emote') {
      const emoji = ['🔥', '💙', '😱', 'GG', '✨', '😎'].includes(msg.emoji) ? msg.emoji : null;
      if (emoji) for (const player of room.seats) player?.ws?.send({ type: 'emote', seat, emoji });
      return;
    }
    if (t === 'rematch') {
      if (seat !== 0 || !room.match || room.match.phase !== 'finished') return;
      room.match = null; for (const p of room.seats) if (p) p.ready = false;
      sendState(room);
    }
  }
  server.on('upgrade', (req, raw, head) => {
    if (req.url?.split('?')[0] !== '/ws' || req.headers.upgrade?.toLowerCase() !== 'websocket') return raw.destroy();
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(key)) return raw.destroy();
    const origin = req.headers.origin;
    if (origin) {
      try { if (new URL(origin).host !== req.headers.host) return raw.destroy(); } catch { return raw.destroy(); }
    }
    raw.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
    const ws = makeSocket(raw, handle, closed => {
      const ctx = clients.get(closed); clients.delete(closed);
      if (!ctx) return;
      const { room, seat } = ctx;
      if (room.seats[seat]?.ws === closed) room.seats[seat].ws = null;
      if (room.match && ['playing', 'countdown', 'intermission', 'resume'].includes(room.match.phase)) {
        room.match.resumePhase = room.match.phase === 'resume' ? (room.match.resumePhase || 'playing') : room.match.phase;
        room.match.phase = 'paused';
      }
      sendState(room);
    });
    if (head.length) raw.emit('data', head);
  });
  let lastTick = process.hrtime.bigint(); let frameCount = 0;
  const timer = setInterval(() => {
    const now = process.hrtime.bigint(); const dt = Math.min(Number(now - lastTick) / 1e9, .08); lastTick = now;
    frameCount++;
    for (const room of rooms.values()) {
      if (room.match) tick(room.match, dt);
      if (frameCount % 2 === 0 && room.match && ['playing', 'countdown', 'resume', 'intermission'].includes(room.match.phase)) sendState(room);
      if (Date.now() - room.lastActive > 45 * 60_000 && room.seats.every(s => !s?.ws || s.ws.closed)) rooms.delete(room.code);
    }
  }, 40);
  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const ws of clients.keys()) {
      if (now - ws.lastActivity > 90_000) ws.close(); else ws.ping();
    }
  }, 25_000);
  return {
    server, rooms,
    listen(port = 0, host = '0.0.0.0') { return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(server.address()); }); }); },
    async close() { clearInterval(timer); clearInterval(heartbeat); for (const room of rooms.values()) for (const p of room.seats) if (p?.ws) p.ws.close(); await new Promise(resolve => server.close(resolve)); },
  };
}
if (require.main === module) {
  const app = createGameServer();
  app.listen(Number(process.env.PORT) || 3000).then(addr => console.log(`Dodge Arena Online ready on http://localhost:${addr.port}`));
}
module.exports = { createGameServer };
