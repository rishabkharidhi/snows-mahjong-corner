/* =====================================================================
   storage.js — persistence layer + the room data model.
   Personal data -> localStorage (or window.storage if running as a
   Claude artifact). Shared room state -> Cloudflare Worker / KV.
   ===================================================================== */
const POLL_MS = 1800;
const CLAIM_WINDOW_MS = 9000;
const SMALL_CHIP = 0.5; // 50c — kongs, secret/concealed kongs, sagasa, 13 flowers
const BIG_CHIP = 1.0;   // $1 — winning a hand

/* Personal data -> localStorage. Shared room data -> Cloudflare Worker.
   Set WORKER_URL to your deployed Worker's URL (see DEPLOY.md / worker.js). */
const WORKER_URL = "https://snows-mahjong-api.rishab-kharidhi.workers.dev";

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
    await new Promise(r=>setTimeout(r, 70 + Math.random()*60));
    const check = await getRoom(code);
    if(check && check._tok === tok) return check;
  }
  return await getRoom(code);
}

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
function freshRoom(code, hostId){
  return {
    code, version:0, createdAt:Date.now(), updatedAt:Date.now(),
    hostId,
    phase:'lobby', // lobby | play | handEnd | matchEnd
    seats:[null,null,null,null],
    dealerSeat:0, handNumber:0,
    chips:[0,0,0,0],
    chipEvents:[],
    jokerTile:null,
    deck:[], deckPos:0, backPos:0,
    hands:[[],[],[],[]],
    melds:[[],[],[],[]],
    flowers:[[],[],[],[]],
    discardPile:[],
    turnSeat:0, turnPhase:'draw',
    pendingDiscard:null,
    lastHandResult:null,
    log:[]
  };
}
function pushLog(room, msg){
  room.log.push(msg);
  if(room.log.length>40) room.log.splice(0, room.log.length-40);
}
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
function seatName(room, seat){ return room.seats[seat] ? room.seats[seat].name : '???'; }
function mySeatIndex(room){
  if(!room) return -1;
  return room.seats.findIndex(s=>s && s.id===PROFILE.id);
}
