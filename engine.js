/* ================= GAME ENGINE (pure mutations on a room draft) ================= */

function drawPointerExhausted(room){ return room.deckPos >= room.deck.length - DEAD_WALL_SIZE; }

function dealNewHand(room){
  room.deck = shuffle(buildDeck());
  let pos = 0;
  for(let seat=0; seat<4; seat++){ room.hands[seat] = room.deck.slice(pos, pos+13); pos += 13; }
  room.deckPos = pos;
  const dealerExtra = room.deck[room.deckPos]; room.deckPos++;
  room.hands[room.dealerSeat].push(dealerExtra);
  room.melds = [[],[],[],[]];
  room.discardPile = [];
  room.pendingDiscard = null;
  room.lastHandResult = null;
  room.handNumber++;
  room.phase = 'pass';
  room.passPhase = { submitted:{} };
  room.turnSeat = room.dealerSeat;
  room.turnPhase = 'discard';
  pushLog(room, 'Hand '+room.handNumber+' dealt — '+seatName(room,room.dealerSeat)+' is dealer.');
}
function seatName(room, seat){ return room.seats[seat] ? room.seats[seat].name : '???'; }

function actionCreateRoom_(room){ return true; } // room created fresh, nothing else to mutate

function actionJoinSeat(room, seatIdx, profile){
  if(room.phase!=='lobby') return false;
  if(room.seats[seatIdx] && room.seats[seatIdx].id!==profile.id && !room.seats[seatIdx].isBot) return false;
  for(let i=0;i<4;i++){ if(room.seats[i] && room.seats[i].id===profile.id) room.seats[i]=null; }
  room.seats[seatIdx] = { id:profile.id, name:profile.name||'Player', isBot:false, connected:true };
  return true;
}
function actionLeaveSeat(room, profileId){
  if(room.phase!=='lobby') return false;
  let changed=false;
  for(let i=0;i<4;i++){ if(room.seats[i] && room.seats[i].id===profileId){ room.seats[i]=null; changed=true; } }
  return changed;
}
function actionAddBot(room, seatIdx, hostId){
  if(room.hostId!==hostId || room.phase!=='lobby') return false;
  if(room.seats[seatIdx]) return false; // already occupied — idempotent no-op, never overwrite
  room.seats[seatIdx] = { id:'bot_'+seatIdx+'_'+Math.random().toString(36).slice(2,6), name: ['Lola Bot','Tito Bot','Ate Bot','Kuya Bot'][seatIdx], isBot:true, connected:true };
  return true;
}
function actionRemoveBot(room, seatIdx, hostId){
  if(room.hostId!==hostId || room.phase!=='lobby') return false;
  if(!room.seats[seatIdx] || !room.seats[seatIdx].isBot) return false; // already empty/human — idempotent no-op
  room.seats[seatIdx] = null;
  return true;
}
function actionKickSeat(room, seatIdx, hostId){
  if(room.hostId!==hostId || room.phase!=='lobby') return false;
  if(!room.seats[seatIdx]) return false;
  room.seats[seatIdx] = null;
  return true;
}
function actionStartMatch(room, hostId){
  if(room.hostId!==hostId) return false;
  if(room.phase!=='lobby') return false;
  if(room.seats.some(s=>!s)) return false;
  room.dealerSeat = 0;
  room.chips = [0,0,0,0];
  room.handNumber = 0;
  dealNewHand(room);
  return true;
}

function actionSubmitPass(room, seat, tiles3){
  if(room.phase!=='pass') return false;
  if(!room.passPhase || room.passPhase.submitted[seat]) return false;
  const hand = room.hands[seat].slice();
  for(const t of tiles3){ const idx=hand.indexOf(t); if(idx<0) return false; hand.splice(idx,1); }
  if(tiles3.length!==3) return false;
  room.passPhase.submitted[seat] = tiles3.slice();
  const allIn = [0,1,2,3].every(s=>room.passPhase.submitted[s]);
  if(allIn){
    for(let s=0;s<4;s++){
      const chosen = room.passPhase.submitted[s];
      for(const t of chosen){ const idx=room.hands[s].indexOf(t); if(idx>=0) room.hands[s].splice(idx,1); }
    }
    for(let s=0;s<4;s++){
      const target=(s+1)%4;
      room.hands[target] = room.hands[target].concat(room.passPhase.submitted[s]);
    }
    room.passPhase = null;
    room.phase = 'play';
    room.turnSeat = room.dealerSeat;
    room.turnPhase = 'discard';
    pushLog(room, 'Tiles passed to the right — '+seatName(room,room.dealerSeat)+' leads.');
  }
  return true;
}

function advanceTurnAfterDiscard(room, fromSeat){
  room.pendingDiscard = null;
  if(drawPointerExhausted(room)){ endHandDraw(room); return; }
  room.turnSeat = (fromSeat+1)%4;
  room.turnPhase = 'draw';
}
function endHandDraw(room){
  room.phase = 'handEnd';
  room.pendingDiscard = null;
  room.lastHandResult = { draw:true };
  pushLog(room, 'The wall ran dry — no winner this hand.');
}

function actionDiscard(room, seat, tile){
  if(room.phase!=='play' || room.turnSeat!==seat || room.turnPhase!=='discard') return false;
  const idx = room.hands[seat].indexOf(tile);
  if(idx<0) return false;
  room.hands[seat].splice(idx,1);
  room.discardPile.push({tile, seat});
  const elig = computeEligibleClaims(room, seat, tile);
  if(Object.keys(elig).length>0){
    room.pendingDiscard = { tile, seat, eligible:elig, responses:{}, deadline: Date.now()+CLAIM_WINDOW_MS };
    room.turnPhase = 'claim';
  } else {
    advanceTurnAfterDiscard(room, seat);
  }
  pushLog(room, seatName(room,seat)+' discarded '+tileLabel(tile)+'.');
  return true;
}
function actionDraw(room, seat){
  if(room.phase!=='play' || room.turnSeat!==seat || room.turnPhase!=='draw') return false;
  if(drawPointerExhausted(room)){ endHandDraw(room); return true; }
  const tile = room.deck[room.deckPos]; room.deckPos++;
  room.hands[seat].push(tile);
  room.turnPhase = 'discard';
  return true;
}
function actionDeclareSelfWin(room, seat){
  if(room.phase!=='play' || room.turnSeat!==seat || room.turnPhase!=='discard') return false;
  const check = isWinningShape(room.hands[seat], room.melds[seat].length);
  if(!check.ok) return false;
  finalizeWin(room, seat, null, 'self', null);
  return true;
}
function actionDeclarePopEye(room, seat){
  if(room.phase!=='play' || room.turnSeat!==seat) return false;
  if(jokerCountIn(room.hands[seat])<4) return false;
  room.phase = 'handEnd';
  room.pendingDiscard = null;
  const others = [0,1,2,3].filter(s=>s!==seat);
  transferChips(room, others, seat, 'big', 2, 'Pop-Eye! (all four Jokers)');
  room.lastHandResult = { popEye:true, winnerSeat:seat };
  room.dealerSeat = seat;
  pushLog(room, seatName(room,seat)+' grabbed all four Jokers — Pop-Eye instant win!');
  return true;
}
function finalizeWin(room, winnerSeat, winTile, wonBy, discarderSeat){
  const score = scoreHand(room, winnerSeat, winTile, wonBy, discarderSeat);
  if(wonBy==='self'){
    const others = [0,1,2,3].filter(s=>s!==winnerSeat);
    transferChips(room, others, winnerSeat, 'big', score.bigChips*2, 'Self-drawn Mahjong');
  } else {
    const others = [0,1,2,3].filter(s=>s!==winnerSeat && s!==discarderSeat);
    transferChips(room, [discarderSeat], winnerSeat, 'big', score.bigChips*2, 'Mahjong off the discard');
    transferChips(room, others, winnerSeat, 'big', score.bigChips, 'Mahjong off the discard');
  }
  room.phase = 'handEnd';
  room.pendingDiscard = null;
  room.lastHandResult = { draw:false, winnerSeat, winTile, wonBy, discarderSeat, score,
    hand: room.hands[winnerSeat].concat(winTile?[winTile]:[]), melds: room.melds[winnerSeat] };
  pushLog(room, seatName(room,winnerSeat)+' wins ('+score.bigChips+' big chip'+(score.bigChips===1?'':'s')+': '+score.labels.join(', ')+')');
  room.dealerSeat = winnerSeat;
}

function applyMeldClaim(room, seat, type, tile, fromSeat){
  const hand = room.hands[seat];
  if(type==='pong' || type==='kong'){
    const need = type==='pong' ? 2 : 3;
    let tilesUsed = [];
    let real = hand.filter(t=>t===tile).length;
    let useReal = Math.min(real, need);
    for(let i=0;i<useReal;i++){ const idx=hand.indexOf(tile); hand.splice(idx,1); tilesUsed.push(tile); }
    let stillNeed = need - useReal;
    for(let i=0;i<stillNeed;i++){ const idx=hand.indexOf('JK'); if(idx<0) break; hand.splice(idx,1); tilesUsed.push('JK'); }
    tilesUsed.push(tile);
    room.melds[seat].push({ type, tiles: tilesUsed, fromSeat });
  } else if(type==='chow'){
    const runs = eligibleChowRuns(hand, tile);
    if(!runs.length) return;
    const pick = runs[0];
    let used = [tile];
    for(const needT of pick){
      if(hand.includes(needT)){ const idx=hand.indexOf(needT); hand.splice(idx,1); used.push(needT); }
      else { const idx=hand.indexOf('JK'); if(idx<0) continue; hand.splice(idx,1); used.push('JK'); }
    }
    room.melds[seat].push({ type:'chow', tiles: used, fromSeat });
  }
  room.turnSeat = seat;
  room.turnPhase = 'discard';
  pushLog(room, seatName(room,seat)+' called '+type+' on '+tileLabel(tile)+'.');
  if(type==='kong'){
    if(!drawPointerExhausted(room)){
      const repl = room.deck[room.deckPos]; room.deckPos++;
      room.hands[seat].push(repl);
    }
    transferChips(room, [0,1,2,3].filter(s=>s!==seat), seat, 'small', 1, 'Kang (claimed kong)');
  }
}

function pickClosestToDiscarder(arr, discardSeat){
  return arr.reduce((best,c)=>{
    const dist = (c.seat - discardSeat - 1 + 4)%4;
    const bestDist = (best.seat - discardSeat - 1 + 4)%4;
    return dist < bestDist ? c : best;
  });
}
function resolveClaimWindowIfReady(room){
  const pd = room.pendingDiscard;
  if(!pd) return false;
  const eligibleSeats = Object.keys(pd.eligible).map(Number);
  const allResponded = eligibleSeats.every(s => pd.responses[s] !== undefined);
  const timeUp = Date.now() >= pd.deadline;
  if(!allResponded && !timeUp) return false;
  room.pendingDiscard = null; // detach now — everything below uses the captured `pd`, not room.pendingDiscard
  const claims = eligibleSeats.filter(s => pd.responses[s] && pd.responses[s]!=='pass')
    .map(s => ({ seat:s, type: pd.responses[s] }));
  const winners = claims.filter(c=>c.type==='win');
  if(winners.length){
    const w = pickClosestToDiscarder(winners, pd.seat);
    room.discardPile.pop();
    finalizeWin(room, w.seat, pd.tile, 'discard', pd.seat);
    return true;
  }
  const kongs = claims.filter(c=>c.type==='kong');
  const pongs = claims.filter(c=>c.type==='pong');
  const chows = claims.filter(c=>c.type==='chow');
  let chosen = null;
  if(kongs.length) chosen = pickClosestToDiscarder(kongs, pd.seat);
  else if(pongs.length) chosen = pickClosestToDiscarder(pongs, pd.seat);
  else if(chows.length) chosen = chows[0];
  if(chosen){
    room.discardPile.pop();
    applyMeldClaim(room, chosen.seat, chosen.type, pd.tile, pd.seat);
    return true;
  }
  advanceTurnAfterDiscard(room, pd.seat);
  return true;
}
function actionClaim(room, seat, type){
  if(room.phase!=='play' || room.turnPhase!=='claim' || !room.pendingDiscard) return false;
  const pd = room.pendingDiscard;
  if(!pd.eligible[seat]) return false;
  if(pd.responses[seat]!==undefined) return false;
  if(type!=='pass' && !pd.eligible[seat].includes(type)) return false;
  pd.responses[seat] = type;
  resolveClaimWindowIfReady(room);
  return true;
}
function actionForceResolveClaim(room){
  if(!room.pendingDiscard) return false;
  if(Date.now() < room.pendingDiscard.deadline) return false;
  return resolveClaimWindowIfReady(room);
}
function myAvailableConcealedKongs(room, seat){
  const hand = room.hands[seat];
  const counts = countTiles(hand.filter(t=>!isJoker(t)));
  const out = new Set();
  for(const t of Object.keys(counts)){ if(counts[t]>=4) out.add(t); }
  for(const m of room.melds[seat]){
    if(m.type==='pong'){
      const matchTile = m.tiles.find(t=>!isJoker(t));
      if(matchTile && hand.includes(matchTile)) out.add(matchTile);
    }
  }
  return Array.from(out);
}
function actionDeclareKongFromHand(room, seat, tile){
  if(room.phase!=='play' || room.turnSeat!==seat || room.turnPhase!=='discard') return false;
  const hand = room.hands[seat];
  const count = hand.filter(t=>t===tile).length;
  let reason = 'Secret Kong (concealed 4-of-a-kind)';
  if(count>=4){
    for(let i=0;i<4;i++){ const idx=hand.indexOf(tile); hand.splice(idx,1); }
    room.melds[seat].push({ type:'kong', tiles:[tile,tile,tile,tile], concealed:true });
  } else {
    const pungIdx = room.melds[seat].findIndex(m=>m.type==='pong' && m.tiles.filter(t=>!isJoker(t)).every(t=>t===tile));
    const idx = hand.indexOf(tile);
    if(pungIdx<0 || idx<0) return false;
    hand.splice(idx,1);
    const old = room.melds[seat][pungIdx];
    room.melds[seat][pungIdx] = { type:'kong', tiles: old.tiles.concat([tile]), upgraded:true };
    reason = 'Sagasa (drew the 4th of a pung)';
  }
  if(drawPointerExhausted(room)){ endHandDraw(room); return true; }
  const repl = room.deck[room.deckPos]; room.deckPos++;
  room.hands[seat].push(repl);
  transferChips(room, [0,1,2,3].filter(s=>s!==seat), seat, 'small', 1, reason);
  pushLog(room, seatName(room,seat)+' declared a concealed Kong.');
  return true;
}
function actionNextHand(room){
  if(room.phase!=='handEnd') return false;
  dealNewHand(room);
  return true;
}
function actionEndMatch(room){
  room.phase = 'matchEnd';
  return true;
}
function actionBackToLobby(room){
  const seats = room.seats;
  Object.assign(room, freshRoom(room.code, room.hostId));
  room.seats = seats;
  return true;
}

/* ---------------- bot heuristics ---------------- */
function botChoosePassTiles(hand){
  const counts = countTiles(hand);
  const scored = hand.map((t,i)=>{
    let score=0;
    if(isJoker(t)) score-=99;
    else if(isHonor(t)){ score+=3; if(counts[t]>=2) score-=4; }
    else {
      const s=suitOf(t), r=rankOf(t);
      if(counts[t]>=2) score-=4;
      const hasNeighbor = hand.includes(s+(r-1)) || hand.includes(s+(r+1));
      if(!hasNeighbor) score+=2;
      if(r===1||r===9) score+=1;
    }
    return {t,i,score};
  });
  scored.sort((a,b)=>b.score-a.score);
  return scored.slice(0,3).map(x=>x.t);
}
function botChooseDiscard(hand){
  const counts = countTiles(hand);
  const nonJoker = hand.filter(t=>!isJoker(t));
  const pool = nonJoker.length ? nonJoker : hand;
  const scored = pool.map(t=>{
    let score=0;
    if(counts[t]>=2) score-=5;
    if(isHonor(t)) score+=2;
    if(isSuited(t)){
      const s=suitOf(t), r=rankOf(t);
      if(hand.includes(s+(r-1)) || hand.includes(s+(r+1))) score-=2;
      if(hand.includes(s+(r-2)) || hand.includes(s+(r+2))) score-=1;
    }
    return {t,score};
  });
  scored.sort((a,b)=>b.score-a.score);
  return scored[0].t;
}
function botClaimDecision(types){
  if(types.includes('win')) return 'win';
  if(types.includes('kong') && Math.random()<0.5) return 'kong';
  if(types.includes('pong') && Math.random()<0.5) return 'pong';
  if(types.includes('chow') && Math.random()<0.3) return 'chow';
  return 'pass';
}
