/* =====================================================================
   storage.js — persistence layer + the room data model.
   Personal data -> localStorage. Shared room state -> Cloudflare Worker.
   NOTE: anyone who knows a room code can read that room's full state
   (including hands) via the Worker — this trusts whoever you share the
   code with, the same way a real card table trusts whoever sits at it.
   ===================================================================== */
/* ---------------- constants ---------------- */
const POLL_MS = 1800;
const CLAIM_WINDOW_MS = 9000;
const DEAD_WALL_SIZE = 14; // tiles held back at the back of the wall; when the draw pointer
                           // reaches them the hand ends in a draw (no winner)

/* ---------------- storage helpers ---------------- */
/* ---------------- storage helpers (standalone backend) ----------------
   Personal data (your name, your last room) lives in this browser's
   localStorage. Shared room state goes through a tiny Cloudflare Worker +
   KV backend (see worker.js + DEPLOY.md) so everyone hitting this page,
   from anywhere, shares one source of truth. Set WORKER_URL below to the
   URL you get after deploying the Worker. */
const WORKER_URL = "https://snows-mahjong-corner.rishab-kharidhi.workers.dev";

async function storageGet(key, shared){
  if(!shared){
    try{ const v = localStorage.getItem('mjc_'+key); return v===null ? null : v; }
    catch(e){ return null; }
  }
  try{
    const res = await fetch(`${WORKER_URL}/get?key=${encodeURIComponent(key)}`);
    if(!res.ok) return null;
    const data = await res.json();
    return (data && data.value!==undefined) ? data.value : null;
  }catch(e){ console.error('storage get failed', e); return null; }
}
async function storageSet(key, value, shared){
  if(!shared){
    try{ localStorage.setItem('mjc_'+key, value); return true; }
    catch(e){ return null; }
  }
  try{
    const res = await fetch(`${WORKER_URL}/set`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ key, value })
    });
    return res.ok ? true : null;
  }catch(e){ console.error('storage set failed', e); return null; }
}

function roomKey(code){ return 'room:'+code; }

async function getRoom(code){
  const raw = await storageGet(roomKey(code), true);
  if(!raw) return null;
  try{ return JSON.parse(raw); }catch(e){ return null; }
}
async function putRoom(room){
  return await storageSet(roomKey(room.code), JSON.stringify(room), true);
}

// Read-modify-write with a small optimistic-concurrency retry loop.
// updateFn(draft) mutates draft in place and returns true to write it, or false to abort.
async function updateRoom(code, updateFn){
  for(let attempt=0; attempt<8; attempt++){
    const room = await getRoom(code);
    if(!room) return null;
    const proceed = updateFn(room);
    if(!proceed) return room;
    room.version = (room.version||0) + 1;
    room.updatedAt = Date.now();
    const tok = Math.random().toString(36).slice(2) + '_' + Date.now();
    room._tok = tok;
    await putRoom(room);
    // brief re-read to confirm OUR write is still the latest value — a concurrent writer
    // could have raced us and overwritten it (even with the same version number), so we
    // check our unique write token rather than the version number alone.
    await new Promise(r=>setTimeout(r, 70 + Math.random()*60));
    const check = await getRoom(code);
    if(check && check._tok === tok) return check;
    // someone else won the race — loop and retry the whole read-modify-write against fresh state
  }
  return await getRoom(code);
}

/* ---------------- personal profile (per browser/account, not shared) ---------------- */
let PROFILE = null;
async function loadProfile(){
  const raw = await storageGet('profile', false);
  if(raw){ try{ PROFILE = JSON.parse(raw); }catch(e){ PROFILE=null; } }
  if(!PROFILE){
    PROFILE = { id: 'p_'+Math.random().toString(36).slice(2,10)+Date.now().toString(36), name:'' };
    await storageSet('profile', JSON.stringify(PROFILE), false);
  }
  return PROFILE;
}
async function saveProfile(){ await storageSet('profile', JSON.stringify(PROFILE), false); }

function randomRoomCode(){
  const letters='ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s=''; for(let i=0;i<4;i++) s+=letters[Math.floor(Math.random()*letters.length)];
  return s;
}

/* ---------------- room model ---------------- */
const SMALL_CHIP = 0.5; // 50c — kongs, secret/concealed kongs, sagasa upgrades
const BIG_CHIP = 1.0;   // $1 — winning a hand

function freshRoom(code, hostId){
  return {
    code, version:0, createdAt:Date.now(), updatedAt:Date.now(),
    hostId,
    phase:'lobby', // lobby | pass | play | handEnd | matchEnd
    seats:[null,null,null,null], // {id,name,isBot,connected}
    dealerSeat:0, handNumber:0,
    chips:[0,0,0,0], // running net balance in dollars, zero-sum across all 4 seats
    chipEvents:[], // recent transfers, for the on-screen "chips flying" notifications
    deck:[], deckPos:0, deadWallPos:0,
    hands:[[],[],[],[]],
    melds:[[],[],[],[]],
    discardPile:[],
    turnSeat:0, turnPhase:'draw',
    pendingDiscard:null,
    passPhase:null,
    lastHandResult:null,
    log:[]
  };
}
function pushLog(room, msg){
  room.log.push(msg);
  if(room.log.length>40) room.log.splice(0, room.log.length-40);
}
// Records a chip transfer from one or more seats to one seat, applies the balance
// change, and queues a short-lived event so connected clients can animate it.
function transferChips(room, fromSeats, toSeat, chipType, countEach, reason){
  const unit = chipType==='big' ? BIG_CHIP : SMALL_CHIP;
  for(const f of fromSeats){
    if(f===toSeat) continue;
    const amount = unit * countEach;
    room.chips[f] = +(room.chips[f] - amount).toFixed(2);
    room.chips[toSeat] = +(room.chips[toSeat] + amount).toFixed(2);
  }
  room.chipEvents.push({
    id: Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7), ts: Date.now(),
    type: chipType, countEach, fromSeats: fromSeats.filter(f=>f!==toSeat), toSeat, reason
  });
  if(room.chipEvents.length>12) room.chipEvents.splice(0, room.chipEvents.length-12);
}
function mySeatIndex(room){
  if(!room) return -1;
  return room.seats.findIndex(s=>s && s.id===PROFILE.id);
}
