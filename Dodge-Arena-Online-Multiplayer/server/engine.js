'use strict';

const WIDTH = 760;
const HEIGHT = 500;
const PLAYER_Y = 428;
const RADIUS = 16;
const MOVE_SPEED = 445;
const ROUNDS = 3;
const MODES = Object.freeze({
  chill: { label: 'Chill Run', duration: 44, hearts: 4, speed: 185, spawnEvery: 0.94, cooldown: 5.2 },
  classic: { label: 'Classic Clash', duration: 53, hearts: 3, speed: 225, spawnEvery: 0.78, cooldown: 6.1 },
  chaos: { label: 'Chaos Mode', duration: 62, hearts: 2, speed: 265, spawnEvery: 0.65, cooldown: 7.0 },
});

function rng(seed) {
  let x = (seed >>> 0) || 42;
  return () => { x = (x + 0x6D2B79F5) >>> 0; let t = x; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function createPlayer(name, seat) {
  return { name: String(name).slice(0, 20), seat, x: WIDTH / 2, hp: 0, alive: true, survived: 0, gems: 0, roundScore: 0, totalScore: 0, wins: 0, shield: 0, cooldown: 0, invuln: 0, collected: new Set(), hit: new Set(), left: false, right: false, shieldRequest: false };
}
function makeMatch(names, seed, mode = 'classic') {
  if (!MODES[mode]) throw new Error('Invalid mode');
  return { seed: seed >>> 0, mode, phase: 'lobby', round: 0, elapsed: 0, nextWave: 0, nextGem: 0, hazards: [], gems: [], nextId: 0, random: rng(seed), players: names.map((n, i) => createPlayer(n, i)), history: [], countdown: 0, intermission: 0, resumePhase: null };
}
function beginRound(m) {
  if (m.round >= ROUNDS) return false;
  m.round++;
  m.phase = 'countdown'; m.countdown = 3.15;
  m.elapsed = 0; m.nextWave = 0.85; m.nextGem = 2.2; m.nextId = 0; m.hazards = []; m.gems = [];
  m.random = rng((m.seed ^ Math.imul(m.round, 2654435761)) >>> 0);
  const cfg = MODES[m.mode];
  for (const p of m.players) {
    p.x = WIDTH / 2; p.hp = cfg.hearts; p.alive = true; p.survived = 0; p.gems = 0; p.roundScore = 0;
    p.shield = 0; p.cooldown = 0; p.invuln = 0; p.collected = new Set(); p.hit = new Set();
    p.left = false; p.right = false; p.shieldRequest = false;
  }
  return true;
}
function input(m, seat, left, right, shield) {
  const p = m.players[seat];
  if (!p || !p.alive || m.phase !== 'playing') return;
  p.left = !!left; p.right = !!right;
  if (shield === true) p.shieldRequest = true;
}
function spawn(m) {
  const cfg = MODES[m.mode], r = m.random, id = () => ++m.nextId;
  const level = (m.elapsed / cfg.duration);
  const wallChance = m.elapsed > 9 ? 0.16 + 0.07 * level : 0;
  if (r() < wallChance) {
    m.hazards.push({ id: id(), kind: 'gate', y: -25, gap: 110 + r() * 540, width: Math.max(167, 211 - 44 * level), speed: cfg.speed * (0.95 + level * 0.15) });
  } else {
    const firstX = 38 + r() * (WIDTH - 76);
    m.hazards.push({ id: id(), kind: r() < .32 ? 'comet' : 'orb', x: firstX, y: -30, radius: 20 + r() * 7, speed: cfg.speed * (0.96 + level * 0.20) });
    if (m.elapsed > 6 && r() < .46 + level * .26) {
      const gap = 180 + r() * 160;
      const secondX = firstX < WIDTH / 2 ? clamp(firstX + gap, 40, WIDTH - 40) : clamp(firstX - gap, 40, WIDTH - 40);
      m.hazards.push({ id: id(), kind: 'orb', x: secondX, y: -30, radius: 17 + r() * 7, speed: cfg.speed * (0.92 + level * 0.22) });
    }
  }
}
function score(p) { return Math.floor(p.survived * 100) + p.gems * 450 + (p.alive ? p.hp * 120 : 0); }
function endRound(m) {
  if (m.phase !== 'playing') return;
  const s0 = score(m.players[0]), s1 = score(m.players[1]);
  m.players[0].roundScore = s0; m.players[1].roundScore = s1;
  m.players[0].totalScore += s0; m.players[1].totalScore += s1;
  const winner = s0 > s1 ? 0 : s1 > s0 ? 1 : null;
  if (winner !== null) m.players[winner].wins++;
  m.history.push({ round: m.round, scores: [s0, s1], winner, gems: m.players.map(p => p.gems), survival: m.players.map(p => Number(p.survived.toFixed(1))) });
  m.phase = m.round >= ROUNDS ? 'finished' : 'intermission';
  m.intermission = 7;
  for (const p of m.players) { p.left = false; p.right = false; p.shieldRequest = false; }
}
function tick(m, dt) {
  dt = clamp(Number(dt) || 0, 0, .1);
  if (m.phase === 'countdown' || m.phase === 'resume') {
    const previous = m.phase;
    m.countdown -= dt;
    if (m.countdown <= 0) { m.countdown = 0; m.phase = previous === 'resume' ? (m.resumePhase || 'playing') : 'playing'; m.resumePhase = null; }
    return;
  }
  if (m.phase === 'intermission') {
    m.intermission -= dt;
    if (m.intermission <= 0) beginRound(m);
    return;
  }
  if (m.phase !== 'playing') return;
  const cfg = MODES[m.mode];
  m.elapsed = Math.min(cfg.duration, m.elapsed + dt);
  while (m.elapsed >= m.nextWave) { spawn(m); m.nextWave += cfg.spawnEvery * (1 - (m.elapsed / cfg.duration) * .2); }
  while (m.elapsed >= m.nextGem) {
    m.gems.push({ id: ++m.nextId, x: 43 + m.random() * (WIDTH - 86), y: -25, speed: cfg.speed * .85 });
    m.nextGem += 3.1 + m.random() * 1.1;
  }
  for (const h of m.hazards) h.y += h.speed * dt;
  for (const g of m.gems) g.y += g.speed * dt;
  for (const p of m.players) {
    if (!p.alive) continue;
    p.survived = m.elapsed;
    p.x = clamp(p.x + ((p.right ? 1 : 0) - (p.left ? 1 : 0)) * MOVE_SPEED * dt, RADIUS + 7, WIDTH - RADIUS - 7);
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.shield = Math.max(0, p.shield - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    if (p.shieldRequest && p.cooldown <= 0) { p.shield = .64; p.cooldown = cfg.cooldown; }
    p.shieldRequest = false;
    for (const g of m.gems) {
      if (!p.collected.has(g.id) && Math.hypot(g.x - p.x, g.y - PLAYER_Y) < RADIUS + 16) { p.gems++; p.collected.add(g.id); }
    }
    if (p.shield > 0 || p.invuln > 0) continue;
    for (const h of m.hazards) {
      if (p.hit.has(h.id)) continue;
      const impact = h.kind === 'gate'
        ? Math.abs(h.y - PLAYER_Y) < 19 && (p.x < h.gap - h.width / 2 + RADIUS || p.x > h.gap + h.width / 2 - RADIUS)
        : Math.hypot(h.x - p.x, h.y - PLAYER_Y) < h.radius + RADIUS - 3;
      if (impact) {
        p.hit.add(h.id); p.hp--; p.invuln = 1.12;
        if (p.hp <= 0) { p.hp = 0; p.alive = false; p.survived = m.elapsed; p.left = false; p.right = false; }
        break;
      }
    }
  }
  m.hazards = m.hazards.filter(h => h.y < HEIGHT + 55);
  m.gems = m.gems.filter(g => g.y < HEIGHT + 35);
  if (m.elapsed >= cfg.duration || m.players.every(p => !p.alive)) endRound(m);
}
function publicState(m) {
  return {
    phase: m.phase, round: m.round, rounds: ROUNDS, mode: m.mode, elapsed: +m.elapsed.toFixed(3), duration: MODES[m.mode].duration,
    countdown: Math.max(0, Math.ceil(m.countdown)), intermission: Math.max(0, Math.ceil(m.intermission)),
    players: m.players.map(p => ({ name: p.name, seat: p.seat, x: +p.x.toFixed(1), hp: p.hp, alive: p.alive,
      gems: p.gems, collected: [...p.collected], score: m.phase === 'playing' ? score(p) : p.roundScore,
      totalScore: p.totalScore, wins: p.wins, shield: +p.shield.toFixed(2), cooldown: +p.cooldown.toFixed(2), invuln: +p.invuln.toFixed(2), survived: +p.survived.toFixed(2) })),
    hazards: m.phase === 'playing' ? m.hazards.map(h => ({ ...h, y: +h.y.toFixed(1) })) : [],
    gems: m.phase === 'playing' ? m.gems.map(g => ({ ...g, y: +g.y.toFixed(1) })) : [],
    history: m.history,
    arena: { width: WIDTH, height: HEIGHT, playerY: PLAYER_Y, speed: MOVE_SPEED },
  };
}
module.exports = { WIDTH, HEIGHT, PLAYER_Y, MOVE_SPEED, ROUNDS, MODES, rng, createPlayer, makeMatch, beginRound, input, tick, publicState, score, endRound };
