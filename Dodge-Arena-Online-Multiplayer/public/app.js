(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const intro = $('intro'), roomScreen = $('roomScreen'), gameScreen = $('gameScreen');
  const myCanvas = $('myCanvas'), rivalCanvas = $('rivalCanvas');
  const myCtx = myCanvas.getContext('2d'), rivalCtx = rivalCanvas.getContext('2d');
  const params = new URLSearchParams(location.search);
  const requestedCode = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (requestedCode) $('roomInput').value = requestedCode;
  let ws, mySeat = null, room = null, game = null, snapshotAt = 0, retryDelay = 750, storedToken = '', seenPhase = '', prevHP = null, prevGems = null;
  let soundOn = false, audio, toastTimer, emoteTimer;
  const keys = { left: false, right: false };
  let codeForSession = '';
  try { const lastCode = sessionStorage.getItem('dodge-last-room') || ''; if (!requestedCode || requestedCode === lastCode) { codeForSession = lastCode; storedToken = sessionStorage.getItem('dodge-token-' + codeForSession) || ''; } } catch {}

  function toast(message) { $('toast').textContent = message; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3200); }
  function playTone(freq = 520, seconds = .09, type = 'sine') {
    if (!soundOn) return;
    try {
      audio ||= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      const osc = audio.createOscillator(), volume = audio.createGain();
      osc.type = type; osc.frequency.value = freq;
      volume.gain.setValueAtTime(.055, audio.currentTime);
      volume.gain.exponentialRampToValueAtTime(.001, audio.currentTime + seconds);
      osc.connect(volume); volume.connect(audio.destination);
      osc.start(); osc.stop(audio.currentTime + seconds);
    } catch {}
  }
  $('soundToggle').addEventListener('click', () => { soundOn = !soundOn; $('soundText').textContent = soundOn ? 'ON' : 'OFF'; if (soundOn) playTone(690, .1); });
  function send(data) { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); else toast('Reconnecting to the arena…'); }
  function setNetwork(status) { const e = $('network'); e.className = 'network ' + status; e.innerHTML = '<i></i> ' + (status === 'online' ? 'SERVER ONLINE' : status === 'offline' ? 'RECONNECTING' : 'CONNECTING'); }
  function connect() {
    setNetwork('connecting');
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    ws.addEventListener('open', () => {
      setNetwork('online'); retryDelay = 750;
      if (codeForSession && storedToken) send({ type: 'rejoin', code: codeForSession, token: storedToken });
    });
    ws.addEventListener('message', ev => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'error') { toast(msg.message); if (msg.message.includes('expired')) { codeForSession = ''; storedToken = ''; try { sessionStorage.removeItem('dodge-last-room'); } catch {} } }
      if (msg.type === 'joined') {
        mySeat = msg.seat; codeForSession = msg.code; storedToken = msg.token;
        try { sessionStorage.setItem('dodge-token-' + msg.code, msg.token); sessionStorage.setItem('dodge-last-room', msg.code); } catch {}
        if (params.get('room') !== msg.code) history.replaceState({}, '', '?room=' + msg.code);
        playTone(800, .13);
      }
      if (msg.type === 'state') {
        room = msg.room; game = msg.game; snapshotAt = performance.now();
        renderUI();
      }
      if (msg.type === 'emote') {
        $('emoteBubble').textContent = (msg.seat === mySeat ? 'YOU' : 'RIVAL') + ': ' + msg.emoji;
        $('emoteBubble').hidden = false; clearTimeout(emoteTimer);
        emoteTimer = setTimeout(() => $('emoteBubble').hidden = true, 1900);
        if (msg.seat !== mySeat) playTone(730, .085);
      }
    });
    ws.addEventListener('close', () => {
      setNetwork('offline'); keys.left = keys.right = false;
      if (room) toast('Connection dropped. Your room is saved; reconnecting…');
      setTimeout(connect, retryDelay); retryDelay = Math.min(6500, retryDelay * 1.6);
    });
    ws.addEventListener('error', () => {});
  }
  function getName() { const name = $('playerName').value.trim(); if (!name) { $('playerName').focus(); toast('Choose a callsign first!'); return ''; } return name; }
  $('createBtn').addEventListener('click', () => { const name = getName(); if (name) send({ type: 'create', name }); });
  $('joinBtn').addEventListener('click', () => { const name = getName(); if (!name) return; const code = $('roomInput').value.trim().toUpperCase(); if (!/^[A-Z0-9]{6}$/.test(code)) return toast('Enter your six-character room code.'); send({ type: 'join', name, code }); });
  $('playerName').addEventListener('keydown', e => { if (e.key === 'Enter') $('createBtn').click(); });
  $('roomInput').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
  $('roomInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinBtn').click(); });
  function shareLink() { if (!room) return; const url = `${location.origin}/?room=${room.code}`; copy(url, 'Invite link copied!'); }
  function copy(text, message) {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => toast(message), () => fallbackCopy(text, message));
    else fallbackCopy(text, message);
  }
  function fallbackCopy(text, message) {
    const i = document.createElement('textarea'); i.value = text; i.style.position = 'fixed'; i.style.opacity = '0'; document.body.appendChild(i); i.select();
    try { if (document.execCommand('copy')) toast(message); else toast('Copy this: ' + text); } catch { toast('Copy this: ' + text); }
    i.remove();
  }
  $('copyCode').onclick = () => room && copy(room.code, 'Room code copied!');
  $('copyInvite').onclick = shareLink; $('shareMid').onclick = shareLink; $('copyEnd').onclick = shareLink;
  $('readyBtn').addEventListener('click', () => { const ready = room?.players[mySeat]?.ready; send({ type: 'ready', value: !ready }); });
  $('startBtn').addEventListener('click', () => send({ type: 'start' }));
  $('rematchBtn').addEventListener('click', () => { send({ type: 'rematch' }); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  document.querySelectorAll('.mode-option').forEach(el => el.addEventListener('click', () => { if (mySeat === 0 && room?.phase === 'lobby') send({ type: 'mode', mode: el.dataset.mode }); }));
  document.querySelectorAll('[data-emote]').forEach(el => el.addEventListener('click', () => send({ type: 'emote', emoji: el.dataset.emote })));

  function renderUI() {
    if (!room || mySeat === null) return;
    const phase = room.phase;
    intro.hidden = true; roomScreen.hidden = phase !== 'lobby'; gameScreen.hidden = phase === 'lobby';
    if (phase === 'lobby') {
      $('roomCode').textContent = room.code;
      room.players.forEach((p, i) => {
        $(i === 0 ? 'p1Name' : 'p2Name').textContent = p?.name || 'Waiting for player…';
        const tag = $(i === 0 ? 'p1Status' : 'p2Status');
        tag.textContent = !p ? 'EMPTY SLOT' : !p.connected ? 'DISCONNECTED' : p.ready ? '✓ READY' : 'NOT READY';
        tag.className = 'pill' + (p && !p.connected ? ' disconnected' : p?.ready ? ' ready' : '');
      });
      document.querySelectorAll('.mode-option').forEach(el => { el.classList.toggle('selected', el.dataset.mode === room.mode); el.disabled = mySeat !== 0; });
      const mine = room.players[mySeat]; $('readyBtn').textContent = mine?.ready ? '✓ READY — CANCEL' : "I'M READY ✓";
      const both = room.players.every(p => p?.connected && p.ready);
      $('startBtn').hidden = mySeat !== 0;
      $('startBtn').disabled = !both;
      $('lobbyHint').textContent = !room.players[1] ? 'Invite your partner with the room code or link.' : !both ? 'Both players must press READY. The host then starts the match.' : mySeat === 0 ? 'Both ready! Start your first round.' : 'Both ready! Waiting for the host to start.';
      seenPhase = 'lobby'; prevHP = prevGems = null;
      return;
    }
    if (!game) return;
    const p1 = game.players[0], p2 = game.players[1];
    $('smallCode').textContent = room.code;
    $('roundBadge').textContent = `ROUND ${game.round} / ${game.rounds}`;
    $('clock').textContent = `00:${String(Math.max(0, Math.ceil(game.duration - game.elapsed))).padStart(2,'0')}`;
    $('clock').parentElement.classList.toggle('danger', game.duration - game.elapsed <= 10);
    for (const [i,p] of [[0,p1],[1,p2]]) {
      $(`gameP${i + 1}Name`).textContent = p.name + (i === mySeat ? ' (YOU)' : '');
      $(`gameP${i + 1}Tag`).textContent = p.wins + (p.wins === 1 ? ' WIN' : ' WINS');
      $(`gameP${i + 1}Score`).textContent = String(p.score).padStart(4,'0');
      $(`gameP${i + 1}Hearts`).textContent = p.hp > 0 ? '♥ '.repeat(p.hp).trim() : '✕ OUT';
    }
    const mine = game.players[mySeat];
    const overlay = $('arenaOverlay'), title = $('overlayText'), sub = $('overlaySmall');
    let showOverlay = true;
    if (phase === 'countdown' || phase === 'resume') { title.textContent = String(game.countdown); sub.textContent = phase === 'resume' ? 'BOTH PLAYERS BACK — RESUMING' : 'GET READY TO DODGE'; }
    else if (phase === 'paused') { title.textContent = 'PAUSED'; sub.textContent = 'WAITING FOR PLAYER TO RECONNECT'; }
    else if (phase === 'intermission') { const last = game.history.at(-1); title.textContent = last?.winner === null ? 'ROUND TIED' : (last?.winner === mySeat ? 'YOU WIN THIS ROUND!' : 'RIVAL WINS THIS ROUND'); sub.textContent = `NEXT ROUND IN ${game.intermission}…`; }
    else if (phase === 'finished') { title.textContent = 'GAME OVER'; sub.textContent = 'CHECK THE FINAL RESULTS BELOW'; }
    else if (!mine.alive) { title.textContent = 'KNOCKED OUT'; sub.textContent = 'WATCH YOUR OPPONENT FINISH'; }
    else showOverlay = false;
    overlay.hidden = !showOverlay;
    const rivalSeat = 1 - mySeat;
    $('rivalOverlay').hidden = !!room.players[rivalSeat]?.connected;
    $('rivalStatus').textContent = room.players[rivalSeat]?.connected ? '● LIVE FEED' : '● OFFLINE';
    $('results').hidden = phase !== 'finished';
    if (phase === 'finished') renderResults();
    $('shieldCooldown').textContent = mine.cooldown <= .05 ? 'READY' : mine.cooldown.toFixed(1) + 's';
    $('shieldButton').disabled = phase !== 'playing' || !mine.alive || mine.cooldown > .05;
    if (phase !== seenPhase) {
      if (phase === 'playing') playTone(850, .15);
      if (phase === 'finished') { playTone(1100, .3); setTimeout(() => $('results').scrollIntoView({ behavior: 'smooth', block: 'center' }), 1000); }
      if (phase === 'intermission') playTone(420, .2, 'triangle');
      seenPhase = phase;
    }
    if (phase === 'playing' && prevHP !== null && mine.hp < prevHP) playTone(165, .18, 'sawtooth');
    if (phase === 'playing' && prevGems !== null && mine.gems > prevGems) playTone(1100, .11);
    prevHP = mine.hp; prevGems = mine.gems;
  }
  function renderResults() {
    const a = game.players[0], b = game.players[1];
    let winner = a.wins > b.wins ? 0 : b.wins > a.wins ? 1 : a.totalScore > b.totalScore ? 0 : b.totalScore > a.totalScore ? 1 : null;
    $('resultHeadline').textContent = winner === null ? 'A PERFECT DRAW!' : winner === mySeat ? 'YOU ARE THE CHAMPION!' : 'YOUR RIVAL TAKES THE CROWN!';
    $('resultSubtitle').textContent = `${a.wins} – ${b.wins} round wins · ${a.totalScore.toLocaleString()} – ${b.totalScore.toLocaleString()} total points`;
    $('resultRows').replaceChildren(...game.history.map(h => {
      const d = document.createElement('div'); d.className = 'result-row';
      const r = document.createElement('span'); r.textContent = `ROUND ${h.round}`;
      const s1 = document.createElement('strong'); s1.textContent = String(h.scores[0]);
      const mid = document.createElement('span'); mid.textContent = '—';
      const s2 = document.createElement('strong'); s2.textContent = String(h.scores[1]);
      d.append(r,s1,mid,s2); return d;
    }));
    $('resultWinner').textContent = winner === null ? '⚖️ EQUAL SKILL. RUN IT BACK?' : (winner === mySeat ? '🏆 YOU DID IT. GG!' : '🏆 GG! NEXT MATCH IS YOURS.');
    $('rematchBtn').hidden = mySeat !== 0;
  }
  function sendInput(shield = false) { send({ type: 'input', left: keys.left, right: keys.right, shield }); }
  const leftKeys = ['ArrowLeft','a','A'], rightKeys = ['ArrowRight','d','D'];
  document.addEventListener('keydown', e => {
    if (['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (leftKeys.includes(e.key)) { e.preventDefault(); if (!keys.left) { keys.left = true; sendInput(); } }
    if (rightKeys.includes(e.key)) { e.preventDefault(); if (!keys.right) { keys.right = true; sendInput(); } }
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) { sendInput(true); playTone(570, .075); } }
  });
  document.addEventListener('keyup', e => {
    if (leftKeys.includes(e.key)) { e.preventDefault(); if (keys.left) { keys.left = false; sendInput(); } }
    if (rightKeys.includes(e.key)) { e.preventDefault(); if (keys.right) { keys.right = false; sendInput(); } }
  });
  window.addEventListener('blur', () => { if (keys.left || keys.right) { keys.left = keys.right = false; sendInput(); } });
  $('shieldButton').addEventListener('click', () => sendInput(true));
  for (const [id, direction] of [['leftButton','left'],['rightButton','right']]) {
    const button = $(id);
    button.addEventListener('pointerdown', e => { e.preventDefault(); button.setPointerCapture(e.pointerId); button.classList.add('pressed'); keys[direction] = true; sendInput(); });
    const release = e => { e.preventDefault(); button.classList.remove('pressed'); keys[direction] = false; sendInput(); };
    button.addEventListener('pointerup', release); button.addEventListener('pointercancel', release); button.addEventListener('lostpointercapture', () => { if (keys[direction]) { keys[direction] = false; sendInput(); } });
  }

  const stars = Array.from({ length: 48 }, (_, i) => ({ x: (i * 173 + 37) % 760, y: (i * 239 + 42) % 500, r: (i % 4 === 0 ? 1.7 : .8), phase: i * .87 }));
  function roundedRect(ctx,x,y,w,h,r) { ctx.beginPath(); ctx.roundRect(x,y,Math.max(0,w),h,r); }
  function drawArena(ctx, seat, now) {
    const W = 760, H = 500, own = seat === mySeat, color = seat === 0 ? '#5deae1' : '#fc77b3';
    ctx.clearRect(0,0,W,H);
    const bg = ctx.createLinearGradient(0,0,0,H); bg.addColorStop(0,'#101f39'); bg.addColorStop(1,'#08152b'); ctx.fillStyle = bg; ctx.fillRect(0,0,W,H);
    ctx.strokeStyle = '#31466533'; ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 40) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }
    for (const s of stars) { ctx.fillStyle = `rgba(130,201,241,${(.15 + Math.sin(now * .001 + s.phase)*.09).toFixed(2)})`; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2);ctx.fill(); }
    const floor = ctx.createLinearGradient(0,395,0,500); floor.addColorStop(0,'#18385500'); floor.addColorStop(1,seat === 0 ? '#114c5760' : '#55304c65'); ctx.fillStyle = floor; ctx.fillRect(0,395,W,105);
    ctx.strokeStyle = color+'66';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,479);ctx.lineTo(W,479);ctx.stroke();
    if (!game || game.round === 0) {
      ctx.textAlign='center';ctx.fillStyle='#8099b3';ctx.font='bold 19px ui-sans-serif,system-ui';ctx.fillText('AWAITING MATCH', W/2,H/2);return;
    }
    const p = game.players[seat];
    const visualDt = game.phase === 'playing' ? Math.min(.09, Math.max(0,(now - snapshotAt) / 1000)) : 0;
    for (const h of game.hazards) {
      const y = h.y + visualDt * h.speed;
      if (h.kind === 'gate') {
        const a = Math.max(0,h.gap - h.width/2), b = Math.min(W,h.gap + h.width/2);
        ctx.save();ctx.shadowColor='#ff668a';ctx.shadowBlur=18;ctx.fillStyle='#d85577';
        roundedRect(ctx,0,y-10,a,20,3);ctx.fill();roundedRect(ctx,b,y-10,W-b,20,3);ctx.fill();ctx.restore();
        ctx.strokeStyle='#ffbfd077';ctx.lineWidth=3;ctx.strokeRect(0,y-10,a,20);ctx.strokeRect(b,y-10,W-b,20);
        ctx.textAlign='center';ctx.font='900 13px system-ui';ctx.fillStyle='#ffb4ca';ctx.fillText('▼ SAFE GAP ▼',h.gap,y-17);
      } else {
        const r=h.radius;ctx.save();ctx.shadowColor=h.kind==='comet'?'#ffb778':'#ff527b';ctx.shadowBlur=22;
        const g=ctx.createRadialGradient(h.x-r*.3,y-r*.3,1,h.x,y,r);g.addColorStop(0,'#ffefbd');g.addColorStop(.42,h.kind==='comet'?'#ff9a58':'#fe6385');g.addColorStop(1,'#a53765');ctx.fillStyle=g;ctx.beginPath();ctx.arc(h.x,y,r,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ffd7b3';ctx.lineWidth=2;ctx.stroke();ctx.restore();
        if(h.kind==='comet'){ctx.strokeStyle='#ff986545';ctx.lineWidth=12;ctx.beginPath();ctx.moveTo(h.x,y-r);ctx.lineTo(h.x,y-r-32);ctx.stroke();}
      }
    }
    for (const g of game.gems) {
      if (p.collected?.includes(g.id)) continue;
      const y=g.y+g.speed*visualDt;
      ctx.save();ctx.translate(g.x,y);ctx.rotate(Math.PI/4);ctx.shadowColor='#5be8ee';ctx.shadowBlur=18;ctx.fillStyle='#8efaf2';ctx.fillRect(-11,-11,22,22);ctx.fillStyle='#e0ffff';ctx.fillRect(-5,-5,10,10);ctx.restore();
    }
    if (p.alive) {
      let px = p.x;
      if (own && game.phase === 'playing') px = Math.min(W-23, Math.max(23,px + (Number(keys.right)-Number(keys.left)) * game.arena.speed * visualDt));
      const py=game.arena.playerY;
      ctx.save();ctx.translate(px,py);
      if (p.invuln>0 && Math.floor(now/120)%2) ctx.globalAlpha=.43;
      ctx.shadowBlur=23;ctx.shadowColor=color;
      ctx.fillStyle=color;ctx.strokeStyle='#e3ffff';ctx.lineWidth=2;
      ctx.beginPath();ctx.moveTo(0,-25);ctx.lineTo(21,18);ctx.lineTo(7,12);ctx.lineTo(0,19);ctx.lineTo(-7,12);ctx.lineTo(-21,18);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.fillStyle='#153347';ctx.beginPath();ctx.arc(0,1,7,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#ffb17c';ctx.beginPath();ctx.moveTo(-7,18);ctx.lineTo(0,32+Math.sin(now*.025)*4);ctx.lineTo(7,18);ctx.closePath();ctx.fill();
      if (p.shield > 0) { ctx.shadowColor='#a4faff';ctx.shadowBlur=23;ctx.strokeStyle='#9efff4';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,34+Math.sin(now*.015)*2,0,Math.PI*2);ctx.stroke(); }
      ctx.restore();
    } else {
      ctx.fillStyle='#ff9baa';ctx.font='900 25px system-ui';ctx.textAlign='center';ctx.fillText('✕',p.x,game.arena.playerY+9);
      ctx.font='900 14px system-ui';ctx.fillText('OUT',p.x,game.arena.playerY+35);
    }
    ctx.fillStyle='#9bb3ce';ctx.font='900 13px ui-sans-serif,system-ui';ctx.textAlign='left';ctx.fillText(`GEMS ◆ ${p.gems}`,18,29);
    ctx.textAlign='right';ctx.fillStyle=color;ctx.fillText(`${p.hp} HP`,W-18,29);
  }
  function animate(now) {
    if (!gameScreen.hidden && game && mySeat !== null) { drawArena(myCtx,mySeat,now);drawArena(rivalCtx,1-mySeat,now); }
    requestAnimationFrame(animate);
  }
  connect();requestAnimationFrame(animate);
})();
