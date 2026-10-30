'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MODES, makeMatch, beginRound, tick, input, score, endRound, publicState } = require('../server/engine');
const { createGameServer } = require('../server/index');
function step(m, seconds) { while (seconds > 0) { const dt = Math.min(.04, seconds); tick(m, dt); seconds -= dt; } }
function create(mode='classic') { const m=makeMatch(['Alex','Sam'],123456,mode);beginRound(m);step(m,3.2);return m; }
test('all three difficulties are configured with increasing challenge', () => {
  assert.ok(MODES.chill.hearts > MODES.classic.hearts);assert.ok(MODES.classic.hearts > MODES.chaos.hearts);
  assert.ok(MODES.chill.spawnEvery > MODES.classic.spawnEvery);
  assert.ok(MODES.classic.spawnEvery > MODES.chaos.spawnEvery);
});
test('same hazards and gem positions for every player', () => {
  const m = create();step(m,12);
  assert.equal(m.players.length,2);assert.ok(m.nextId > 8);
  assert.ok(m.hazards.length > 0);
  const state = publicState(m);
  assert.ok(state.hazards.every(h => Number.isFinite(h.y)));
  assert.equal(state.players[0].hp, state.players[1].hp);
});
test('moving left and right has equal movement speed and is bounded', () => {
  const m = create('chill');
  m.hazards=[];m.nextWave=9000;m.nextGem=9000;
  input(m,0,true,false,false);input(m,1,false,true,false);step(m,.5);
  assert.ok(Math.abs((380-m.players[0].x) - (m.players[1].x-380)) < .001);
  step(m,3);assert.ok(m.players[0].x>=23);assert.ok(m.players[1].x<=737);
});
test('server alone determines damage; shield prevents collisions', () => {
  const m = create('classic');m.nextWave=9000;m.nextGem=9000;
  m.hazards=[{id:999,kind:'orb',x:380,y:428,radius:25,speed:0}];
  input(m,0,false,false,true);tick(m,.04);
  assert.equal(m.players[0].hp,3);
  step(m,.4); assert.equal(m.players[0].hp,3,'shield should protect initially');
  step(m,.4);assert.equal(m.players[0].hp,2,'eventually collides after shield ends');
  assert.ok(m.players[0].cooldown>0);
});
test('gems and survival contribute to round score per player', () => {
  const m = create('classic');m.nextWave=9000;m.nextGem=9000;m.gems=[{id:55,x:380,y:428,speed:0}];
  tick(m,.04);
  assert.equal(m.players[0].gems,1);assert.equal(m.players[1].gems,1);
  assert.ok(score(m.players[0])>=450);
  tick(m,.04);assert.equal(m.players[0].gems,1,'same gem cannot be collected twice');
});
test('three rounds produce a winner or a fair draw, without extra rounds', () => {
  const m=create('chill');m.players[0].gems=4;m.players[1].gems=1;endRound(m);
  assert.equal(m.history[0].winner,0);assert.equal(m.players[0].wins,1);
  assert.equal(m.phase,'intermission');step(m,7.1);assert.equal(m.round,2);
  step(m,3.2);endRound(m);step(m,7.1);step(m,3.2);endRound(m);
  assert.equal(m.history.length,3);assert.equal(m.phase,'finished');assert.equal(beginRound(m),false);
});
test('pause freezes timer; resume counts down before resuming', () => {
  const m=create();m.phase='paused';const t=m.elapsed;step(m,5);assert.equal(m.elapsed,t);
  m.resumePhase='playing';m.phase='resume';m.countdown=3;step(m,2);
  assert.equal(m.phase,'resume');assert.equal(m.elapsed,t);
  step(m,1.2);assert.equal(m.phase,'playing');
});

function client(url) {
  return new Promise((resolve,reject)=>{
    const ws = new WebSocket(url); const received=[];const waits=[];
    ws.addEventListener('open',()=>resolve({
      ws,send:o=>ws.send(JSON.stringify(o)),
      next:(pred,limit=3500)=>new Promise((res,rej)=>{
        const i=received.findIndex(pred);if(i!==-1)return res(received.splice(i,1)[0]);
        const wait={pred,res,rej};waits.push(wait);
        wait.timer=setTimeout(()=>{const x=waits.indexOf(wait);if(x>=0)waits.splice(x,1);rej(Error('Timed out waiting for WS response'));},limit);
      }),close:()=>ws.close(),
    }));
    ws.addEventListener('message',e=>{
      const d=JSON.parse(e.data);
      const i=waits.findIndex(w=>w.pred(d));
      if(i!==-1){const w=waits.splice(i,1)[0];clearTimeout(w.timer);w.res(d);}else received.push(d);
      if(received.length>120)received.splice(0,received.length-120);
    });ws.addEventListener('error',reject);
  });
}
test('two real websocket clients create room, ready, start, keep other players out, and reconnect',async()=>{
  const app=createGameServer();const addr=await app.listen(0,'127.0.0.1');const url=`ws://127.0.0.1:${addr.port}/ws`;
  const cs=[];
  try {
    const a=await client(url);cs.push(a);a.send({type:'create',name:'Blue Knight'});
    const joinedA=await a.next(m=>m.type==='joined');assert.match(joinedA.code,/^[A-Z2-9]{6}$/);assert.equal(joinedA.seat,0);
    const b=await client(url);cs.push(b);b.send({type:'join',code:joinedA.code,name:'Pink Comet'});
    const joinedB=await b.next(m=>m.type==='joined');assert.equal(joinedB.seat,1);
    const c=await client(url);cs.push(c);c.send({type:'join',code:joinedA.code,name:'Eve'});
    assert.match((await c.next(m=>m.type==='error')).message,/two players/);
    a.send({type:'mode',mode:'chaos'});
    assert.equal((await a.next(m=>m.type==='state' && m.room.mode==='chaos')).room.mode,'chaos');
    a.send({type:'ready',value:true});b.send({type:'ready',value:true});
    await a.next(m=>m.type==='state' && m.room.players.every(p=>p?.ready));
    a.send({type:'start'});
    const state=await a.next(m=>m.type==='state' && m.game?.phase==='countdown');
    assert.equal(state.game.duration,62);assert.equal(state.game.players.length,2);
    b.close();
    const paused=await a.next(m=>m.type==='state' && m.room.phase==='paused');assert.equal(paused.game.phase,'paused');
    const re=await client(url);cs.push(re);
    re.send({type:'rejoin',code:joinedA.code,token:joinedB.token});
    const joinedRe=await re.next(m=>m.type==='joined');assert.equal(joinedRe.seat,1);
    assert.ok([3,4].includes((await a.next(m=>m.type==='state' && m.room.phase==='resume')).game.countdown));
    const health=await fetch(`http://127.0.0.1:${addr.port}/health`);assert.equal((await health.json()).ok,true);
    const page=await fetch(`http://127.0.0.1:${addr.port}/`);assert.equal(page.status,200);assert.match(await page.text(),/DODGE<span class="brand-light">ARENA/);
  } finally {for(const c of cs)try{c.close();}catch{}await app.close();}
});
test('obstacle schedule is deterministic even with different player decisions', () => {
  const a=create('chaos'), b=create('chaos');
  input(a,0,true,false,false);input(a,1,false,true,false);
  step(a,9);step(b,9);
  const fields=m=>({hazards:m.hazards,gems:m.gems,nextId:m.nextId});
  assert.deepEqual(fields(a),fields(b));
});
test('shields have cooldown and cannot be spammed by holding space', () => {
  const m=create('chill');m.nextWave=999;m.nextGem=999;
  input(m,0,false,false,true);tick(m,.04);
  assert.ok(m.players[0].shield>.5);
  const cooldown=m.players[0].cooldown;
  step(m,.8);input(m,0,false,false,true);tick(m,.04);
  assert.equal(m.players[0].shield,0);
  assert.ok(m.players[0].cooldown<cooldown);
});
test('all players have the same initial hearts, shield and move capacity', () => {
  for (const mode of Object.keys(MODES)) {
    const m=create(mode), [a,b]=m.players;
    assert.equal(a.hp,b.hp);assert.equal(a.cooldown,b.cooldown);
    assert.equal(a.shield,b.shield);assert.equal(a.x,b.x);
  }
});
test('invalid difficulty is not silently accepted', () => {
  assert.throws(()=>makeMatch(['a','b'],22,'impossible'),/Invalid mode/);
});
