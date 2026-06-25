/* ================= RENDERING ================= */
const SHUFFLE_QUIPS = [
  "You make my heart shuffle.",
  "We're a perfect combo.",
  "You're my favorite match.",
  "Let's stick together like tiles.",
  "You complete my set.",
];

let STATE = {
  screen: 'home',
  roomCode: null,
  room: null,
  selectedDiscardIdx: null,
  showHowTo: false,
  showLog: false,
  busy: false,
  lastPhaseSeen: null,
  seenChipEventIds: new Set(),
  activeToasts: [],
  shuffleQuip: '',
  handOrder: [],
  dragState: null,
  dragEndedAt: 0,
  latestDraw: null,
  suppressPollRender: false,
  shuffleUntil: 0,
};

// Reconciles STATE.handOrder against the player's actual current hand: keeps the
// existing custom arrangement for tiles still present, drops tiles no longer held
// (discarded/melded), and appends any newly-drawn tiles (sorted) at the end. This
// is what lets manual rearranging survive normal gameplay (draws/discards) without
// snapping back to sorted order every time.
function getDisplayHand(actualHand){
  const actualCounts = countTiles(actualHand);
  const usedCounts = {};
  const kept = [];
  for(const t of STATE.handOrder){
    const c = usedCounts[t]||0;
    if(c < (actualCounts[t]||0)){ kept.push(t); usedCounts[t]=c+1; }
  }
  const remaining = [];
  for(const t of Object.keys(actualCounts)){
    let have = usedCounts[t]||0;
    while(have < actualCounts[t]){ remaining.push(t); have++; }
  }
  const newOrder = kept.concat(sortHand(remaining));
  STATE.handOrder = newOrder;
  return newOrder;
}

function tileNode(tile, opts){
  opts = opts || {};
  const cls = ['tile'];
  if(opts.big) cls.push('big');
  if(opts.back) cls.push('back');
  if(opts.clickable) cls.push('clickable');
  if(opts.selected) cls.push('selected');
  if(opts.justDrawn) cls.push('just-drawn');
  if(!opts.back){
    if(opts.wild) cls.push('joker');
    else if(isFlowerCategory(tile)){
      cls.push('flowercat');
      if(DRAGONS.includes(tile)) cls.push('dragon-'+tile);
    }
    else cls.push('suit-'+suitOf(tile));
  }
  const glyph = opts.back ? '' : (GLYPH[tile]||'?');
  const numBadge = (!opts.back && isSuited(tile)) ? `<span class="tile-num">${rankOf(tile)}</span>` : '';
  let dataAttrs = opts.back ? '' : ` data-tile="${tile}"`;
  if(opts.action) dataAttrs += ` data-action="${opts.action}"${opts.extra||''}`;
  return `<div class="${cls.join(' ')}" title="${opts.back?'':tileLabel(tile)}"${dataAttrs}>${numBadge}${glyph}</div>`;
}
function meldNode(meld, jokerTile){
  return `<div class="meld-tiles">${meld.tiles.map(t=>tileNode(t,{wild:t===jokerTile})).join('')}</div>`;
}
function backTilesRow(n){
  let s='<div class="tilecount">';
  for(let i=0;i<Math.min(n,17);i++) s += '<div class="backtile"></div>';
  s += '</div>';
  return s;
}
function flowerRow(flowerTiles){
  if(!flowerTiles || !flowerTiles.length) return '';
  return `<div class="flower-row">${flowerTiles.map(f=>`<span class="flower-chip" title="${tileLabel(f)}">${GLYPH[f]}</span>`).join('')}</div>`;
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function fmtMoney(n){
  const sign = n>0 ? '+' : (n<0 ? '−' : '');
  return sign + '$' + Math.abs(n).toFixed(2);
}
function moneyClass(n){ return n>0 ? 'money-pos' : (n<0 ? 'money-neg' : 'money-zero'); }

function renderShuffleScreen(){
  return `<div class="screen center" style="justify-content:center;align-items:center;flex:1;">
    <div class="shuffle-tiles">
      <div class="tile back shuffle-a"></div>
      <div class="tile back shuffle-b"></div>
      <div class="tile back shuffle-c"></div>
    </div>
    <p class="shuffle-quip">${escapeHtml(STATE.shuffleQuip)}</p>
    <p class="muted">Shuffling the tiles…</p>
  </div>`;
}

function detectNewChipToasts(room){
  if(!room || !room.chipEvents) return;
  let scheduled = false;
  for(const ev of room.chipEvents){
    if(STATE.seenChipEventIds.has(ev.id)) continue;
    STATE.seenChipEventIds.add(ev.id);
    if(Date.now() - ev.ts < 6000){
      const fromNames = ev.fromSeats.map(s=>seatName(room,s)).join(', ');
      const toName = seatName(room, ev.toSeat);
      const icon = ev.type==='big' ? '🟡' : '⚪';
      const unit = ev.type==='big' ? BIG_CHIP : SMALL_CHIP;
      const amount = (unit*ev.countEach).toFixed(2);
      const text = `${icon.repeat(Math.min(ev.countEach,6))} ${fromNames} → <b>${toName}</b> · $${amount} — ${ev.reason}`;
      STATE.activeToasts.push({ id: ev.id, text, expiresAt: Date.now()+4200 });
      scheduled = true;
    }
  }
  STATE.activeToasts = STATE.activeToasts.filter(t=>t.expiresAt>Date.now());
  if(scheduled) setTimeout(renderApp, 4300);
}
function renderChipToasts(){
  if(!STATE.activeToasts || !STATE.activeToasts.length) return '';
  return `<div class="chip-toast-stack">${STATE.activeToasts.map(t=>`<div class="chip-toast">${t.text}</div>`).join('')}</div>`;
}

function renderApp(){
  if(STATE.dragState) return; // never rebuild the DOM mid-drag — would yank the dragged tile out from under the pointer
  const app = document.getElementById('app');

  if(STATE.room){
    const prevPhase = STATE.lastPhaseSeen;
    const curPhase = STATE.room.phase;
    if(curPhase==='play' && (prevPhase==='lobby' || prevPhase==='handEnd')){
      STATE.shuffleQuip = SHUFFLE_QUIPS[Math.floor(Math.random()*SHUFFLE_QUIPS.length)];
      STATE.shuffleUntil = Date.now() + 1700;
      setTimeout(renderApp, 1750);
    }
    STATE.lastPhaseSeen = curPhase;
    detectNewChipToasts(STATE.room);
  }

  if(STATE.screen==='home'){
    app.innerHTML = renderHome();
  } else if(!STATE.room){
    app.innerHTML = `<div class="screen center" style="justify-content:center;flex:1;"><p class="muted">Loading room…</p></div>`;
  } else if(Date.now() < STATE.shuffleUntil){
    app.innerHTML = renderLanterns() + renderShuffleScreen();
    return;
  } else if(STATE.room.phase==='lobby'){
    app.innerHTML = renderLanterns() + renderLobby(STATE.room);
  } else {
    app.innerHTML = renderLanterns() + renderGame(STATE.room);
  }
  if(STATE.showHowTo) app.insertAdjacentHTML('beforeend', renderHowTo());
}

function renderLanterns(){
  return `<div class="lanterns">${Array.from({length:7}).map(()=>'<div class="lantern"></div>').join('')}</div>`;
}
function renderHome(){
  return `
  ${renderLanterns()}
  <div class="screen">
    <div class="center" style="margin-bottom:8px;">
      <h1 class="brand">🀄 Snows Mahjong Corner</h1>
      <p class="subtitle">Authentic 16-tile Filipino mahjong, played online with your barkada.</p>
    </div>
    <div class="card">
      <label for="nameInput">Your name</label>
      <input id="nameInput" type="text" maxlength="18" placeholder="e.g. Tita Rosa" value="${escapeHtml(PROFILE.name||'')}">
    </div>
    <div class="card">
      <label>Start a new table</label>
      <p class="muted" style="margin-top:-4px;">You'll get a 4-letter room code to share with friends.</p>
      <button class="btn" data-action="createRoom" style="width:100%;margin-top:6px;" type="button">🏮 Create a room</button>
    </div>
    <div class="card">
      <label for="joinCodeInput">Join a room</label>
      <input id="joinCodeInput" type="text" maxlength="4" placeholder="Room code, e.g. ABCD" style="text-transform:uppercase;letter-spacing:.15em;">
      <button class="btn secondary" data-action="joinRoom" style="width:100%;margin-top:8px;" type="button">🚪 Join</button>
    </div>
    <p id="homeError" class="muted center" style="color:#e08a6f;min-height:18px;"></p>
    <p class="muted center" style="margin-top:-4px;">Games save automatically — close this anytime and reopen the same link to pick up right where you left off.</p>
    <p class="center"><button class="linkish" data-action="toggleHowTo" type="button">How does this work? / House rules</button></p>
  </div>`;
}
function renderLobby(room){
  const my = mySeatIndex(room);
  const isHost = room.hostId === PROFILE.id;
  const seatsHtml = room.seats.map((s,i)=>{
    const windLabel = ['East','South','West','North'][i];
    if(!s){
      return `<div class="seat-card empty">
        <span class="seat-wind">${windLabel[0]}</span>
        <div class="seat-name muted">Open seat</div>
        <div class="btn-row">
          <button class="btn jade" style="padding:6px 10px;font-size:.8rem;" data-action="joinSeat" data-seat="${i}" type="button">Sit here</button>
          ${isHost?`<button class="btn secondary" style="padding:6px 10px;font-size:.8rem;" data-action="addBot" data-seat="${i}" type="button">+ Bot</button>`:''}
        </div>
      </div>`;
    }
    const mine = s.id===PROFILE.id;
    return `<div class="seat-card ${mine?'mine':''}">
      <span class="seat-wind">${windLabel[0]}</span>
      <div class="seat-name">${escapeHtml(s.name)}${s.isBot?' 🤖':''}${mine?' (you)':''}</div>
      <div class="seat-tag">${windLabel} ${room.hostId===s.id?'· Host':''}</div>
      <div class="btn-row">
        ${mine?`<button class="btn secondary" style="padding:5px 9px;font-size:.75rem;" data-action="leaveSeat" type="button">Leave</button>`:''}
        ${(isHost && s.isBot)?`<button class="btn secondary" style="padding:5px 9px;font-size:.75rem;" data-action="removeBot" data-seat="${i}" type="button">Remove bot</button>`:''}
        ${(isHost && !mine && !s.isBot)?`<button class="btn ember" style="padding:5px 9px;font-size:.75rem;" data-action="kickSeat" data-seat="${i}" type="button">Kick</button>`:''}
      </div>
    </div>`;
  }).join('');

  const filled = room.seats.every(s=>s);
  return `
  <div class="screen">
    <div class="title-row">
      <h1 class="brand" style="font-size:1.5rem;margin:0;">🏮 Room ${room.code}</h1>
      <button class="icon-btn" data-action="copyCode" title="Copy room code" type="button">📋</button>
    </div>
    <p class="muted">Share this code so your friends can join: <span class="pill">${room.code}</span></p>
    <div class="seat-grid">${seatsHtml}</div>
    <div class="btn-row" style="margin-top:6px;">
      ${isHost?`<button class="btn" style="flex:1;" data-action="startMatch" ${filled?'':'disabled'} type="button">🀄 Start the game</button>`:`<p class="muted">Waiting for the host to start…</p>`}
    </div>
    ${!filled?'<p class="muted center" style="margin-top:6px;">Fill all four seats (friends or bots) to start.</p>':''}
    <div class="btn-row" style="margin-top:10px;">
      <button class="btn secondary" data-action="leaveRoom" type="button">⟵ Leave room</button>
      <button class="linkish" data-action="toggleHowTo" type="button">How to play</button>
    </div>
  </div>`;
}
function renderOpponentsRow(room, mySeat){
  const order = mySeat<0 ? [0,1,2,3] : [ (mySeat+1)%4, (mySeat+2)%4, (mySeat+3)%4 ];
  return `<div class="opponents-row">` + order.map(seat=>{
    const s = room.seats[seat];
    if(!s) return '';
    const isTurn = room.phase==='play' && room.turnSeat===seat;
    const initials = (s.name||'?').slice(0,2).toUpperCase();
    const handCount = room.hands[seat] ? room.hands[seat].length : 0;
    const melds = (room.melds[seat]||[]).map(m=>meldNode(m, room.jokerTile)).join('');
    return `<div class="opp ${isTurn?'turn':''}">
      <div class="avatar">${initials}</div>
      <div class="nm">${escapeHtml(s.name)}${room.dealerSeat===seat?' 🀄':''}${s.isBot?' 🤖':''}</div>
      <div class="opp-balance ${moneyClass(room.chips[seat])}">${fmtMoney(room.chips[seat])}</div>
      ${backTilesRow(handCount)}
      <div class="meld-strip">${melds}</div>
      ${flowerRow(room.flowers[seat])}
    </div>`;
  }).join('') + `</div>`;
}

function renderFelt(room){
  const wallLeft = Math.max(0, room.backPos - room.deckPos + 1);
  const discards = room.discardPile.slice(-16);
  const lastIdx = discards.length-1;
  const discardHtml = discards.map((d,i)=>{
    const ring = i===lastIdx ? 'last-discard-ring' : '';
    return `<span class="${ring}">${tileNode(d.tile,{})}</span>`;
  }).join('');
  return `<div class="felt">
    <div class="wall-info">🀫 Wall: ${wallLeft}</div>
    <div class="dealer-info">🀄 ${seatName(room,room.dealerSeat)}</div>
    ${discards.length? `<div class="discard-grid">${discardHtml}</div>` : `<p class="muted center">The table is set. First discard coming up…</p>`}
  </div>`;
}

function renderPlayDock(room, mySeat){
  if(mySeat<0){
    return `<div class="hand-dock"><p class="muted center">You're spectating this table.</p></div>`;
  }
  const hand = getDisplayHand(room.hands[mySeat]||[]);
  const melds = room.melds[mySeat]||[];
  const myTurn = room.turnSeat===mySeat;
  const pd = room.pendingDiscard;
  const iCanClaim = pd && pd.eligible[mySeat] && pd.responses[mySeat]===undefined;

  const meldsHtml = melds.map(m=>meldNode(m, room.jokerTile)).join('');
  const handHtml = hand.map((t,idx)=>{
    const sel = STATE.selectedDiscardIdx === idx;
    const clickable = myTurn && room.turnPhase==='discard';
    const wild = t===room.jokerTile;
    const justDrawn = myTurn && room.turnPhase==='discard' && STATE.latestDraw && STATE.latestDraw.idx===idx && t===STATE.latestDraw.tile;
    const numBadge = isSuited(t) ? `<span class="tile-num">${rankOf(t)}</span>` : '';
    return `<div class="tile ${clickable?'clickable':''} ${sel?'selected':''} ${justDrawn?'just-drawn':''} ${wild?'joker':(isFlowerCategory(t)?('flowercat '+(DRAGONS.includes(t)?'dragon-'+t:'')):('suit-'+suitOf(t)))}"
      data-tile="${t}" data-hand-idx="${idx}" ${clickable?`data-action="selectDiscard" data-idx="${idx}"`:''} title="${tileLabel(t)}">${numBadge}${GLYPH[t]}</div>`;
  }).join('');

  let actionBar = '';
  let banner = '';
  if(myTurn && room.turnPhase==='draw'){
    banner = `Your turn — draw a tile.`;
    actionBar = `<button class="btn" data-action="drawTile" type="button">🀫 Draw tile</button>`;
  } else if(myTurn && room.turnPhase==='discard'){
    const canWin = isWinningShape(room.hands[mySeat], melds.length, room.jokerTile).ok;
    const kongs = myAvailableConcealedKongs(room, mySeat);
    banner = canWin ? `You can declare Mahjong! 🎉` : `Your turn — pick a tile to discard.`;
    actionBar = `
      ${canWin?`<button class="btn jade" data-action="declareWin" type="button">🀄 Declare Mahjong</button>`:''}
      ${kongs.map(t=>`<button class="btn secondary" data-action="declareKong" data-tile="${t}" type="button">Kong ${tileLabel(t)}</button>`).join('')}
      <button class="btn ember" data-action="confirmDiscard" ${STATE.selectedDiscardIdx==null?'disabled':''} type="button">Discard</button>`;
  } else if(room.turnPhase==='claim' && pd){
    const secondsLeft = Math.max(0, Math.ceil((pd.deadline-Date.now())/1000));
    if(iCanClaim){
      banner = `${seatName(room,pd.seat)} discarded ${tileLabel(pd.tile)} — claim it? <span id="claim-countdown">(${secondsLeft}s)</span>`;
      const types = pd.eligible[mySeat];
      actionBar = types.map(ty=>{
        const label = ty==='win'?'🀄 Mahjong!':ty.charAt(0).toUpperCase()+ty.slice(1);
        const cls = ty==='win'?'jade':'secondary';
        return `<button class="btn ${cls}" data-action="claim" data-type="${ty}" type="button">${label}</button>`;
      }).join('') + `<button class="btn secondary" data-action="claim" data-type="pass" type="button">Pass</button>`;
    } else {
      banner = `${seatName(room,pd.seat)} discarded ${tileLabel(pd.tile)} — waiting on others… <span id="claim-countdown">(${secondsLeft}s)</span>`;
    }
  } else {
    banner = `Waiting for ${seatName(room,room.turnSeat)}…`;
  }

  return `
  <div class="hand-dock">
    <div class="turn-banner">${banner}</div>
    ${meldsHtml?`<div class="my-melds">${meldsHtml}</div>`:''}
    ${room.flowers[mySeat] && room.flowers[mySeat].length ? `<div class="my-flowers">${room.flowers[mySeat].map(f=>tileNode(f,{})).join('')}</div>` : ''}
    <div class="hand-row-wrap">
      <div class="hand-row">${handHtml}</div>
      <button class="icon-btn" data-action="sortHand" type="button" title="Sort hand">⇅</button>
    </div>
    <div class="action-bar">${actionBar}</div>
  </div>`;
}
function renderScoreTable(room){
  return `<table class="score-table"><thead><tr><th>Player</th><th>Chips</th></tr></thead><tbody>
    ${room.seats.map((s,i)=>`<tr><td>${s?escapeHtml(s.name):'—'}${room.dealerSeat===i?' 🀄':''}</td><td class="${moneyClass(room.chips[i])}">${fmtMoney(room.chips[i])}</td></tr>`).join('')}
  </tbody></table>`;
}

function renderHandEndModal(room){
  const r = room.lastHandResult;
  if(!r) return '';
  const isHost = room.hostId===PROFILE.id;
  let body = '';
  if(r.draw){
    body = `<p class="muted">The wall ran dry — nobody completed a hand. The deal stays with ${seatName(room,room.dealerSeat)}.</p>`;
  } else {
    const handHtml = sortHand(r.hand).map(t=>tileNode(t,{wild:t===room.jokerTile})).join('');
    const meldsHtml = (r.melds||[]).map(m=>meldNode(m, room.jokerTile)).join('');
    const chipIcons = '🟡'.repeat(Math.min(r.score.bigChips,8));
    body = `
      <p><b>${seatName(room,r.winnerSeat)}</b> wins ${r.wonBy==='self'?'by self-draw 🌟':'off '+seatName(room,r.discarderSeat)+"'s discard"}!</p>
      <div class="hand-row" style="justify-content:flex-start;">${handHtml}</div>
      ${meldsHtml?`<div class="my-melds" style="justify-content:flex-start;">${meldsHtml}</div>`:''}
      <p style="margin-top:8px;">${r.score.labels.map(l=>`<span class="bonus-tag">${l}</span>`).join('')}</p>
      <p class="muted">${chipIcons} ${r.score.bigChips} big chip${r.score.bigChips===1?'':'s'} ($${r.score.bigChips.toFixed(2)}) ${r.wonBy==='self'?'from each player (self-draw, doubled)':'each ('+seatName(room,r.discarderSeat)+' pays double)'}.</p>
    `;
  }
  return `<div class="modal-bg"><div class="modal">
    <h2>🀄 Hand ${room.handNumber} result</h2>
    ${body}
    <h3 style="color:var(--gold);margin-top:16px;">Scoreboard</h3>
    ${renderScoreTable(room)}
    <div class="btn-row" style="margin-top:14px;">
      <button class="btn" data-action="nextHand" type="button">Next hand ▶</button>
      ${isHost?`<button class="btn secondary" data-action="endMatch" type="button">End match</button>`:''}
    </div>
  </div></div>`;
}
function renderMatchEndModal(room){
  const isHost = room.hostId===PROFILE.id;
  const ranked = room.seats.map((s,i)=>({name:s?s.name:'—',chips:room.chips[i]})).sort((a,b)=>b.chips-a.chips);
  return `<div class="modal-bg"><div class="modal">
    <h2>🏮 Final settle-up</h2>
    <table class="score-table"><thead><tr><th>#</th><th>Player</th><th>Chips</th></tr></thead><tbody>
      ${ranked.map((r,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(r.name)}</td><td class="${moneyClass(r.chips)}">${fmtMoney(r.chips)}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted" style="margin-top:10px;">Salamat for playing! Maligayang chismis sa susunod na laro.</p>
    <div class="btn-row" style="margin-top:14px;">
      ${isHost?`<button class="btn" data-action="backToLobby" type="button">Back to lobby</button>`:`<p class="muted">Waiting for the host…</p>`}
    </div>
  </div></div>`;
}

function renderLogPanel(room){
  const entries = room.log.slice().reverse();
  return `<div class="modal-bg"><div class="modal">
    <button class="close-x" data-action="toggleLog" type="button">×</button>
    <h2>📜 Table activity</h2>
    <div class="howto-body">
      ${entries.length ? `<ul class="log-list">${entries.map(l=>`<li>${escapeHtml(l)}</li>`).join('')}</ul>` : `<p class="muted">Nothing's happened yet.</p>`}
    </div>
  </div></div>`;
}

function renderHowTo(){
  return `<div class="modal-bg"><div class="modal">
    <button class="close-x" data-action="toggleHowTo" type="button">×</button>
    <h2>🀄 How Snows Mahjong Corner works</h2>
    <div class="howto-body">
      <p>Authentic 16-tile Filipino mahjong for four players (fill empty seats with bots if your barkada is short tonight).</p>
      <h3>The deal</h3>
      <p>Everyone gets 16 tiles. The dealer draws a 17th and discards first. Play moves to the right (counter-clockwise).</p>
      <h3>Flowers</h3>
      <p>Winds, dragons, and the traditional flower/season tiles are all "flowers" here — bonus tiles, never used in melds. Draw one and it's immediately set aside in your flower corner, then you draw a replacement from the back of the wall. Collect 13 flowers in one hand and you get a small chip from each opponent on the spot. Win a hand with zero flowers drawn and you get a bonus too.</p>
      <h3>Your turn</h3>
      <p>Draw a tile (flowers auto-resolve), then discard one. Mahjong claims always beat pung/kong, which beat chow. Pung and kong can be claimed off anyone's discard; chow only off the discard of the player to your right.</p>
      <h3>Winning</h3>
      <p>A full hand is 5 sets (pung, kong, or chow) plus one pair — 17 tiles. Seven pairs plus one triple is also a valid win.</p>
      <h3>Chips — the in-game money</h3>
      <p>Small silver chips are worth 50¢, big gold chips are worth $1. A Kong of any kind — secret, sagasa (drawing your own 4th tile), or claimed off a discard — pays one small chip from each opponent, immediately. Winning a hand pays big chips: a normal win is 1 big chip from each opponent, with bonus doubles stacking for Seven Pairs + Triple, an all-pungs hand, a one-suit flush, kongs in hand, and a flowerless hand. Self-drawn wins are paid double by everyone; discard wins are paid double by whoever discarded the tile, normal by the rest.</p>
      <p class="muted" style="margin-top:14px;">House note: this is a friend-table ruleset, and the game state isn't encrypted — please only share your room code with people you trust at the table.</p>
    </div>
  </div></div>`;
}
function renderGame(room){
  const mySeat = mySeatIndex(room);
  const dock = renderPlayDock(room, mySeat);

  let overlay = '';
  if(room.phase==='handEnd') overlay = renderHandEndModal(room);
  if(room.phase==='matchEnd') overlay = renderMatchEndModal(room);
  if(STATE.showLog) overlay += renderLogPanel(room);

  return `
  <div class="screen" style="padding-bottom:0;">
    <div class="title-row">
      <span class="pill">🏮 ${room.code}</span>
      <span class="muted">Hand ${room.handNumber}</span>
      ${mySeat>=0?`<span class="pill ${moneyClass(room.chips[mySeat])}" style="background:rgba(0,0,0,0.28);">${fmtMoney(room.chips[mySeat])}</span>`:''}
      <button class="icon-btn" data-action="toggleLog" title="Activity log" type="button">📜</button>
      <button class="icon-btn" data-action="toggleHowTo" title="How to play" type="button">❓</button>
    </div>
    ${renderChipToasts()}
    ${renderOpponentsRow(room, mySeat)}
    <div class="table-wrap">
      ${renderFelt(room)}
    </div>
    <div class="tile-info-bar" id="tile-info-bar">
      <span class="ti-name">Tap or hover any tile</span>
      <span class="ti-blurb">to see what it is — great for first-timers.</span>
    </div>
  </div>
  ${dock}
  ${overlay}`;
}
