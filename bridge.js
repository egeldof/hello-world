/*  Bridge Card Game — Dutch UI
    Players: South = Human, North/East/West = Computer AI
    Special rule: Declarer also controls Dummy's hand.
*/

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const SUITS  = ['♠','♥','♦','♣'];   // spades hearts diamonds clubs
const SUIT_NAMES = { '♠':'Schoppen','♥':'Harten','♦':'Ruiten','♣':'Klaveren' };
const RANKS  = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VAL = {};
RANKS.forEach((r,i) => RANK_VAL[r] = i); // 2=0 … A=12

const PLAYERS     = ['north','east','south','west'];
const PLAYER_NL   = { north:'Noord', east:'Oost', south:'Zuid', west:'West' };
const DIRECTIONS  = { north:'N', east:'O', south:'Z', west:'W' };
const HUMAN       = 'south';

const BID_SUITS   = ['♣','♦','♥','♠','NT']; // ascending order in bridge
const BID_SUIT_CLASS = { '♣':'clubs','♦':'diamonds','♥':'hearts','♠':'spades','NT':'notrump' };
const BID_SUIT_NL    = { '♣':'Kl','♦':'Ru','♥':'Ha','♠':'Sc','NT':'NT' };

// Vulnerability rotation per deal number (mod 16)
const VULN_TABLE = [
  'none','ns','ew','both','ns','ew','both','none',
  'ew','both','none','ns','both','none','ns','ew'
];

// ─── GAME STATE ──────────────────────────────────────────────────────────────
const G = {
  phase: 'idle',     // idle | bidding | playing | done
  dealNum: 0,
  dealer: 'north',
  vulnerability: 'none',

  hands: { north:[], east:[], south:[], west:[] },
  original: { north:[], east:[], south:[], west:[] },

  // Bidding
  bids: [],          // [{player, bid}]  bid = '1♠' | 'pass' | 'X' | 'XX'
  contract: null,    // {level, suit, declarer, doubled, redoubled}
  consecutivePasses: 0,

  // Playing
  declarer: null,
  dummy: null,
  lead: null,        // player who leads next trick
  currentTrick: [],  // [{player, card}]
  tricks: { ns:0, ow:0 },
  trickHistory: [],

  // UI state
  waitingForHuman: false,
  humanAsDouble: false,  // south plays for north (dummy) too?
  humanAsDeclarer: false,

  // Scores across hands
  scores: { ns:0, ow:0 },
};

// ─── UTILITIES ───────────────────────────────────────────────────────────────
function suitColor(suit) {
  return (suit === '♥' || suit === '♦') ? 'red' : '';
}

function rankSuit(cardStr) {
  // '10♥' → {rank:'10', suit:'♥'}
  const suit = cardStr.slice(-1);
  const rank = cardStr.slice(0, -1);
  return { rank, suit };
}

function cardValue(card, trumpSuit, leadSuit) {
  const { rank, suit } = rankSuit(card);
  if (suit === trumpSuit) return 200 + RANK_VAL[rank];
  if (suit === leadSuit)  return 100 + RANK_VAL[rank];
  return RANK_VAL[rank];
}

function partnership(player) {
  return (player === 'north' || player === 'south') ? 'ns' : 'ow';
}

function opponent(player) {
  return (player === 'north' || player === 'south') ? 'ow' : 'ns';
}

function partnerOf(player) {
  return { north:'south', south:'north', east:'west', west:'east' }[player];
}

function leftOf(player) {
  const idx = PLAYERS.indexOf(player);
  return PLAYERS[(idx + 1) % 4];
}

function bidToNum(bid) {
  // '1♣'=0, '1♦'=1 ... '7NT'=34
  const level = parseInt(bid[0]) - 1;
  const suitStr = bid.slice(1);
  const suitIdx = BID_SUITS.indexOf(suitStr);
  return level * 5 + suitIdx;
}

function numToBid(n) {
  const level = Math.floor(n / 5) + 1;
  const suit  = BID_SUITS[n % 5];
  return level + suit;
}

function highestContractBid() {
  for (let i = G.bids.length - 1; i >= 0; i--) {
    const b = G.bids[i].bid;
    if (b !== 'pass' && b !== 'X' && b !== 'XX') return b;
  }
  return null;
}

function lastRealBidBy(side) {
  // side = 'ns' or 'ow'
  for (let i = G.bids.length - 1; i >= 0; i--) {
    const { player, bid } = G.bids[i];
    if (bid !== 'pass' && bid !== 'X' && bid !== 'XX') {
      if (partnership(player) === side) return { player, bid };
    }
  }
  return null;
}

function contractDoubled() {
  // look at bids after last real bid
  const lastBidIdx = G.bids.reduce((acc, b, i) => {
    if (b.bid !== 'pass' && b.bid !== 'X' && b.bid !== 'XX') return i;
    return acc;
  }, -1);
  let doubled = false, redoubled = false;
  for (let i = lastBidIdx + 1; i < G.bids.length; i++) {
    if (G.bids[i].bid === 'X')  { doubled = true; redoubled = false; }
    if (G.bids[i].bid === 'XX') { redoubled = true; }
  }
  return { doubled, redoubled };
}

function bidIsLegal(bid, currentPlayer) {
  if (bid === 'pass') return true;

  if (bid === 'X') {
    const hcb = highestContractBid();
    if (!hcb) return false;
    // Find who made it
    for (let i = G.bids.length - 1; i >= 0; i--) {
      const b = G.bids[i];
      if (b.bid === hcb) {
        // opponents of that player can double
        return partnership(b.player) !== partnership(currentPlayer);
      }
    }
    return false;
  }

  if (bid === 'XX') {
    // Check if doubled
    const { doubled, redoubled } = contractDoubled();
    if (!doubled || redoubled) return false;
    const hcb = highestContractBid();
    for (let i = G.bids.length - 1; i >= 0; i--) {
      const b = G.bids[i];
      if (b.bid === hcb) {
        // declarer side can redouble
        return partnership(b.player) === partnership(currentPlayer);
      }
    }
    return false;
  }

  // Normal bid: must be higher than current highest
  const hcb = highestContractBid();
  if (!hcb) return true;
  return bidToNum(bid) > bidToNum(hcb);
}

// ─── DECK & DEALING ──────────────────────────────────────────────────────────
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push(rank + suit);
    }
  }
  return deck;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealCards() {
  const deck = shuffle(createDeck());
  PLAYERS.forEach((p, i) => {
    G.hands[p] = deck.slice(i * 13, (i + 1) * 13);
    // sort: by suit order then rank
    G.hands[p].sort((a, b) => {
      const sa = rankSuit(a), sb = rankSuit(b);
      const si = SUITS.indexOf(sa.suit), sj = SUITS.indexOf(sb.suit);
      if (si !== sj) return si - sj;
      return RANK_VAL[sb.rank] - RANK_VAL[sa.rank]; // high to low within suit
    });
    G.original[p] = [...G.hands[p]];
  });
}

// ─── RENDERING ───────────────────────────────────────────────────────────────
function makeCardEl(cardStr, clickable, clickHandler) {
  const el = document.createElement('div');
  el.classList.add('card');
  const { rank, suit } = rankSuit(cardStr);
  const isRed = suitColor(suit);
  if (isRed) el.classList.add('red');

  el.innerHTML = `
    <div class="card-top"><span class="card-rank">${rank}</span><span class="card-suit">${suit}</span></div>
    <div class="card-center">${suit}</div>
    <div class="card-bottom"><span class="card-rank">${rank}</span><span class="card-suit">${suit}</span></div>
  `;
  el.dataset.card = cardStr;

  if (clickable) {
    el.classList.add('playable');
    el.addEventListener('click', () => clickHandler(cardStr));
  }
  return el;
}

function makeBackCard() {
  const el = document.createElement('div');
  el.classList.add('card', 'back');
  return el;
}

function renderHands() {
  PLAYERS.forEach(p => {
    const container = document.getElementById(`hand-${p}`);
    container.innerHTML = '';

    const isDummy = G.dummy === p;
    const isPlaying = G.phase === 'playing';

    // Show dummy face up
    const showFaceUp = (p === HUMAN) || isDummy ||
      (G.phase === 'done');

    // Determine if this hand can be clicked
    // Human plays south, OR if south is declarer and north is dummy, human clicks north cards too
    const canClick = isPlaying && G.waitingForHuman && G.currentTrick.length < 4 &&
      (p === HUMAN || (G.humanAsDouble && p === G.dummy));

    if (showFaceUp) {
      const playable = canClick ? getLegalCards(p) : [];
      G.hands[p].forEach(card => {
        const isLegal = playable.includes(card);
        const el = makeCardEl(card, isLegal, (c) => humanPlayCard(p, c));
        if (canClick && !isLegal) el.style.opacity = '0.5';
        container.appendChild(el);
      });
    } else {
      // Show backs
      G.hands[p].forEach(() => container.appendChild(makeBackCard()));
    }
  });

  // Dummy labels
  ['north','south','east','west'].forEach(p => {
    const note = document.getElementById(`dummy-note-${p}`);
    if (note) {
      if (G.dummy === p && G.phase === 'playing') {
        note.classList.remove('hidden');
      } else {
        note.classList.add('hidden');
      }
    }
  });

  updatePlayerLabels();
}

function updatePlayerLabels() {
  PLAYERS.forEach(p => {
    const el = document.getElementById(`label-${p}`);
    const pNl = PLAYER_NL[p];
    let label = pNl;
    if (p === HUMAN) label += ' (U)';
    el.textContent = label;
    el.className = 'player-label';

    if (G.phase === 'bidding') {
      if (G.bids.length > 0) {
        const nextBidder = getCurrentBidder();
        if (p === nextBidder) el.classList.add('active');
      } else {
        if (p === G.dealer) el.classList.add('active');
      }
    }
    if (G.phase === 'playing') {
      if (G.declarer === p) el.classList.add('declarer');
      if (G.dummy === p) el.classList.add('dummy-label');
    }
  });
}

function renderTrick() {
  PLAYERS.forEach(p => {
    const slot = document.getElementById(`trick-${p}`);
    slot.innerHTML = '';
    const entry = G.currentTrick.find(e => e.player === p);
    if (entry) {
      slot.appendChild(makeCardEl(entry.card, false, null));
    }
  });
}

function renderBidHistory() {
  const tbody = document.getElementById('bid-history-body');
  tbody.innerHTML = '';

  // Columns in order: North, East, South, West
  const colOrder = ['north','east','south','west'];

  // Find dealer position in column order
  const dealerColIdx = colOrder.indexOf(G.dealer);

  const rows = [];
  let row = new Array(4).fill('');

  // Fill starting from dealer
  G.bids.forEach((b, i) => {
    const colIdx = (dealerColIdx + i) % 4;
    const bidStr = formatBid(b.bid);
    row[colIdx] = bidStr;
    if (colIdx === 3 || i === G.bids.length - 1) {
      rows.push([...row]);
      row = new Array(4).fill('');
    }
  });

  rows.forEach(r => {
    const tr = document.createElement('tr');
    r.forEach(cell => {
      const td = document.createElement('td');
      td.innerHTML = cell;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function formatBid(bid) {
  if (bid === 'pass') return '<span style="color:#aaa">Pas</span>';
  if (bid === 'X')    return '<span style="color:#f88">X</span>';
  if (bid === 'XX')   return '<span style="color:#c8f">XX</span>';
  // e.g. '3♥'
  const level = bid[0];
  const suitStr = bid.slice(1);
  const cls = BID_SUIT_CLASS[suitStr] || '';
  const suit = suitStr === 'NT' ? 'NT' : suitStr;
  return `<span>${level}<span class="${cls}" style="font-weight:bold">${suit}</span></span>`;
}

function buildBidGrid() {
  const grid = document.getElementById('bid-grid');
  grid.innerHTML = '';

  // Header row: suits
  const headerLabels = ['Niv', '♣', '♦', '♥', '♠', 'NT', '', ''];
  headerLabels.forEach(h => {
    const th = document.createElement('div');
    th.style.cssText = 'text-align:center;font-size:0.7em;color:#ffe;padding:2px;';
    th.innerHTML = h;
    grid.appendChild(th);
  });

  for (let level = 1; level <= 7; level++) {
    // level label
    const lbl = document.createElement('div');
    lbl.style.cssText = 'text-align:center;font-weight:bold;padding:4px;color:#ffe;';
    lbl.textContent = level;
    grid.appendChild(lbl);

    BID_SUITS.forEach(suit => {
      const bid = level + suit;
      const btn = document.createElement('button');
      btn.classList.add('bid-btn', BID_SUIT_CLASS[suit]);
      btn.textContent = BID_SUIT_NL[suit];
      btn.dataset.bid = bid;
      btn.addEventListener('click', () => humanBid(bid));
      grid.appendChild(btn);
    });

    // Filler cells to complete the 8-column row (we only have 6 cols of content)
    for (let f = 0; f < 2; f++) {
      grid.appendChild(document.createElement('div'));
    }
  }
}

function updateBidButtons() {
  const currentPlayer = getCurrentBidder();
  const isHumanTurn = currentPlayer === HUMAN && G.phase === 'bidding';

  document.querySelectorAll('.bid-btn').forEach(btn => {
    const bid = btn.dataset.bid;
    const legal = bidIsLegal(bid, HUMAN);
    btn.disabled = !isHumanTurn || !legal;
  });

  document.getElementById('btn-pass').disabled = !isHumanTurn;
  document.getElementById('btn-double').disabled = !isHumanTurn || !bidIsLegal('X', HUMAN);
  document.getElementById('btn-redouble').disabled = !isHumanTurn || !bidIsLegal('XX', HUMAN);
}

function setMessage(msg) {
  document.getElementById('message-box').innerHTML = msg;
}

function updateInfoBar() {
  const dealerNl = PLAYER_NL[G.dealer];
  document.getElementById('info-dealer').textContent = dealerNl;

  let vulnText = '';
  if (G.vulnerability === 'none')  vulnText = '<span class="vuln-badge nvul">Geen</span>';
  else if (G.vulnerability === 'ns') vulnText = '<span class="vuln-badge vul">NS</span>';
  else if (G.vulnerability === 'ew') vulnText = '<span class="vuln-badge vul">OW</span>';
  else vulnText = '<span class="vuln-badge vul">Beide</span>';
  document.getElementById('info-vuln').innerHTML = vulnText;

  if (G.contract) {
    const c = G.contract;
    let s = c.level + c.suit;
    if (c.redoubled) s += ' XX';
    else if (c.doubled) s += ' X';
    s += ' door ' + PLAYER_NL[c.declarer];
    document.getElementById('info-contract').textContent = s;
  } else {
    document.getElementById('info-contract').textContent = '-';
  }

  document.getElementById('info-tricks-ns').textContent = G.tricks.ns;
  document.getElementById('info-tricks-ow').textContent = G.tricks.ow;
  document.getElementById('info-score').textContent =
    `NS ${G.scores.ns} | OW ${G.scores.ow}`;
}

// ─── BIDDING PHASE ───────────────────────────────────────────────────────────
function getCurrentBidder() {
  const dealerIdx = PLAYERS.indexOf(G.dealer);
  return PLAYERS[(dealerIdx + G.bids.length) % 4];
}

function startBidding() {
  G.phase = 'bidding';
  G.bids = [];
  G.contract = null;
  buildBidGrid();
  renderBidHistory();
  updateBidButtons();
  setMessage(`Bieden begint bij <b>${PLAYER_NL[G.dealer]}</b>.`);

  document.getElementById('bidding-panel').classList.remove('hidden');
  document.getElementById('bid-history-panel').classList.remove('hidden');
  document.getElementById('score-panel').style.display = 'none';

  updateInfoBar();
  renderHands();

  // If dealer is not south, start AI bidding
  if (G.dealer !== HUMAN) {
    setTimeout(aiDoBid, 700);
  }
}

function humanBid(bid) {
  if (G.phase !== 'bidding') return;
  if (getCurrentBidder() !== HUMAN) return;
  if (!bidIsLegal(bid, HUMAN)) return;
  processBid(HUMAN, bid);
}

function processBid(player, bid) {
  G.bids.push({ player, bid });
  renderBidHistory();

  const nextPlayer = getCurrentBidder();
  setMessage(`<b>${PLAYER_NL[player]}</b> biedt: <b>${formatBid(bid)}</b>`);
  updatePlayerLabels();

  // Check for end of bidding
  if (checkBiddingEnd()) return;

  // Is it human's turn?
  if (nextPlayer === HUMAN) {
    updateBidButtons();
    setMessage(`Jouw beurt om te bieden.`);
  } else {
    updateBidButtons();
    setTimeout(aiDoBid, 600);
  }
}

function checkBiddingEnd() {
  const n = G.bids.length;
  if (n < 4) return false;

  // 4 consecutive passes from the start = passed out
  const allPass = G.bids.every(b => b.bid === 'pass');
  if (allPass) {
    setMessage('Iedereen past — geen contract. Nieuwe hand.');
    G.phase = 'done';
    setTimeout(startNewHand, 2000);
    return true;
  }

  // After at least one real bid, 3 consecutive passes
  const lastThree = G.bids.slice(-3);
  const hcb = highestContractBid();
  if (hcb && lastThree.length === 3 && lastThree.every(b => b.bid === 'pass')) {
    endBidding();
    return true;
  }

  return false;
}

function endBidding() {
  const hcb = highestContractBid();
  const { doubled, redoubled } = contractDoubled();

  // Determine declarer: first player on winning side who first bid that suit
  // Find the last bid and its maker
  let winnerBid = null, winnerPlayer = null;
  for (let i = G.bids.length - 1; i >= 0; i--) {
    if (G.bids[i].bid === hcb) {
      winnerBid = hcb;
      winnerPlayer = G.bids[i].player;
      break;
    }
  }

  const winningSide = partnership(winnerPlayer);
  const bidSuit = winnerBid.slice(1);
  // Declarer: first player on winning side who bid this suit
  let declarer = winnerPlayer;
  for (let i = 0; i < G.bids.length; i++) {
    const b = G.bids[i];
    if (partnership(b.player) === winningSide && b.bid.slice(1) === bidSuit) {
      declarer = b.player;
      break;
    }
  }

  G.contract = {
    level: parseInt(hcb[0]),
    suit: bidSuit,
    declarer,
    doubled,
    redoubled,
  };

  G.declarer = declarer;
  G.dummy = partnerOf(declarer);

  // Lead is player to the left of declarer
  G.lead = leftOf(declarer);

  // Human plays for south; if south is declarer, also plays dummy (north)
  // If south is dummy, declarer also controls dummy... but human controls south (dummy)
  G.humanAsDeclarer = (declarer === HUMAN);
  G.humanAsDouble = (G.humanAsDeclarer && G.dummy !== HUMAN);
  // If south is dummy (and north is declarer), human plays south cards
  // which ARE the dummy – north (declarer) is AI

  document.getElementById('bidding-panel').classList.add('hidden');

  const c = G.contract;
  let contractStr = c.level + c.suit;
  if (c.redoubled) contractStr += ' XX';
  else if (c.doubled) contractStr += ' X';

  setMessage(`Contract: <b>${contractStr}</b> door <b>${PLAYER_NL[declarer]}</b>. Dummy: <b>${PLAYER_NL[G.dummy]}</b>.`);
  updateInfoBar();
  renderHands();

  setTimeout(startPlaying, 1200);
}

// ─── AI BIDDING ──────────────────────────────────────────────────────────────
function aiDoBid() {
  if (G.phase !== 'bidding') return;
  const player = getCurrentBidder();
  if (player === HUMAN) return;

  const bid = aiBidChoice(player);
  processBid(player, bid);
}

function countHCP(hand) {
  let hcp = 0;
  hand.forEach(card => {
    const { rank } = rankSuit(card);
    if (rank === 'A') hcp += 4;
    else if (rank === 'K') hcp += 3;
    else if (rank === 'Q') hcp += 2;
    else if (rank === 'J') hcp += 1;
  });
  return hcp;
}

function suitLengths(hand) {
  const len = { '♠':0, '♥':0, '♦':0, '♣':0 };
  hand.forEach(card => { len[rankSuit(card).suit]++; });
  return len;
}

function aiBidChoice(player) {
  const hand = G.hands[player];
  const hcp = countHCP(hand);
  const slen = suitLengths(hand);

  const hcb = highestContractBid();
  const hcbNum = hcb ? bidToNum(hcb) : -1;

  // Simple system:
  // Opening: 12+ HCP → open 1 of longest suit (prefer major)
  // Responder: 6+ HCP → raise or bid new suit

  function canBid(bid) { return bidIsLegal(bid, player); }

  // Determine if partner bid
  const partner = partnerOf(player);
  const partnerBids = G.bids.filter(b => b.player === partner && b.bid !== 'pass' && b.bid !== 'X' && b.bid !== 'XX');
  const hasPartnerBid = partnerBids.length > 0;

  // Opening logic (no bids yet or everyone passed)
  if (!hcb) {
    if (hcp >= 12) {
      // Choose best suit
      const best = bestSuit(slen, hcp);
      const bid = '1' + best;
      if (canBid(bid)) return bid;
    }
    if (hcp >= 22) {
      if (canBid('2NT')) return '2NT';
    }
    return 'pass';
  }

  // Response / rebid logic
  const side = partnership(player);
  const partnerBid = lastRealBidBy(side);

  if (hcp >= 6 && partnerBid) {
    // Try to support partner or bid NT
    const pbSuit = partnerBid.bid.slice(1);
    const pbLevel = parseInt(partnerBid.bid[0]);

    if (slen[pbSuit] >= 3 && pbSuit !== 'NT') {
      // Raise partner
      const newLevel = pbLevel + (hcp >= 10 ? 2 : 1);
      if (newLevel <= 7) {
        const raiseBid = newLevel + pbSuit;
        if (canBid(raiseBid)) return raiseBid;
      }
    }

    // Bid NT
    if (hcp >= 10) {
      for (let level = 1; level <= 7; level++) {
        const bid = level + 'NT';
        if (canBid(bid)) return bid;
      }
    }

    // Bid own suit
    const best = bestSuit(slen, hcp);
    for (let level = 1; level <= 7; level++) {
      const bid = level + best;
      if (canBid(bid)) return bid;
    }
  }

  // Double if opponents are in a bad contract
  if (hcp >= 14 && canBid('X')) {
    // Only double if we have many HCP and can handle it
    return 'X';
  }

  return 'pass';
}

function bestSuit(slen, hcp) {
  // prefer longest, then major, then higher
  const suits = ['♠','♥','♦','♣'];
  let best = '♣';
  let bestLen = -1;

  for (const suit of suits) {
    const l = slen[suit];
    if (l > bestLen || (l === bestLen && suits.indexOf(suit) < suits.indexOf(best))) {
      bestLen = l;
      best = suit;
    }
  }

  // if balanced (4-3-3-3 or 4-4-3-2) and 15-17 HCP, consider NT
  const vals = Object.values(slen).sort();
  const balanced = vals[0] >= 2 && vals[3] <= 5;
  if (balanced && hcp >= 15 && hcp <= 17) return 'NT';

  return best;
}

// ─── PLAYING PHASE ───────────────────────────────────────────────────────────
function startPlaying() {
  G.phase = 'playing';
  G.tricks = { ns: 0, ow: 0 };
  G.trickHistory = [];
  G.currentTrick = [];
  G.waitingForHuman = false;

  renderHands();
  updateInfoBar();
  setMessage(`Spelen begint! <b>${PLAYER_NL[G.lead]}</b> opent.`);

  setTimeout(nextTurnInTrick, 800);
}

function nextTurnInTrick() {
  if (G.phase !== 'playing') return;

  if (G.currentTrick.length === 4) {
    // Evaluate trick
    evaluateTrick();
    return;
  }

  // Who plays next?
  const leadIdx = PLAYERS.indexOf(G.lead);
  const nextPlayer = PLAYERS[(leadIdx + G.currentTrick.length) % 4];

  // Is it human's turn? (south, or dummy if human is declarer)
  const humanControls = nextPlayer === HUMAN ||
    (G.humanAsDouble && nextPlayer === G.dummy);

  if (humanControls) {
    G.waitingForHuman = true;
    G.currentTrick; // for reference in render
    renderHands();
    const ctrl = G.humanAsDouble && nextPlayer === G.dummy
      ? `${PLAYER_NL[nextPlayer]} (Dummy, door u bespeeld)`
      : 'U';
    setMessage(`<b>${ctrl}</b> — kies een kaart om te spelen.`);
  } else {
    G.waitingForHuman = false;
    renderHands();
    setTimeout(() => aiPlayCard(nextPlayer), 800);
  }
}

function getLegalCards(player) {
  const hand = G.hands[player];
  if (G.currentTrick.length === 0) return hand; // lead: any card

  const leadSuit = rankSuit(G.currentTrick[0].card).suit;
  const followed = hand.filter(c => rankSuit(c).suit === leadSuit);
  if (followed.length > 0) return followed;
  return hand; // can play anything if can't follow suit
}

function humanPlayCard(player, card) {
  if (!G.waitingForHuman) return;
  const legal = getLegalCards(player);
  if (!legal.includes(card)) return;

  G.waitingForHuman = false;
  playCard(player, card);
}

function playCard(player, card) {
  // Remove from hand
  const idx = G.hands[player].indexOf(card);
  if (idx !== -1) G.hands[player].splice(idx, 1);

  G.currentTrick.push({ player, card });
  renderTrick();
  renderHands();

  setMessage(`<b>${PLAYER_NL[player]}</b> speelt <b>${card}</b>`);
  updateInfoBar();

  setTimeout(nextTurnInTrick, 400);
}

function aiPlayCard(player) {
  const card = aiChooseCard(player);
  playCard(player, card);
}

function evaluateTrick() {
  const trumpSuit = G.contract.suit === 'NT' ? null : G.contract.suit;
  const leadSuit = rankSuit(G.currentTrick[0].card).suit;

  let winner = G.currentTrick[0];
  for (let i = 1; i < 4; i++) {
    const entry = G.currentTrick[i];
    const entryVal = cardValue(entry.card, trumpSuit, leadSuit);
    const winnerVal = cardValue(winner.card, trumpSuit, leadSuit);
    if (entryVal > winnerVal) winner = entry;
  }

  const side = partnership(winner.player);
  G.tricks[side]++;
  G.trickHistory.push({ trick: [...G.currentTrick], winner: winner.player });

  setMessage(`Slag gewonnen door <b>${PLAYER_NL[winner.player]}</b> (${G.currentTrick.map(e => e.card).join(', ')})`);
  updateInfoBar();

  document.getElementById('btn-next-trick').classList.remove('hidden');
  G.lead = winner.player;
  G.currentTrick = [];
  renderTrick();

  // Auto advance AI tricks, wait for human
  const humanWon = winner.player === HUMAN || (G.humanAsDouble && winner.player === G.dummy);

  // Check if all 13 tricks done
  const totalTricks = G.tricks.ns + G.tricks.ow;
  if (totalTricks === 13) {
    document.getElementById('btn-next-trick').classList.add('hidden');
    setTimeout(endHand, 1200);
    return;
  }

  if (humanWon) {
    // Let human click to continue
  } else {
    setTimeout(() => {
      document.getElementById('btn-next-trick').classList.add('hidden');
      nextTurnInTrick();
    }, 1000);
  }
}

// ─── AI CARD PLAY ────────────────────────────────────────────────────────────
function aiChooseCard(player) {
  const hand = G.hands[player];
  const legal = getLegalCards(player);
  const trumpSuit = G.contract.suit === 'NT' ? null : G.contract.suit;
  const isDefender = partnership(player) !== partnership(G.declarer);
  const isDummyPlayer = player === G.dummy;
  const isDeclarerSide = !isDefender;

  if (G.currentTrick.length === 0) {
    // Opening lead
    return aiOpeningLead(player, legal, trumpSuit, isDefender);
  }

  const leadSuit = rankSuit(G.currentTrick[0].card).suit;

  if (isDefender) {
    return aiDefenderPlay(player, legal, trumpSuit, leadSuit);
  } else {
    return aiDeclarerPlay(player, legal, trumpSuit, leadSuit);
  }
}

function aiOpeningLead(player, legal, trumpSuit, isDefender) {
  if (isDefender) {
    // Lead top of sequence, or 4th best of longest suit
    const bySuit = groupBySuit(legal);
    // Avoid leading trump if possible
    let best = null, bestLen = 0;
    for (const [suit, cards] of Object.entries(bySuit)) {
      if (suit === trumpSuit && Object.keys(bySuit).length > 1) continue;
      if (cards.length > bestLen) { bestLen = cards.length; best = cards; }
    }
    if (!best) best = legal;
    // 4th best or top of 2-card sequence
    best.sort((a,b) => RANK_VAL[rankSuit(b).rank] - RANK_VAL[rankSuit(a).rank]);
    if (best.length >= 4) return best[3];
    if (best.length >= 2) {
      // Check sequence
      if (RANK_VAL[rankSuit(best[0]).rank] - RANK_VAL[rankSuit(best[1]).rank] === 1) return best[0];
    }
    return best[best.length - 1]; // lowest
  } else {
    // Declarer leading (unlikely on first trick but handle it)
    return aiDeclarerPlay(player, legal, trumpSuit, rankSuit(legal[0]).suit);
  }
}

function groupBySuit(cards) {
  const g = {};
  cards.forEach(c => {
    const s = rankSuit(c).suit;
    if (!g[s]) g[s] = [];
    g[s].push(c);
  });
  return g;
}

function aiDefenderPlay(player, legal, trumpSuit, leadSuit) {
  // Simple: try to beat current winner, else play lowest
  const currentWinner = trickWinner(trumpSuit);
  const leadCards = legal.filter(c => rankSuit(c).suit === leadSuit);

  if (leadCards.length > 0) {
    // Must follow suit
    const winningCards = leadCards.filter(c =>
      cardValue(c, trumpSuit, leadSuit) > cardValue(currentWinner.card, trumpSuit, leadSuit)
    );
    if (winningCards.length > 0) {
      // Play cheapest winning card
      winningCards.sort((a,b) => RANK_VAL[rankSuit(a).rank] - RANK_VAL[rankSuit(b).rank]);
      return winningCards[0];
    } else {
      // Discard lowest
      leadCards.sort((a,b) => RANK_VAL[rankSuit(a).rank] - RANK_VAL[rankSuit(b).rank]);
      return leadCards[0];
    }
  } else {
    // Can't follow: trump if possible and not already winning
    const trumpCards = legal.filter(c => rankSuit(c).suit === trumpSuit);
    const winnerSide = partnership(currentWinner.player);
    const playerSide = partnership(player);

    if (trumpCards.length > 0 && winnerSide !== playerSide) {
      trumpCards.sort((a,b) => RANK_VAL[rankSuit(a).rank] - RANK_VAL[rankSuit(b).rank]);
      return trumpCards[0]; // cheapest trump
    }
    // Discard lowest value card
    legal.sort((a,b) => RANK_VAL[rankSuit(a).rank] - RANK_VAL[rankSuit(b).rank]);
    return legal[0];
  }
}

function aiDeclarerPlay(player, legal, trumpSuit, leadSuit) {
  // Declarer/dummy: try to win if possible, else dump low
  const currentWinner = trickWinner(trumpSuit);
  const leadCards = legal.filter(c => rankSuit(c).suit === leadSuit);
  const partnerId = partnerOf(player);
  const partnerInTrick = G.currentTrick.find(e => e.player === partnerId);
  const partnerWinning = partnerInTrick &&
    partnerInTrick.player === currentWinner.player;

  if (leadCards.length > 0) {
    if (partnerWinning) {
      // Partner is winning, discard low
      leadCards.sort((a,b) => RANK_VAL[rankSuit(a).rank] - RANK_VAL[rankSuit(b).rank]);
      return leadCards[0];
    }
    const winningCards = leadCards.filter(c =>
      cardValue(c, trumpSuit, leadSuit) > cardValue(currentWinner.card, trumpSuit, leadSuit)
    );
    if (winningCards.length > 0) {
      winningCards.sort((a,b) => RANK_VAL[rankSuit(a).rank] - RANK_VAL[rankSuit(b).rank]);
      return winningCards[0];
    }
    leadCards.sort((a,b) => RANK_VAL[rankSuit(a).rank] - RANK_VAL[rankSuit(b).rank]);
    return leadCards[0];
  } else {
    // Ruff or discard
    const trumpCards = legal.filter(c => rankSuit(c).suit === trumpSuit);
    if (!partnerWinning && trumpCards.length > 0) {
      trumpCards.sort((a,b) => RANK_VAL[rankSuit(a).rank] - RANK_VAL[rankSuit(b).rank]);
      return trumpCards[0];
    }
    legal.sort((a,b) => RANK_VAL[rankSuit(a).rank] - RANK_VAL[rankSuit(b).rank]);
    return legal[0];
  }
}

function trickWinner(trumpSuit) {
  if (G.currentTrick.length === 0) return null;
  const leadSuit = rankSuit(G.currentTrick[0].card).suit;
  let winner = G.currentTrick[0];
  for (let i = 1; i < G.currentTrick.length; i++) {
    const e = G.currentTrick[i];
    if (cardValue(e.card, trumpSuit, leadSuit) > cardValue(winner.card, trumpSuit, leadSuit)) {
      winner = e;
    }
  }
  return winner;
}

// ─── END OF HAND & SCORING ───────────────────────────────────────────────────
function endHand() {
  G.phase = 'done';
  renderHands(); // show all cards

  const c = G.contract;
  const declarerSide = partnership(c.declarer);
  const tricksMade = G.tricks[declarerSide];
  const required = c.level + 6; // need to win
  const overtricks = tricksMade - required;
  const vul = isVulnerable(declarerSide);

  let score = 0;
  let desc = '';

  if (overtricks >= 0) {
    // Made contract
    score = calculateMakeScore(c, overtricks, vul);
    desc = `Contract gemaakt! ${tricksMade}/${required} slagen. Score: ${score}`;
  } else {
    // Down
    const down = Math.abs(overtricks);
    score = -calculateDownScore(down, c.doubled, c.redoubled, vul);
    desc = `Contract gefaald! ${down} te weinig. Straf: ${Math.abs(score)}`;
  }

  // Score goes to the side that earned it (positive = declarer side, negative = defenders)
  if (score > 0) {
    G.scores[declarerSide] += score;
  } else {
    G.scores[declarerSide === 'ns' ? 'ow' : 'ns'] += Math.abs(score);
  }

  const scorePanel = document.getElementById('score-panel');
  scorePanel.style.display = 'block';
  document.getElementById('score-title').textContent =
    overtricks >= 0 ? '✓ Contract Gemaakt' : '✗ Contract Gefaald';
  document.getElementById('score-detail').textContent = desc;

  updateInfoBar();
  setMessage(desc);
  document.getElementById('btn-next-hand').classList.remove('hidden');
}

function isVulnerable(side) {
  return G.vulnerability === 'both' ||
    (side === 'ns' && G.vulnerability === 'ns') ||
    (side === 'ow' && G.vulnerability === 'ew');
}

function calculateMakeScore(c, overtricks, vul) {
  const { level, suit, doubled, redoubled } = c;

  // Trick score per trick (level)
  let perTrick = 0;
  if (suit === 'NT') perTrick = 30;
  else if (suit === '♠' || suit === '♥') perTrick = 30;
  else perTrick = 20; // minor

  let trickScore = perTrick * level;
  if (suit === 'NT') trickScore += 10; // 1NT = 40, etc.

  if (doubled)   trickScore *= 2;
  if (redoubled) trickScore *= 4;

  // Game bonus
  let bonus = 0;
  const isGame = trickScore >= 100;
  if (isGame) bonus = vul ? 500 : 300;
  else bonus = 50; // part score

  // Slam bonuses
  if (level === 6) bonus += vul ? 750 : 500;
  if (level === 7) bonus += vul ? 1500 : 1000;

  // Doubled/redoubled bonus for making
  let insult = 0;
  if (doubled)   insult = 50;
  if (redoubled) insult = 100;

  // Overtrick score
  let otScore = 0;
  if (doubled) otScore = overtricks * (vul ? 200 : 100);
  else if (redoubled) otScore = overtricks * (vul ? 400 : 200);
  else otScore = overtricks * perTrick;

  return trickScore + bonus + insult + otScore;
}

function calculateDownScore(down, doubled, redoubled, vul) {
  if (!doubled && !redoubled) {
    return down * (vul ? 100 : 50);
  }

  // Doubled/redoubled penalties
  let penalty = 0;
  if (doubled) {
    if (vul) {
      penalty = down * 200;
    } else {
      if (down === 1) penalty = 100;
      else if (down === 2) penalty = 300;
      else if (down === 3) penalty = 500;
      else penalty = 500 + (down - 3) * 300;
    }
  }
  if (redoubled) penalty *= 2;
  return penalty;
}

// ─── GAME FLOW ────────────────────────────────────────────────────────────────
function startNewHand() {
  G.dealNum++;
  G.dealer = PLAYERS[(G.dealNum - 1) % 4];
  G.vulnerability = VULN_TABLE[(G.dealNum - 1) % 16];

  // Reset trick/hand state
  G.hands = { north:[], east:[], south:[], west:[] };
  G.original = { north:[], east:[], south:[], west:[] };
  G.bids = [];
  G.contract = null;
  G.currentTrick = [];
  G.tricks = { ns:0, ow:0 };
  G.trickHistory = [];
  G.lead = null;
  G.declarer = null;
  G.dummy = null;
  G.waitingForHuman = false;
  G.humanAsDouble = false;
  G.humanAsDeclarer = false;

  document.getElementById('btn-next-trick').classList.add('hidden');
  document.getElementById('btn-next-hand').classList.add('hidden');
  document.getElementById('trick-result').textContent = '';
  document.getElementById('score-panel').style.display = 'none';

  // Clear trick slots
  PLAYERS.forEach(p => { document.getElementById(`trick-${p}`).innerHTML = ''; });

  dealCards();
  startBidding();
}

// ─── BUTTON HANDLERS ─────────────────────────────────────────────────────────
document.getElementById('btn-new-game').addEventListener('click', () => {
  G.scores = { ns:0, ow:0 };
  G.dealNum = 0;
  startNewHand();
});

document.getElementById('btn-pass').addEventListener('click', () => humanBid('pass'));
document.getElementById('btn-double').addEventListener('click', () => humanBid('X'));
document.getElementById('btn-redouble').addEventListener('click', () => humanBid('XX'));

document.getElementById('btn-next-trick').addEventListener('click', () => {
  document.getElementById('btn-next-trick').classList.add('hidden');
  nextTurnInTrick();
});

document.getElementById('btn-next-hand').addEventListener('click', () => {
  startNewHand();
});

// ─── INIT ─────────────────────────────────────────────────────────────────────
buildBidGrid();
updateInfoBar();
