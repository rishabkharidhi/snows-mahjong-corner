/* ================= GAME ENGINE ================= */
function wallExhausted(room) { return room.deckPos > room.backPos; }

function drawFront(room) { const t = room.deck[room.deckPos]; room.deckPos++; return t; }
function drawBack(room) { const t = room.deck[room.backPos]; room.backPos--; return t; }

// Resolves a just-drawn tile: if it's a flower, banks it and draws (and re-resolves)
// a replacement from the back of the wall, repeating until a non-flower tile is in
// hand. Returns false if the wall ran out mid-resolution (caller should end the hand).
function resolveFlowerChain(room, seat, tile, fromBack) {
  let cur = tile;
  while (isFlowerCategory(cur)) {
    room.flowers[seat].push(cur);
    if (room.flowers[seat].length === 13) {
      transferChips(room, [0, 1, 2, 3].filter(s => s !== seat), seat, 'small', 1, 'Thirteen Flowers!');
    }
    if (wallExhausted(room)) return null;
    cur = drawBack(room);
  }
  return cur;
}

function dealNewHand(room) {
  room.deck = shuffle(buildDeck());
  let pos = 0;
  for (let seat = 0; seat < 4; seat++) { room.hands[seat] = room.deck.slice(pos, pos + 16); pos += 16; }
  room.deckPos = pos;
  room.backPos = room.deck.length - 1;
  room.jokerTile = null; // no wildcard tile in this ruleset

  room.melds = [[], [], [], []];
  room.flowers = [[], [], [], []];
  room.discardPile = [];
  room.pendingDiscard = null;
  room.lastHandResult = null;
  room.handNumber++;

  // Flower exchange: dealer first, then in turn order, fully resolve each seat's
  // initial hand before moving to the next.
  for (let i = 0; i < 4; i++) {
    const seat = (room.dealerSeat + i) % 4;
    const hand = room.hands[seat];
    for (let idx = 0; idx < hand.length; idx++) {
      if (isFlowerCategory(hand[idx])) {
        const resolved = resolveFlowerChain(room, seat, hand[idx], true);
        hand[idx] = resolved; // may itself trigger more flowers; resolveFlowerChain loops until non-flower
        if (resolved === null) { endHandDraw(room); return; }
      }
    }
  }

  // Dealer draws the 17th tile (and resolves it if it's a flower) and discards first.
  let extra = drawFront(room);
  const resolvedExtra = resolveFlowerChain(room, room.dealerSeat, extra, false);
  if (resolvedExtra === null) { endHandDraw(room); return; }
  room.hands[room.dealerSeat].push(resolvedExtra);

  room.phase = 'play';
  room.turnSeat = room.dealerSeat;
  room.turnPhase = 'discard';
  pushLog(room, 'Hand ' + room.handNumber + ' dealt — ' + seatName(room, room.dealerSeat) + ' is dealer.');
}

function endHandDraw(room) {
  room.phase = 'handEnd';
  room.pendingDiscard = null;
  room.lastHandResult = { draw: true };
  pushLog(room, 'The wall ran dry — no winner this hand.');
}

/* ---------------- lobby actions ---------------- */
function actionJoinSeat(room, seatIdx, profile) {
  if (room.phase !== 'lobby') return false;
  if (room.seats[seatIdx] && room.seats[seatIdx].id !== profile.id && !room.seats[seatIdx].isBot) return false;
  for (let i = 0; i < 4; i++) { if (room.seats[i] && room.seats[i].id === profile.id) room.seats[i] = null; }
  room.seats[seatIdx] = { id: profile.id, name: profile.name || 'Player', isBot: false, connected: true };
  return true;
}
function actionLeaveSeat(room, profileId) {
  if (room.phase !== 'lobby') return false;
  let changed = false;
  for (let i = 0; i < 4; i++) { if (room.seats[i] && room.seats[i].id === profileId) { room.seats[i] = null; changed = true; } }
  return changed;
}
function actionAddBot(room, seatIdx, hostId) {
  if (room.hostId !== hostId || room.phase !== 'lobby') return false;
  if (room.seats[seatIdx]) return false;
  room.seats[seatIdx] = { id: 'bot_' + seatIdx + '_' + Math.random().toString(36).slice(2, 6), name: ['Lola Bot', 'Tito Bot', 'Ate Bot', 'Kuya Bot'][seatIdx], isBot: true, connected: true };
  return true;
}
function actionRemoveBot(room, seatIdx, hostId) {
  if (room.hostId !== hostId || room.phase !== 'lobby') return false;
  if (!room.seats[seatIdx] || !room.seats[seatIdx].isBot) return false;
  room.seats[seatIdx] = null;
  return true;
}
function actionKickSeat(room, seatIdx, hostId) {
  if (room.hostId !== hostId || room.phase !== 'lobby') return false;
  if (!room.seats[seatIdx]) return false;
  room.seats[seatIdx] = null;
  return true;
}
function actionStartMatch(room, hostId) {
  if (room.hostId !== hostId || room.phase !== 'lobby') return false;
  if (room.seats.some(s => !s)) return false;
  room.dealerSeat = 0;
  room.chips = [0, 0, 0, 0];
  room.handNumber = 0;
  dealNewHand(room);
  return true;
}

/* ---------------- turn flow ---------------- */
function actionDraw(room, seat) {
  if (room.phase !== 'play' || room.turnSeat !== seat || room.turnPhase !== 'draw') return false;
  if (wallExhausted(room)) { endHandDraw(room); return true; }
  const drawn = drawFront(room);
  const resolved = resolveFlowerChain(room, seat, drawn, false);
  if (resolved === null) { endHandDraw(room); return true; }
  room.hands[seat].push(resolved);
  room.turnPhase = 'discard';
  return true;
}
function computeEligibleClaims(room, discardSeat, tile) {
  const out = {};
  for (let seat = 0; seat < 4; seat++) {
    if (seat === discardSeat) continue;
    if (!room.seats[seat]) continue;
    const hand = room.hands[seat];
    const types = [];
    const winCheck = isWinningShape(hand.concat([tile]), room.melds[seat].length, room.jokerTile);
    if (winCheck.ok) types.push('win');
    const hasRoomForMeld = room.melds[seat].length < 5;
    if (hasRoomForMeld && eligibleKong(hand, tile, room.jokerTile)) types.push('kong');
    if (hasRoomForMeld && eligiblePong(hand, tile, room.jokerTile)) types.push('pong');
    if (hasRoomForMeld && seat === (discardSeat + 1) % 4 && eligibleChowRuns(hand, tile, room.jokerTile).length > 0) types.push('chow');
    if (types.length) out[seat] = types;
  }
  return out;
}
function actionDiscard(room, seat, tile) {
  if (room.phase !== 'play' || room.turnSeat !== seat || room.turnPhase !== 'discard') return false;
  const idx = room.hands[seat].indexOf(tile);
  if (idx < 0) return false;
  room.hands[seat].splice(idx, 1);
  room.discardPile.push({ tile, seat });
  const elig = computeEligibleClaims(room, seat, tile);
  if (Object.keys(elig).length > 0) {
    room.pendingDiscard = { tile, seat, eligible: elig, responses: {}, deadline: Date.now() + CLAIM_WINDOW_MS };
    room.turnPhase = 'claim';
  } else {
    advanceTurnAfterDiscard(room, seat);
  }
  pushLog(room, seatName(room, seat) + ' discarded ' + tileLabel(tile) + '.');
  return true;
}
function advanceTurnAfterDiscard(room, fromSeat) {
  room.pendingDiscard = null;
  if (wallExhausted(room)) { endHandDraw(room); return; }
  room.turnSeat = (fromSeat + 1) % 4;
  room.turnPhase = 'draw';
}

/* ---------------- scoring ---------------- */
function scoreHand(room, winnerSeat, winTile, wonBy) {
  const hand = room.hands[winnerSeat];
  const melds = room.melds[winnerSeat];
  const allTiles = hand.concat(winTile ? [winTile] : []);
  const shape = isWinningShape(allTiles, melds.length, room.jokerTile);
  let doubles = 0;
  const labels = [];
  if (shape.special === 'sevenPairsTriple') { doubles += 2; labels.push('Seven Pairs + Triple'); }
  if (isAllPungsHand(allTiles, melds, room.jokerTile)) { doubles += 1; labels.push('All Pungs/Kongs'); }
  if (isAllOneSuitHand(allTiles, melds, room.jokerTile)) { doubles += 1; labels.push('One Suit Flush'); }
  if (melds.some(m => m.type === 'kong')) { doubles += melds.filter(m => m.type === 'kong').length; labels.push('Kong Bonus'); }
  if (wonBy === 'self') { doubles += 1; labels.push('Self-Drawn'); }
  if (room.flowers[winnerSeat].length === 0) { doubles += 1; labels.push('No Flowers'); }
  const base = 1;
  const bigChips = base * Math.pow(2, doubles);
  return { base, doubles, labels, bigChips };
}
function finalizeWin(room, winnerSeat, winTile, wonBy, discarderSeat) {
  const score = scoreHand(room, winnerSeat, winTile, wonBy);
  if (wonBy === 'self') {
    const others = [0, 1, 2, 3].filter(s => s !== winnerSeat);
    transferChips(room, others, winnerSeat, 'big', score.bigChips * 2, 'Self-drawn Mahjong');
  } else {
    const others = [0, 1, 2, 3].filter(s => s !== winnerSeat && s !== discarderSeat);
    transferChips(room, [discarderSeat], winnerSeat, 'big', score.bigChips * 2, 'Mahjong off the discard');
    transferChips(room, others, winnerSeat, 'big', score.bigChips, 'Mahjong off the discard');
  }
  room.phase = 'handEnd';
  room.pendingDiscard = null;
  room.lastHandResult = {
    draw: false, winnerSeat, winTile, wonBy, discarderSeat, score,
    hand: room.hands[winnerSeat].concat(winTile ? [winTile] : []), melds: room.melds[winnerSeat],
  };
  pushLog(room, seatName(room, winnerSeat) + ' wins (' + score.bigChips + ' big chips: ' + score.labels.join(', ') + ')');
  room.dealerSeat = winnerSeat;
}
function actionDeclareSelfWin(room, seat) {
  if (room.phase !== 'play' || room.turnSeat !== seat || room.turnPhase !== 'discard') return false;
  const check = isWinningShape(room.hands[seat], room.melds[seat].length, room.jokerTile);
  if (!check.ok) return false;
  finalizeWin(room, seat, null, 'self', null);
  return true;
}

/* ---------------- melds & kongs ---------------- */
function applyMeldClaim(room, seat, type, tile, fromSeat) {
  const hand = room.hands[seat];
  if (type === 'pong' || type === 'kong') {
    const need = type === 'pong' ? 2 : 3;
    let tilesUsed = [];
    let real = hand.filter(t => t === tile).length;
    let useReal = Math.min(real, need);
    for (let i = 0; i < useReal; i++) { const idx = hand.indexOf(tile); hand.splice(idx, 1); tilesUsed.push(tile); }
    let stillNeed = need - useReal;
    for (let i = 0; i < stillNeed; i++) { const idx = hand.indexOf(room.jokerTile); if (idx < 0) break; hand.splice(idx, 1); tilesUsed.push(room.jokerTile); }
    tilesUsed.push(tile);
    room.melds[seat].push({ type, tiles: tilesUsed, fromSeat });
  } else if (type === 'chow') {
    const runs = eligibleChowRuns(hand, tile, room.jokerTile);
    if (!runs.length) return;
    const pick = runs[0];
    let used = [tile];
    for (const needT of pick) {
      if (hand.includes(needT)) { const idx = hand.indexOf(needT); hand.splice(idx, 1); used.push(needT); }
      else { const idx = hand.indexOf(room.jokerTile); if (idx < 0) continue; hand.splice(idx, 1); used.push(room.jokerTile); }
    }
    room.melds[seat].push({ type: 'chow', tiles: used, fromSeat });
  }
  room.turnSeat = seat;
  room.turnPhase = 'discard';
  pushLog(room, seatName(room, seat) + ' called ' + type.charAt(0).toUpperCase()+type.slice(1) + ' on ' + tileLabel(tile) + '.');
  if (type === 'kong') {
    if (!wallExhausted(room)) {
      const repl = drawBack(room);
      const resolved = resolveFlowerChain(room, seat, repl, true);
      if (resolved === null) { endHandDraw(room); return; }
      room.hands[seat].push(resolved);
    }
    transferChips(room, [0, 1, 2, 3].filter(s => s !== seat), seat, 'small', 1, 'Kang (claimed kong)');
  }
}
function pickClosestToDiscarder(arr, discardSeat) {
  return arr.reduce((best, c) => {
    const dist = (c.seat - discardSeat - 1 + 4) % 4;
    const bestDist = (best.seat - discardSeat - 1 + 4) % 4;
    return dist < bestDist ? c : best;
  });
}
function resolveClaimWindowIfReady(room) {
  const pd = room.pendingDiscard;
  if (!pd) return false;
  const eligibleSeats = Object.keys(pd.eligible).map(Number);
  const allResponded = eligibleSeats.every(s => pd.responses[s] !== undefined);
  const timeUp = Date.now() >= pd.deadline;
  if (!allResponded && !timeUp) return false;
  room.pendingDiscard = null;
  const claims = eligibleSeats.filter(s => pd.responses[s] && pd.responses[s] !== 'pass').map(s => ({ seat: s, type: pd.responses[s] }));
  const winners = claims.filter(c => c.type === 'win');
  if (winners.length) {
    const w = pickClosestToDiscarder(winners, pd.seat);
    room.discardPile.pop();
    finalizeWin(room, w.seat, pd.tile, 'discard', pd.seat);
    return true;
  }
  const kongs = claims.filter(c => c.type === 'kong');
  const pongs = claims.filter(c => c.type === 'pong');
  const chows = claims.filter(c => c.type === 'chow');
  let chosen = null;
  if (kongs.length) chosen = pickClosestToDiscarder(kongs, pd.seat);
  else if (pongs.length) chosen = pickClosestToDiscarder(pongs, pd.seat);
  else if (chows.length) chosen = chows[0];
  if (chosen) {
    room.discardPile.pop();
    applyMeldClaim(room, chosen.seat, chosen.type, pd.tile, pd.seat);
    return true;
  }
  advanceTurnAfterDiscard(room, pd.seat);
  return true;
}
function actionClaim(room, seat, type) {
  if (room.phase !== 'play' || room.turnPhase !== 'claim' || !room.pendingDiscard) return false;
  const pd = room.pendingDiscard;
  if (!pd.eligible[seat]) return false;
  if (pd.responses[seat] !== undefined) return false;
  if (type !== 'pass' && !pd.eligible[seat].includes(type)) return false;
  pd.responses[seat] = type;
  resolveClaimWindowIfReady(room);
  return true;
}
function actionForceResolveClaim(room) {
  if (!room.pendingDiscard) return false;
  if (Date.now() < room.pendingDiscard.deadline) return false;
  return resolveClaimWindowIfReady(room);
}
function myAvailableConcealedKongs(room, seat) {
  const hand = room.hands[seat];
  const counts = countTiles(hand.filter(t => t !== room.jokerTile));
  const out = new Set();
  for (const t of Object.keys(counts)) { if (counts[t] >= 4) out.add(t); }
  for (const m of room.melds[seat]) {
    if (m.type === 'pong') {
      const matchTile = m.tiles.find(t => t !== room.jokerTile);
      if (matchTile && hand.includes(matchTile)) out.add(matchTile);
    }
  }
  return Array.from(out);
}
function actionDeclareKongFromHand(room, seat, tile) {
  if (room.phase !== 'play' || room.turnSeat !== seat || room.turnPhase !== 'discard') return false;
  const hand = room.hands[seat];
  const count = hand.filter(t => t === tile).length;
  let reason = 'Secret Kong (concealed 4-of-a-kind)';
  if (count >= 4) {
    if (room.melds[seat].length >= 5) return false; // no room for a brand-new meld
    for (let i = 0; i < 4; i++) { const idx = hand.indexOf(tile); hand.splice(idx, 1); }
    room.melds[seat].push({ type: 'kong', tiles: [tile, tile, tile, tile], concealed: true });
  } else {
    const pungIdx = room.melds[seat].findIndex(m => m.type === 'pong' && m.tiles.filter(t => t !== room.jokerTile).every(t => t === tile));
    const idx = hand.indexOf(tile);
    if (pungIdx < 0 || idx < 0) return false;
    hand.splice(idx, 1);
    const old = room.melds[seat][pungIdx];
    room.melds[seat][pungIdx] = { type: 'kong', tiles: old.tiles.concat([tile]), upgraded: true };
    reason = 'Sagasa (drew the 4th of a pung)';
  }
  if (wallExhausted(room)) { endHandDraw(room); return true; }
  const repl = drawBack(room);
  const resolved = resolveFlowerChain(room, seat, repl, true);
  if (resolved === null) { endHandDraw(room); return true; }
  room.hands[seat].push(resolved);
  transferChips(room, [0, 1, 2, 3].filter(s => s !== seat), seat, 'small', 1, reason);
  pushLog(room, seatName(room, seat) + ' declared a concealed Kong.');
  return true;
}
function actionNextHand(room) {
  if (room.phase !== 'handEnd') return false;
  dealNewHand(room);
  return true;
}
function actionEndMatch(room) { room.phase = 'matchEnd'; return true; }
function actionBackToLobby(room) {
  const seats = room.seats;
  Object.assign(room, freshRoom(room.code, room.hostId));
  room.seats = seats;
  return true;
}

/* ---------------- bot heuristics ---------------- */
function botChooseDiscard(hand, jokerTile) {
  const counts = countTiles(hand);
  const nonWild = hand.filter(t => t !== jokerTile);
  const pool = nonWild.length ? nonWild : hand;
  const scored = pool.map(t => {
    let score = 0;
    if (counts[t] >= 2) score -= 5;
    if (isSuited(t)) {
      const s = suitOf(t), r = rankOf(t);
      if (hand.includes(s + (r - 1)) || hand.includes(s + (r + 1))) score -= 2;
      if (hand.includes(s + (r - 2)) || hand.includes(s + (r + 2))) score -= 1;
    }
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].t;
}
function botClaimDecision(types) {
  if (types.includes('win')) return 'win';
  if (types.includes('kong') && Math.random() < 0.5) return 'kong';
  if (types.includes('pong') && Math.random() < 0.5) return 'pong';
  if (types.includes('chow') && Math.random() < 0.3) return 'chow';
  return 'pass';
}
