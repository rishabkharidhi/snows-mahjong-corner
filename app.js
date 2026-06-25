/* ================= ACTIONS / EVENT HANDLING ================= */

function showToast(msg){
  const old = document.getElementById('toast');
  if(old) old.remove();
  const div = document.createElement('div');
  div.id = 'toast'; div.className = 'toast'; div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(()=>{ const el=document.getElementById('toast'); if(el) el.remove(); }, 2600);
}
function showHomeError(msg){
  const el = document.getElementById('homeError');
  if(el) el.textContent = msg;
}

async function doAction(updateFn){
  if(!STATE.roomCode) return null;
  const r = await updateRoom(STATE.roomCode, updateFn);
  if(r) STATE.room = r;
  renderApp();
  return r;
}

async function handleCreateRoom(){
  const nameEl = document.getElementById('nameInput');
  const name = (nameEl && nameEl.value.trim()) || 'Player';
  PROFILE.name = name;
  const code = randomRoomCode();
  const room = freshRoom(code, PROFILE.id);
  await putRoom(room);
  PROFILE.lastRoomCode = code;
  await saveProfile();
  STATE.roomCode = code; STATE.screen = 'room'; STATE.room = room;
  renderApp();
  startPolling();
}
async function handleJoinRoom(){
  const nameEl = document.getElementById('nameInput');
  const codeEl = document.getElementById('joinCodeInput');
  const name = (nameEl && nameEl.value.trim()) || 'Player';
  const code = (codeEl && codeEl.value.trim().toUpperCase()) || '';
  if(code.length!==4){ showHomeError('Enter the 4-letter room code your friend shared.'); return; }
  const room = await getRoom(code);
  if(!room){ showHomeError('No table found with that code — double check it with your friend.'); return; }
  PROFILE.name = name;
  PROFILE.lastRoomCode = code;
  await saveProfile();
  STATE.roomCode = code; STATE.screen = 'room'; STATE.room = room;
  renderApp();
  startPolling();
}
async function handleLeaveRoom(){
  stopPolling();
  STATE.roomCode = null; STATE.room = null; STATE.screen = 'home';
  STATE.selectedDiscardIdx = null;
  STATE.handOrder = [];
  STATE.latestDraw = null;
  PROFILE.lastRoomCode = null;
  await saveProfile();
  renderApp();
}

function updateTileInfoBar(tileId){
  const bar = document.getElementById('tile-info-bar');
  if(!bar || !tileId) return;
  bar.innerHTML = `<span class="ti-name">${tileLabel(tileId)}</span><span class="ti-blurb">${tileBlurb(tileId)}</span>`;
}

async function handleAppClick(e){
  if(Date.now() - STATE.dragEndedAt < 300) return;
  const tileEl = e.target.closest('.tile[data-tile]');
  if(tileEl) updateTileInfoBar(tileEl.getAttribute('data-tile'));

  const el = e.target.closest('[data-action]');
  if(el) e.preventDefault();
  if(!el) return;
  const action = el.getAttribute('data-action');
  const seat = el.getAttribute('data-seat')!=null ? Number(el.getAttribute('data-seat')) : null;
  const idx = el.getAttribute('data-idx')!=null ? Number(el.getAttribute('data-idx')) : null;
  const tile = el.getAttribute('data-tile');
  const type = el.getAttribute('data-type');

  switch(action){
    case 'createRoom': await handleCreateRoom(); break;
    case 'joinRoom': await handleJoinRoom(); break;
    case 'toggleHowTo': STATE.showHowTo = !STATE.showHowTo; renderApp(); break;
    case 'toggleLog': STATE.showLog = !STATE.showLog; renderApp(); break;

    case 'joinSeat': await doAction(d=>actionJoinSeat(d, seat, PROFILE)); break;
    case 'addBot': await doAction(d=>actionAddBot(d, seat, PROFILE.id)); break;
    case 'removeBot': await doAction(d=>actionRemoveBot(d, seat, PROFILE.id)); break;
    case 'kickSeat': await doAction(d=>actionKickSeat(d, seat, PROFILE.id)); break;
    case 'leaveSeat': await doAction(d=>actionLeaveSeat(d, PROFILE.id)); break;
    case 'startMatch': await doAction(d=>actionStartMatch(d, PROFILE.id)); break;
    case 'copyCode': {
      const code = STATE.roomCode || '';
      try{ await navigator.clipboard.writeText(code); showToast('Room code copied: '+code); }
      catch(e2){ showToast('Room code: '+code); }
      break;
    }
    case 'leaveRoom': await handleLeaveRoom(); break;

    case 'sortHand': STATE.handOrder = []; renderApp(); break;
    case 'selectDiscard': STATE.selectedDiscardIdx = (STATE.selectedDiscardIdx===idx ? null : idx); renderApp(); break;
    case 'drawTile': {
      const mySeat=mySeatIndex(STATE.room);
      const r = await doAction(d=>actionDraw(d, mySeat));
      if(r){
        const display = STATE.handOrder;
        STATE.latestDraw = display.length ? { tile: display[display.length-1], idx: display.length-1 } : null;
        renderApp();
      }
      break;
    }
    case 'confirmDiscard': {
      const mySeat = mySeatIndex(STATE.room);
      const hand = STATE.handOrder;
      const t = hand[STATE.selectedDiscardIdx];
      if(t==null) break;
      STATE.selectedDiscardIdx = null;
      STATE.latestDraw = null;
      await doAction(d=>actionDiscard(d, mySeat, t));
      break;
    }
    case 'declareWin': { const mySeat=mySeatIndex(STATE.room); STATE.latestDraw=null; await doAction(d=>actionDeclareSelfWin(d, mySeat)); break; }
    case 'declareKong': { const mySeat=mySeatIndex(STATE.room); STATE.latestDraw=null; await doAction(d=>actionDeclareKongFromHand(d, mySeat, tile)); break; }
    case 'claim': { const mySeat=mySeatIndex(STATE.room); await doAction(d=>actionClaim(d, mySeat, type)); break; }

    case 'nextHand': await doAction(d=>actionNextHand(d)); break;
    case 'endMatch': await doAction(d=>actionEndMatch(d)); break;
    case 'backToLobby': await doAction(d=>actionBackToLobby(d)); break;
  }
}
/* ================= BOTS + POLLING ================= */
let pollHandle = null;
let countdownHandle = null;

async function maybeDriveBots(room){
  if(!room) return null;
  if(room.phase!=='play') return null;
  const seat = room.turnSeat;
  if(room.turnPhase==='draw' && room.seats[seat] && room.seats[seat].isBot){
    return await updateRoom(room.code, draft=>actionDraw(draft, seat));
  }
  if(room.turnPhase==='discard' && room.seats[seat] && room.seats[seat].isBot){
    return await updateRoom(room.code, draft=>{
      if(draft.turnSeat!==seat || draft.turnPhase!=='discard') return false;
      const check = isWinningShape(draft.hands[seat], draft.melds[seat].length, draft.jokerTile);
      if(check.ok) return actionDeclareSelfWin(draft, seat);
      const t = botChooseDiscard(draft.hands[seat], draft.jokerTile);
      return actionDiscard(draft, seat, t);
    });
  }
  if(room.turnPhase==='claim' && room.pendingDiscard){
    for(const sStr of Object.keys(room.pendingDiscard.eligible)){
      const s = Number(sStr);
      if(room.seats[s] && room.seats[s].isBot && room.pendingDiscard.responses[s]===undefined){
        return await updateRoom(room.code, draft=>{
          if(!draft.pendingDiscard || draft.pendingDiscard.responses[s]!==undefined) return false;
          const types = draft.pendingDiscard.eligible[s] || [];
          return actionClaim(draft, s, botClaimDecision(types));
        });
      }
    }
  }
  return null;
}

async function tickBackgroundWork(room){
  if(room.phase==='play' && room.pendingDiscard && Date.now() >= room.pendingDiscard.deadline){
    const r = await updateRoom(room.code, draft=>actionForceResolveClaim(draft));
    if(r) return r;
  }
  return await maybeDriveBots(room);
}

async function pollTick(){
  if(!STATE.roomCode) return;
  const r = await getRoom(STATE.roomCode);
  if(!r) return;
  STATE.room = r;
  renderApp();
  const changed = await tickBackgroundWork(r);
  if(changed){ STATE.room = changed; renderApp(); }
}

function startPolling(){
  stopPolling();
  pollTick();
  pollHandle = setInterval(pollTick, POLL_MS);
  countdownHandle = setInterval(()=>{
    const el = document.getElementById('claim-countdown');
    const pd = STATE.room && STATE.room.pendingDiscard;
    if(el && pd){
      const s = Math.max(0, Math.ceil((pd.deadline - Date.now())/1000));
      el.textContent = '('+s+'s)';
    }
  }, 500);
}
function stopPolling(){
  if(pollHandle){ clearInterval(pollHandle); pollHandle=null; }
  if(countdownHandle){ clearInterval(countdownHandle); countdownHandle=null; }
}

/* ================= INIT ================= */
function setupHandDrag(){
  let startRects = null;

  document.addEventListener('pointerdown', (e)=>{
    const tileEl = e.target.closest('.hand-row .tile[data-hand-idx]');
    if(!tileEl) return;
    const idx = Number(tileEl.getAttribute('data-hand-idx'));
    if(isNaN(idx)) return;
    const row = tileEl.closest('.hand-row');
    const allTiles = Array.from(row.querySelectorAll('.tile[data-hand-idx]'));
    startRects = allTiles.map(el=>({ idx:Number(el.getAttribute('data-hand-idx')), rect: el.getBoundingClientRect() }));
    STATE.dragState = { idx, tileEl, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, moved:false };
    try{ tileEl.setPointerCapture(e.pointerId); }catch(err){}
  });

  document.addEventListener('pointermove', (e)=>{
    const ds = STATE.dragState;
    if(!ds || ds.pointerId!==e.pointerId) return;
    const dx = e.clientX - ds.startX, dy = e.clientY - ds.startY;
    if(!ds.moved && (Math.abs(dx)>6 || Math.abs(dy)>6)) ds.moved = true;
    if(ds.moved){
      ds.tileEl.style.position='relative';
      ds.tileEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.08)`;
      ds.tileEl.classList.add('dragging');
      e.preventDefault();
    }
  });

  document.addEventListener('pointerup', (e)=>{
    const ds = STATE.dragState;
    if(!ds || ds.pointerId!==e.pointerId) return;
    STATE.dragState = null;
    ds.tileEl.style.transform = '';
    ds.tileEl.style.position = '';
    ds.tileEl.classList.remove('dragging');
    try{ ds.tileEl.releasePointerCapture(e.pointerId); }catch(err){}
    if(ds.moved && startRects){
      const others = startRects.filter(r=>r.idx!==ds.idx);
      let target = null, bestDist = Infinity;
      for(const r of others){
        const cx = r.rect.left + r.rect.width/2;
        const cy = r.rect.top + r.rect.height/2;
        const dist = Math.hypot(e.clientX-cx, e.clientY-cy);
        if(dist<bestDist){ bestDist=dist; target=r; }
      }
      if(target){
        const hand = STATE.handOrder.slice();
        const fromIdx = ds.idx;
        const movedTile = hand[fromIdx];
        hand.splice(fromIdx,1);
        let toIdx = target.idx;
        if(toIdx>fromIdx) toIdx--;
        const cx = target.rect.left + target.rect.width/2;
        if(e.clientX > cx) toIdx++;
        hand.splice(toIdx,0,movedTile);
        STATE.handOrder = hand;
      }
      STATE.dragEndedAt = Date.now();
    }
    startRects = null;
    renderApp();
  });
}

async function init(){
  await loadProfile();
  document.addEventListener('click', handleAppClick);
  document.addEventListener('mouseover', (e)=>{
    const tileEl = e.target.closest('.tile[data-tile]');
    if(tileEl) updateTileInfoBar(tileEl.getAttribute('data-tile'));
  });
  setupHandDrag();
  if(PROFILE.lastRoomCode){
    const room = await getRoom(PROFILE.lastRoomCode);
    if(room){
      STATE.roomCode = PROFILE.lastRoomCode;
      STATE.room = room;
      STATE.screen = 'room';
      renderApp();
      startPolling();
      return;
    } else {
      PROFILE.lastRoomCode = null;
      await saveProfile();
    }
  }
  renderApp();
}
init();
