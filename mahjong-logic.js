/* =====================================================================
   SNOWS MAHJONG CORNER — authentic 16-tile Filipino mahjong.
   mahjong-logic.js — pure game rules: tiles, deck, win/meld detection,
   claim eligibility, and scoring. No DOM, no storage, no room state.
   ===================================================================== */
const SUITS = ['C','B','D'];
const WINDS = ['WE','WS','WW','WN'];
const DRAGONS = ['DR','DG','DW'];
const FLOWERS = ['F1','F2','F3','F4','F5','F6','F7','F8'];
const WIND_NAME = {WE:'East',WS:'South',WW:'West',WN:'North'};
const DRAGON_NAME = {DR:'Red Dragon',DG:'Green Dragon',DW:'White Dragon'};
const SUIT_NAME = {C:'Character',B:'Sticks',D:'Balls'};
const FLOWER_NAME = {F1:'Plum',F2:'Orchid',F3:'Chrysanthemum',F4:'Bamboo',F5:'Spring',F6:'Summer',F7:'Autumn',F8:'Winter'};

const GLYPH = {
  C1:'\u{1F007}',C2:'\u{1F008}',C3:'\u{1F009}',C4:'\u{1F00A}',C5:'\u{1F00B}',
  C6:'\u{1F00C}',C7:'\u{1F00D}',C8:'\u{1F00E}',C9:'\u{1F00F}',
  B1:'\u{1F010}',B2:'\u{1F011}',B3:'\u{1F012}',B4:'\u{1F013}',B5:'\u{1F014}',
  B6:'\u{1F015}',B7:'\u{1F016}',B8:'\u{1F017}',B9:'\u{1F018}',
  D1:'\u{1F019}',D2:'\u{1F01A}',D3:'\u{1F01B}',D4:'\u{1F01C}',D5:'\u{1F01D}',
  D6:'\u{1F01E}',D7:'\u{1F01F}',D8:'\u{1F020}',D9:'\u{1F021}',
  WE:'\u{1F000}',WS:'\u{1F001}',WW:'\u{1F002}',WN:'\u{1F003}',
  DR:'\u{1F004}',DG:'\u{1F005}',DW:'\u{1F006}',
  F1:'🌸',F2:'🌷',F3:'🌼',F4:'🎍',F5:'🌱',F6:'☀️',F7:'🍁',F8:'❄️',
};

function buildDeck(){
  const deck=[];
  for(const s of SUITS) for(let r=1;r<=9;r++) for(let c=0;c<4;c++) deck.push(s+r);
  for(const w of WINDS) for(let c=0;c<4;c++) deck.push(w);
  for(const d of DRAGONS) for(let c=0;c<4;c++) deck.push(d);
  for(const f of FLOWERS) deck.push(f);
  return deck; // 108 + 16 + 12 + 8 = 144
}
function shuffle(arr){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}
  return a;
}
function isFlowerCategory(t){ return WINDS.includes(t)||DRAGONS.includes(t)||FLOWERS.includes(t); }
function isSuited(t){ return !isFlowerCategory(t); }
function suitOf(t){ return isSuited(t)?t[0]:null; }
function rankOf(t){ return isSuited(t)?parseInt(t.slice(1),10):null; }
function countTiles(tiles){ const m={}; for(const t of tiles) m[t]=(m[t]||0)+1; return m; }

function tileLabel(t){
  if(WINDS.includes(t)) return WIND_NAME[t]+' Wind';
  if(DRAGONS.includes(t)) return DRAGON_NAME[t];
  if(FLOWERS.includes(t)) return FLOWER_NAME[t];
  return SUIT_NAME[suitOf(t)]+' '+rankOf(t);
}
function tileBlurb(t){
  if(WINDS.includes(t)||DRAGONS.includes(t)) return 'Flower tile (honor) — collected for bonus chips, never used in melds.';
  if(FLOWERS.includes(t)) return 'Flower tile — collected for bonus chips, never used in melds.';
  return SUIT_NAME[suitOf(t)]+' suit, number '+rankOf(t)+' — can form runs (chows) with neighboring numbers in the same suit.';
}
function sortHand(tiles){
  const order=t=>{
    if(WINDS.includes(t))return [7,WINDS.indexOf(t)];
    if(DRAGONS.includes(t))return [8,DRAGONS.indexOf(t)];
    if(FLOWERS.includes(t))return [9,FLOWERS.indexOf(t)];
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
function isWinningShape(concealedTiles,exposedMeldCount,jokerTile){
  const meldsNeeded=5-exposedMeldCount;
  const tiles=concealedTiles.slice();
  const isWild = t=>t===jokerTile;
  const jokerCount=tiles.filter(isWild).length;
  const nonWild=tiles.filter(t=>!isWild(t));
  const counts=countTiles(nonWild);
  if(exposedMeldCount===0 && jokerCount===0 && tiles.length===17){
    const c=countTiles(tiles);
    const entries=Object.entries(c);
    const pairs=entries.filter(([,v])=>v===2);
    const triples=entries.filter(([,v])=>v===3);
    if(pairs.length===7 && triples.length===1) return {ok:true,special:'sevenPairsTriple'};
  }
  const candidates=Object.keys(counts).filter(k=>counts[k]>=2);
  for(const p of candidates){
    counts[p]-=2;
    if(canExtractMelds(counts,jokerCount,meldsNeeded)){counts[p]+=2;return {ok:true,special:null};}
    counts[p]+=2;
  }
  return {ok:false};
}
function isAllPungsHand(concealedTiles,exposedMelds,jokerTile){
  if(exposedMelds.some(m=>m.type==='chow')) return false;
  const meldsNeeded=5-exposedMelds.length;
  const tiles=concealedTiles.slice();
  const isWild = t=>t===jokerTile;
  const jokerCount=tiles.filter(isWild).length;
  const counts=countTiles(tiles.filter(t=>!isWild(t)));
  const candidates=Object.keys(counts).filter(k=>counts[k]>=2);
  for(const p of candidates){
    counts[p]-=2;
    const ok=canExtractPungsOnly(counts,jokerCount,meldsNeeded);
    counts[p]+=2;
    if(ok) return true;
  }
  return false;
}
function isAllOneSuitHand(concealedTiles,exposedMelds,jokerTile){
  const all=concealedTiles.concat(...exposedMelds.map(m=>m.tiles));
  const real=all.filter(t=>t!==jokerTile);
  if(real.some(t=>!isSuited(t))) return false;
  const suits=new Set(real.map(suitOf));
  return suits.size===1;
}

function wildCountIn(tiles, jokerTile){ return tiles.filter(t=>t===jokerTile).length; }
function eligiblePong(hand, tile, jokerTile){
  if(tile===jokerTile) return false;
  const nonJ=hand.filter(t=>t===tile).length;
  const jk=wildCountIn(hand,jokerTile);
  const need=2-nonJ;
  return need>=0 && need<=jk;
}
function eligibleKong(hand, tile, jokerTile){
  if(tile===jokerTile) return false;
  const nonJ=hand.filter(t=>t===tile).length;
  const jk=wildCountIn(hand,jokerTile);
  const need=3-nonJ;
  return need>=0 && need<=jk;
}
function eligibleChowRuns(hand, tile, jokerTile){
  if(!isSuited(tile)) return [];
  const s=suitOf(tile), r=rankOf(tile);
  const shapes=[];
  if(r>=3) shapes.push([s+(r-2), s+(r-1)]);
  if(r>=2 && r<=8) shapes.push([s+(r-1), s+(r+1)]);
  if(r<=7) shapes.push([s+(r+1), s+(r+2)]);
  const jk=wildCountIn(hand,jokerTile);
  const counts=countTiles(hand);
  const usable=[];
  for(const pair of shapes){
    let need=0;
    for(const needT of pair){ if((counts[needT]||0)<1) need++; }
    if(need<=jk) usable.push(pair);
  }
  return usable;
}
