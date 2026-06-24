/* =====================================================================
   SNOWS MAHJONG CORNER — Filipino-style mahjong, playable online with friends.
   mahjong-logic.js — pure game rules: tiles, deck, win/meld detection,
   claim eligibility, and scoring. No DOM, no storage, no room state.
   ===================================================================== */

/* ---------------- core tile / deck logic ---------------- */
const SUITS = ['C','B','D'];
const WINDS = ['WE','WS','WW','WN'];
const DRAGONS = ['DR','DG','DW'];
const WIND_NAME = {WE:'East',WS:'South',WW:'West',WN:'North'};
const DRAGON_NAME = {DR:'Red Dragon',DG:'Green Dragon',DW:'White Dragon'};
const SUIT_NAME = {C:'Character',B:'Sticks',D:'Balls'};

const GLYPH = {
  C1:'\u{1F007}',C2:'\u{1F008}',C3:'\u{1F009}',C4:'\u{1F00A}',C5:'\u{1F00B}',
  C6:'\u{1F00C}',C7:'\u{1F00D}',C8:'\u{1F00E}',C9:'\u{1F00F}',
  B1:'\u{1F010}',B2:'\u{1F011}',B3:'\u{1F012}',B4:'\u{1F013}',B5:'\u{1F014}',
  B6:'\u{1F015}',B7:'\u{1F016}',B8:'\u{1F017}',B9:'\u{1F018}',
  D1:'\u{1F019}',D2:'\u{1F01A}',D3:'\u{1F01B}',D4:'\u{1F01C}',D5:'\u{1F01D}',
  D6:'\u{1F01E}',D7:'\u{1F01F}',D8:'\u{1F020}',D9:'\u{1F021}',
  WE:'\u{1F000}',WS:'\u{1F001}',WW:'\u{1F002}',WN:'\u{1F003}',
  DR:'\u{1F004}',DG:'\u{1F005}',DW:'\u{1F006}',
  JK:'\u{1F0CF}'
};

function buildDeck(){
  const deck=[];
  for(const s of SUITS) for(let r=1;r<=9;r++) for(let c=0;c<4;c++) deck.push(s+r);
  for(const w of WINDS) for(let c=0;c<4;c++) deck.push(w);
  for(const d of DRAGONS) for(let c=0;c<4;c++) deck.push(d);
  for(let c=0;c<8;c++) deck.push('JK');
  return deck;
}
function shuffle(arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function isJoker(t){return t==='JK';}
function isHonor(t){return WINDS.includes(t)||DRAGONS.includes(t);}
function isSuited(t){return !isJoker(t)&&!isHonor(t);}
function suitOf(t){return isSuited(t)?t[0]:null;}
function rankOf(t){return isSuited(t)?parseInt(t.slice(1),10):null;}
function countTiles(tiles){const m={};for(const t of tiles)m[t]=(m[t]||0)+1;return m;}
function tileLabel(t){
  if(isJoker(t)) return 'Joker';
  if(WINDS.includes(t)) return WIND_NAME[t]+' Wind';
  if(DRAGONS.includes(t)) return DRAGON_NAME[t];
  return SUIT_NAME[suitOf(t)]+' '+rankOf(t);
}
function tileBlurb(t){
  if(isJoker(t)) return 'Wild — stands in for any tile in a pung, kong, or chow (never in the pair).';
  if(WINDS.includes(t)) return 'Flower tile (honor) — works in pungs and kongs, not in runs (chows).';
  if(DRAGONS.includes(t)) return 'Flower tile (honor) — works in pungs and kongs, not in runs (chows).';
  return SUIT_NAME[suitOf(t)]+' suit, number '+rankOf(t)+' — can form runs (chows) with neighboring numbers in the same suit.';
}
function sortHand(tiles){
  const order=t=>{
    if(isJoker(t))return [9,0];
    if(WINDS.includes(t))return [7,WINDS.indexOf(t)];
    if(DRAGONS.includes(t))return [8,DRAGONS.indexOf(t)];
    return [SUITS.indexOf(suitOf(t)),rankOf(t)];
  };
  return tiles.slice().sort((a,b)=>{
    const [oa,ra]=order(a),[ob,rb]=order(b);
    return oa!==ob?oa-ob:ra-rb;
  });
}

function canExtractMelds(counts,jokers,meldsNeeded){
  if(meldsNeeded===0) return jokers===0 && Object.values(counts).every(c=>c===0);
  const keys=Object.keys(counts).filter(k=>counts[k]>0).sort();
  if(keys.length===0) return false;
  const t=keys[0], have=counts[t];
  for(let use=Math.min(have,3);use>=1;use--){
    const need=3-use;
    if(need<=jokers){
      counts[t]-=use;
      const ok=canExtractMelds(counts,jokers-need,meldsNeeded-1);
      counts[t]+=use;
      if(ok) return true;
    }
    if(use<3) break;
  }
  if(isSuited(t)){
    const s=suitOf(t), r=rankOf(t);
    if(r<=7){
      const t2=s+(r+1), t3=s+(r+2);
      const have2=counts[t2]||0, have3=counts[t3]||0;
      let needJ=0;
      if(have2<1) needJ+=1; if(have3<1) needJ+=1;
      if(needJ<=jokers){
        counts[t]-=1;
        counts[t2]=(counts[t2]||0)-Math.min(1,have2);
        counts[t3]=(counts[t3]||0)-Math.min(1,have3);
        const ok=canExtractMelds(counts,jokers-needJ,meldsNeeded-1);
        counts[t]+=1;
        counts[t2]+=Math.min(1,have2);
        counts[t3]+=Math.min(1,have3);
        if(ok) return true;
      }
    }
  }
  return false;
}
function canExtractPungsOnly(counts,jokers,meldsNeeded){
  if(meldsNeeded===0) return jokers===0 && Object.values(counts).every(c=>c===0);
  const keys=Object.keys(counts).filter(k=>counts[k]>0).sort();
  if(keys.length===0) return false;
  const t=keys[0], have=counts[t], use=Math.min(have,3), need=3-use;
  if(need<=jokers){
    counts[t]-=use;
    const ok=canExtractPungsOnly(counts,jokers-need,meldsNeeded-1);
    counts[t]+=use;
    if(ok) return true;
  }
  return false;
}
function isWinningShape(concealedTiles,exposedMeldCount){
  const meldsNeeded=4-exposedMeldCount;
  const tiles=concealedTiles.slice();
  const jokerCount=tiles.filter(isJoker).length;
  const nonJokers=tiles.filter(t=>!isJoker(t));
  const counts=countTiles(nonJokers);
  if(exposedMeldCount===0 && jokerCount===0 && tiles.length===14){
    const c=countTiles(tiles); const vals=Object.values(c);
    if(vals.length===7 && vals.every(v=>v===2)) return {ok:true,special:'sevenPairs'};
  }
  const candidates=Object.keys(counts).filter(k=>counts[k]>=2);
  for(const p of candidates){
    counts[p]-=2;
    if(canExtractMelds(counts,jokerCount,meldsNeeded)){counts[p]+=2;return {ok:true,special:null};}
    counts[p]+=2;
  }
  return {ok:false};
}
function isAllPungsHand(concealedTiles,exposedMelds){
  if(exposedMelds.some(m=>m.type==='chow')) return false;
  const meldsNeeded=4-exposedMelds.length;
  const tiles=concealedTiles.slice();
  const jokerCount=tiles.filter(isJoker).length;
  const counts=countTiles(tiles.filter(t=>!isJoker(t)));
  const candidates=Object.keys(counts).filter(k=>counts[k]>=2);
  for(const p of candidates){
    counts[p]-=2;
    const ok=canExtractPungsOnly(counts,jokerCount,meldsNeeded);
    counts[p]+=2;
    if(ok) return true;
  }
  return false;
}
function isAllOneSuitHand(concealedTiles,exposedMelds){
  const all=concealedTiles.concat(...exposedMelds.map(m=>m.tiles));
  const real=all.filter(t=>!isJoker(t));
  if(real.some(isHonor)) return false;
  const suits=new Set(real.map(suitOf));
  return suits.size===1;
}
/* ---------------- claim eligibility ---------------- */
function jokerCountIn(tiles){ return tiles.filter(isJoker).length; }

function eligiblePong(hand, tile){
  const nonJ = hand.filter(t=>t===tile).length;
  const jk = jokerCountIn(hand);
  const need = 2 - nonJ;
  return need>=0 && need<=jk;
}
function eligibleKong(hand, tile){
  const nonJ = hand.filter(t=>t===tile).length;
  const jk = jokerCountIn(hand);
  const need = 3 - nonJ;
  return need>=0 && need<=jk;
}
function eligibleChowRuns(hand, tile){
  // returns array of the up-to-3 possible run shapes (as the two OTHER tiles needed),
  // each entry: {need:[tileId,tileId]} where a tileId might be satisfied by a joker
  if(!isSuited(tile)) return [];
  const s=suitOf(tile), r=rankOf(tile);
  const shapes=[];
  if(r>=3) shapes.push([s+(r-2), s+(r-1)]);          // tile is the highest of the run
  if(r>=2 && r<=8) shapes.push([s+(r-1), s+(r+1)]);   // tile is the middle
  if(r<=7) shapes.push([s+(r+1), s+(r+2)]);           // tile is the lowest
  const jk = jokerCountIn(hand);
  const counts = countTiles(hand);
  const usable=[];
  for(const pair of shapes){
    let need=0;
    for(const need_t of pair){ if((counts[need_t]||0)<1) need++; }
    if(need<=jk) usable.push(pair);
  }
  return usable;
}
function computeEligibleClaims(room, discardSeat, tile){
  const out = {}; // seat -> array of claim types available
  for(let seat=0; seat<4; seat++){
    if(seat===discardSeat) continue;
    if(!room.seats[seat]) continue;
    const hand = room.hands[seat];
    const types = [];
    const winCheck = isWinningShape(hand.concat([tile]), room.melds[seat].length);
    if(winCheck.ok) types.push('win');
    if(eligibleKong(hand, tile)) types.push('kong');
    if(eligiblePong(hand, tile)) types.push('pong');
    if(seat === (discardSeat+1)%4 && eligibleChowRuns(hand, tile).length>0) types.push('chow');
    if(types.length) out[seat]=types;
  }
  return out;
}

/* ---------------- scoring ---------------- */
// Returns {base, doubles, labels:[...], totalEach:{}} style breakdown for a finished hand.
function scoreHand(room, winnerSeat, winTile, wonBy /* 'self'|'discard' */, discarderSeat){
  const hand = room.hands[winnerSeat];
  const melds = room.melds[winnerSeat];
  const allTiles = hand.concat(winTile?[winTile]:[]);
  const shape = isWinningShape(allTiles, melds.length);
  let doubles = 0;
  const labels = [];
  if(shape.special==='sevenPairs'){ doubles += 2; labels.push('Seven Pairs'); }
  if(isAllPungsHand(allTiles, melds)){ doubles += 1; labels.push('All Pungs/Kongs'); }
  if(isAllOneSuitHand(allTiles, melds)){ doubles += 1; labels.push('One Suit Flush'); }
  if(melds.some(m=>m.type==='kong')){ doubles += melds.filter(m=>m.type==='kong').length; labels.push('Kong Bonus'); }
  if(wonBy==='self'){ doubles += 1; labels.push('Self-Drawn'); }
  const base = 1;
  const bigChips = base * Math.pow(2, doubles);
  return { base, doubles, labels, bigChips };
}
