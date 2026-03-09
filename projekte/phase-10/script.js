// --- Phase definitions & Validation ---
const PHASES = [
    { id: 1, desc: "2 Drillinge", validate: (cards) => checkSets(cards, 2, 3) },
    { id: 2, desc: "1 Drilling + 1 Viererfolge", validate: (cards) => checkSetAndRun(cards, 3, 4) },
    { id: 3, desc: "1 Vierling + 1 Viererfolge", validate: (cards) => checkSetAndRun(cards, 4, 4) },
    { id: 4, desc: "1 Siebenerfolge", validate: (cards) => checkRun(cards, 7) },
    { id: 5, desc: "1 Achterfolge", validate: (cards) => checkRun(cards, 8) },
    { id: 6, desc: "1 Neunerfolge", validate: (cards) => checkRun(cards, 9) },
    { id: 7, desc: "2 Vierlinge", validate: (cards) => checkSets(cards, 2, 4) },
    { id: 8, desc: "7 Karten einer Farbe", validate: (cards) => checkColorChoice(cards, 7) },
    { id: 9, desc: "1 Fünfling + 1 Zwilling", validate: (cards) => checkSets(cards, 1, 5, 2) },
    { id: 10, desc: "1 Fünfling + 1 Drilling", validate: (cards) => checkSets(cards, 1, 5, 3) },
];

const COLORS = ['c-red', 'c-blue', 'c-green', 'c-yellow'];

// --- DOM Elements ---
const overlay = document.getElementById('connection-overlay');
const statusText = document.getElementById('conn-status');
const myStatusEl = document.getElementById('my-status');
const opponentStatusEl = document.getElementById('opponent-status');
const turnIndicator = document.getElementById('turn-indicator');
const currentPhaseDesc = document.getElementById('current-phase-desc');
const deckElement = document.getElementById('deck-card');
const discardTopElement = document.getElementById('discard-top');
const myHandContainer = document.getElementById('my-hand');
const myPhaseContainer = document.getElementById('my-phase-container');
const opponentPhaseContainer = document.getElementById('opponent-phase-container');
const btnPlayPhase = document.getElementById('btn-play-phase');
const btnHitCard = document.getElementById('btn-hit-card');
const btnDiscard = document.getElementById('btn-discard');
const btnSortHand = document.getElementById('btn-sort-hand');

const summaryOverlay = document.getElementById('summary-overlay');
const summaryTitle = document.getElementById('summary-title');
const summaryText = document.getElementById('summary-text');
const btnNextRound = document.getElementById('btn-next-round');

// --- Network & State Variables ---
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');
const role = urlParams.get('role');

let peer = null;
let conn = null;

// Local Player State
let myHand = [];
let myPhaseLevel = 1;
let opponentPhaseLevel = 1;
let myPhaseCompletedThisRound = false;
let opponentPhaseCompletedThisRound = false;

let myLaidPhases = []; // Array of groups (arrays) of cards
let opponentLaidPhases = [];

let discardTopCard = null;
let deckEmpty = false;
let masterOpponentHandCount = 10;

// Turn State
let isMyTurn = false;
let drawnThisTurn = false;
let selectedIndexes = []; // specific indices in myHand

// Sorting State
let sortMode = 'number'; // 'number' or 'color'

// --- Host Master State ---
// The host holds the real deck, the discard pile, and the guest's hand.
let masterDeck = [];
let masterDiscard = [];
let masterGuestHand = [];


// --- Init PeerJS ---
if (!roomCode || !role) {
    statusText.textContent = "Offline Modus nicht verfügbar. Bitte über die Lobby starten.";
    overlay.style.display = 'flex';
} else {
    overlay.style.display = 'flex';
    if (role === 'host') {
        peer = new Peer(`koscher9-game-p10-${roomCode}`);
        statusText.textContent = "Host: Warte auf Gegner...";

        peer.on('connection', (connection) => {
            conn = connection;
            setupConnection();
            startNewRoundHost();
        });
        peer.on('error', err => handlePeerError(err));
    } else {
        peer = new Peer();
        peer.on('open', () => {
            statusText.textContent = "Verbinde zum Host...";
            conn = peer.connect(`koscher9-game-p10-${roomCode}`);
            setupConnection();
        });
        peer.on('error', err => handlePeerError(err));
    }
}

function handlePeerError(err) {
    statusText.textContent = `Fehler: ${err.type}`;
    statusText.style.color = "red";
    overlay.style.display = 'flex';
}

function setupConnection() {
    conn.on('open', () => {
        overlay.style.display = 'none';
        if (role === 'guest') updateUI(); // Show waiting
    });

    conn.on('data', (data) => {
        handleNetworkMessage(data);
    });

    conn.on('close', () => {
        statusText.textContent = "Verbindung getrennt.";
        statusText.style.color = "red";
        overlay.style.display = 'flex';
    });
}

// --- Network Routing ---

function handleNetworkMessage(data) {
    if (role === 'guest') {
        // Guest receives State Syncs
        if (data.type === 'SYNC_STATE_GUEST') {
            myHand = data.guestHand;
            myPhaseLevel = data.guestPhaseLevel;
            opponentPhaseLevel = data.hostPhaseLevel;
            myPhaseCompletedThisRound = data.guestPhaseCompleted;
            opponentPhaseCompletedThisRound = data.hostPhaseCompleted;
            myLaidPhases = data.guestLaid;
            opponentLaidPhases = data.hostLaid;
            discardTopCard = data.discardTop;
            deckEmpty = data.deckEmpty;
            masterOpponentHandCount = data.hostHandCount;
            isMyTurn = data.activePlayer === 'guest';

            summaryOverlay.style.display = 'none';
            selectedIndexes = []; // Reset selection on sync
            updateUI();
        } else if (data.type === 'ROUND_OVER') {
            handleRoundOver(data.winner);
        } else if (data.type === 'ERROR') {
            alert(data.msg);
        }
    } else if (role === 'host') {
        // Host receives requests and executes them if valid
        if (data.type === 'REQ_DRAW') {
            if (isMyTurn) return; // Ignore if host turn
            hostExecuteDraw('guest', data.fromDiscard);
        } else if (data.type === 'REQ_PLAY_PHASE') {
            if (isMyTurn) return;
            hostExecutePlayPhase('guest', data.idxs);
        } else if (data.type === 'REQ_HIT') {
            if (isMyTurn) return;
            hostExecuteHit('guest', data.cardIdx, data.targetPlayer, data.targetGroupIdx);
        } else if (data.type === 'REQ_DISCARD') {
            if (isMyTurn) return;
            hostExecuteDiscard('guest', data.idx);
        }
    }

    // Both handle Lobby back
    if (data.type === 'BACK_TO_LOBBY') {
        const pathParts = window.location.pathname.split('/');
        pathParts.pop(); // index.html
        pathParts.pop(); // phase-10
        pathParts.pop(); // projekte
        const lobbyUrl = window.location.origin + pathParts.join('/') + `/index.html?room=${roomCode}&role=${role}`;
        window.location.href = lobbyUrl;
    }
}

// --- Host Game Logic Engine ---

function buildDeck() {
    let deck = [];
    for (const color of COLORS) {
        for (let i = 1; i <= 12; i++) {
            deck.push({ id: `c-${color}-${i}-1`, color: color, value: i, isWild: false, isSkip: false });
            deck.push({ id: `c-${color}-${i}-2`, color: color, value: i, isWild: false, isSkip: false });
        }
    }
    for (let i = 1; i <= 8; i++) deck.push({ id: `w-${i}`, color: 'c-wild', value: 0, isWild: true, isSkip: false });
    for (let i = 1; i <= 4; i++) deck.push({ id: `s-${i}`, color: 'c-skip', value: 0, isWild: false, isSkip: true });

    return deck.sort(() => Math.random() - 0.5);
}

function startNewRoundHost() {
    masterDeck = buildDeck();
    myHand = masterDeck.splice(0, 10);
    masterGuestHand = masterDeck.splice(0, 10);

    // Validate top discard until not a skip
    while (masterDeck[0].isSkip) {
        masterDeck.push(masterDeck.shift()); // move skip to bottom
    }
    masterDiscard = [masterDeck.shift()];
    discardTopCard = masterDiscard[masterDiscard.length - 1];

    myLaidPhases = [];
    opponentLaidPhases = [];
    myPhaseCompletedThisRound = false;
    opponentPhaseCompletedThisRound = false;

    isMyTurn = true; // Host always starts for simplicity
    drawnThisTurn = false;

    broadcastStateFromHost();
}

function checkDeckReshuffle() {
    if (masterDeck.length === 0 && masterDiscard.length > 1) {
        const top = masterDiscard.pop();
        masterDeck = masterDiscard.sort(() => Math.random() - 0.5);
        masterDiscard = [top];
        discardTopCard = top;
    }
}

function broadcastStateFromHost() {
    // Call this after ANY state change

    // 1. Update Host UI natively
    deckEmpty = masterDeck.length === 0;
    masterOpponentHandCount = masterGuestHand.length;
    selectedIndexes = []; // clear selection on host
    updateUI();

    // 2. Send Sync to Guest
    conn.send({
        type: 'SYNC_STATE_GUEST',
        guestHand: masterGuestHand,
        guestPhaseLevel: opponentPhaseLevel,
        hostPhaseLevel: myPhaseLevel,
        guestPhaseCompleted: opponentPhaseCompletedThisRound,
        hostPhaseCompleted: myPhaseCompletedThisRound,
        guestLaid: opponentLaidPhases,
        hostLaid: myLaidPhases,
        discardTop: discardTopCard,
        deckEmpty: deckEmpty,
        hostHandCount: myHand.length,
        activePlayer: isMyTurn ? 'host' : 'guest'
    });
}

function checkRoundOverHost() {
    if (myHand.length === 0 || masterGuestHand.length === 0) {
        const winner = myHand.length === 0 ? 'host' : 'guest';

        // Advance phases
        if (myPhaseCompletedThisRound) myPhaseLevel = Math.min(10, myPhaseLevel + 1);
        if (opponentPhaseCompletedThisRound) opponentPhaseLevel = Math.min(10, opponentPhaseLevel + 1);

        // Trigger overlay for host
        handleRoundOver(winner);

        // Trigger overlay for guest
        conn.send({ type: 'ROUND_OVER', winner: winner });
        return true;
    }
    return false;
}

// Host Action Executors

function hostExecuteDraw(player, fromDiscard) {
    if (player === 'guest' && drawnThisTurn) return; // Already drawn (guest tracks this locally too, but host enforces)

    checkDeckReshuffle();
    let card;
    if (fromDiscard && masterDiscard.length > 0) {
        if (masterDiscard[masterDiscard.length - 1].isSkip) {
            if (player === 'guest') conn.send({ type: 'ERROR', msg: "Aussetzen-Karten dürfen nicht gezogen werden!" });
            return;
        }
        card = masterDiscard.pop();
    } else {
        if (masterDeck.length === 0) return; // Deck empty, no discard
        card = masterDeck.shift();
    }

    discardTopCard = masterDiscard.length > 0 ? masterDiscard[masterDiscard.length - 1] : null;

    if (player === 'host') {
        myHand.push(card);
        drawnThisTurn = true;
    } else {
        masterGuestHand.push(card);
        // Guest handles drawnThisTurn locally via activePlayer
    }

    broadcastStateFromHost();
}

function hostExecutePlayPhase(player, cardIndices) {
    const hand = player === 'host' ? myHand : masterGuestHand;
    const phaseLevel = player === 'host' ? myPhaseLevel : opponentPhaseLevel;
    const isCompleted = player === 'host' ? myPhaseCompletedThisRound : opponentPhaseCompletedThisRound;

    if (isCompleted) {
        if (player === 'guest') conn.send({ type: 'ERROR', msg: "Phase bereits ausgelegt." });
        return;
    }

    const selectedCards = cardIndices.map(i => hand[i]);
    const phaseDef = PHASES.find(p => p.id === phaseLevel);

    if (phaseDef && phaseDef.validate(selectedCards)) {
        // Group them visually based on the phase definition.
        // Instead of one big sorted group, we split them smartly.
        const sorted = sortCardsWildsLast(selectedCards);
        const grouped = smartGroup(sorted, phaseLevel);

        if (player === 'host') {
            grouped.forEach(g => myLaidPhases.push(g));
            myPhaseCompletedThisRound = true;
            cardIndices.sort((a, b) => b - a).forEach(i => myHand.splice(i, 1));
        } else {
            grouped.forEach(g => opponentLaidPhases.push(g));
            opponentPhaseCompletedThisRound = true;
            cardIndices.sort((a, b) => b - a).forEach(i => masterGuestHand.splice(i, 1));
        }

        if (!checkRoundOverHost()) broadcastStateFromHost();
    } else {
        if (player === 'guest') conn.send({ type: 'ERROR', msg: "Ungültige Phasenkombination!" });
        if (player === 'host') alert("Ungültige Phasenkombination!");
    }
}

function hostExecuteHit(player, cardIdx, targetOwner, targetGroupIdx) {
    const hand = player === 'host' ? myHand : masterGuestHand;
    const meCompleted = player === 'host' ? myPhaseCompletedThisRound : opponentPhaseCompletedThisRound;

    if (!meCompleted) {
        if (player === 'guest') conn.send({ type: 'ERROR', msg: "Du musst erst deine eigene Phase auslegen!" });
        if (player === 'host') alert("Du musst erst deine Phase auslegen!");
        return;
    }

    const card = hand[cardIdx];
    const targetPhases = targetOwner === player ?
        (player === 'host' ? myLaidPhases : opponentLaidPhases) :
        (player === 'host' ? opponentLaidPhases : myLaidPhases);

    const group = targetPhases[targetGroupIdx];

    if (!group) return;

    // Simple permissive hitting: To keep it fun and simple for now, if you try to hit, it just appends it.
    // Real phase 10 requires validating if the card actually matches the set/run.
    // For V1 MVP, we allow appending.
    if (card.isSkip) {
        if (player === 'guest') conn.send({ type: 'ERROR', msg: "Aussetzer können nicht angelegt werden." });
        if (player === 'host') alert("Aussetzer können nicht angelegt werden.");
        return;
    }

    group.push(card);

    // Remove from hand
    if (player === 'host') {
        myHand.splice(cardIdx, 1);
    } else {
        masterGuestHand.splice(cardIdx, 1);
    }

    if (!checkRoundOverHost()) broadcastStateFromHost();
}

function hostExecuteDiscard(player, cardIdx) {
    // Only allow discard if opponent hasn't been skipped, but we skip "skip" logic for MVP turn flow,
    // or we implement simple skip: Skip cards just end turn but don't do anything complex yet.

    const hand = player === 'host' ? myHand : masterGuestHand;
    const card = hand[cardIdx];

    masterDiscard.push(card);
    discardTopCard = card;

    if (player === 'host') {
        myHand.splice(cardIdx, 1);
    } else {
        masterGuestHand.splice(cardIdx, 1);
    }

    if (checkRoundOverHost()) return;

    // Swap turns
    isMyTurn = player === 'guest'; // If guest discarded, it's host turn
    if (player === 'host') drawnThisTurn = false; // Reset for next time host plays

    // TODO: If `card.isSkip` is played, theoretically the NEXT player loses their turn.
    if (card.isSkip) {
        // Next player is skipped, so turn DOES NOT swap!
        isMyTurn = player === 'host';
    }

    broadcastStateFromHost();
}

function handleRoundOver(winner) {
    summaryTitle.textContent = winner === role ? "Du gewinnst die Runde!" : "Gegner gewinnt die Runde!";
    summaryText.innerHTML = `Du bist nun auf Phase ${myPhaseLevel}.<br>Gegner ist auf Phase ${opponentPhaseLevel}.`;

    if (role === 'host') {
        btnNextRound.style.display = 'inline-block';
        btnNextRound.onclick = () => {
            startNewRoundHost();
        };
    } else {
        btnNextRound.style.display = 'none';
        summaryText.innerHTML += "<br><br>Warte auf Host...";
    }
    summaryOverlay.style.display = 'flex';
}

// --- Local Interactions ---

// Deck / Discard click
deckElement.addEventListener('click', () => {
    if (!isMyTurn || drawnThisTurn) return;
    if (role === 'host') {
        hostExecuteDraw('host', false);
    } else {
        conn.send({ type: 'REQ_DRAW', fromDiscard: false });
        drawnThisTurn = true; // Optimistic
    }
});

discardTopElement.addEventListener('click', () => {
    if (!isMyTurn || drawnThisTurn || !discardTopCard) return;
    if (discardTopCard.isSkip) {
        alert("Aussetzer dürfen nicht gezogen werden!");
        return;
    }
    if (role === 'host') {
        hostExecuteDraw('host', true);
    } else {
        conn.send({ type: 'REQ_DRAW', fromDiscard: true });
        drawnThisTurn = true; // Optimistic
    }
});

// Controls
btnPlayPhase.addEventListener('click', () => {
    if (!isMyTurn || !drawnThisTurn || myPhaseCompletedThisRound || selectedIndexes.length === 0) return;

    if (role === 'host') {
        hostExecutePlayPhase('host', selectedIndexes);
    } else {
        conn.send({ type: 'REQ_PLAY_PHASE', idxs: selectedIndexes });
    }
});

btnHitCard.addEventListener('click', () => {
    if (!isMyTurn || !drawnThisTurn || !myPhaseCompletedThisRound || selectedIndexes.length !== 1) return;

    // Prompting where to hit in a browser requires UI logic.
    // For simplicity, we auto-hit the first array we find, or we ask the user.
    // Let's use a native `prompt` for MVP if there are multiple options, or just hit the first available.
    alert("Klicke auf eine liegende Karte in einer Phase, um deine ausgewählte Karte dort anzulegen.");
    // This requires turning the phase cards into click targets. Handled in UI render.
});

btnDiscard.addEventListener('click', () => {
    if (!isMyTurn || !drawnThisTurn || selectedIndexes.length !== 1) return;

    const idx = selectedIndexes[0];
    if (role === 'host') {
        hostExecuteDiscard('host', idx);
    } else {
        conn.send({ type: 'REQ_DISCARD', idx: idx });
        isMyTurn = false; // Optimistic lock
        updateUI();
    }
});

btnSortHand.addEventListener('click', () => {
    sortMode = sortMode === 'number' ? 'color' : 'number';
    btnSortHand.textContent = sortMode === 'number' ? 'Sortierung: Zahl' : 'Sortierung: Farbe';
    updateUI();
});

function sortMyHand() {
    myHand.sort((a, b) => {
        // Skips always at very end, Wilds just before skips
        if (a.isSkip && !b.isSkip) return 1;
        if (!a.isSkip && b.isSkip) return -1;
        if (a.isWild && !b.isWild) return 1;
        if (!a.isWild && b.isWild) return -1;

        if (sortMode === 'color') {
            const colorOrder = { 'c-blue': 1, 'c-green': 2, 'c-red': 3, 'c-yellow': 4, 'c-wild': 5, 'c-skip': 6 };
            const cA = colorOrder[a.color] || 9;
            const cB = colorOrder[b.color] || 9;
            if (cA !== cB) return cA - cB;
            // If same color, sort by value
            return a.value - b.value;
        } else {
            // Sort by number
            return a.value - b.value;
        }
    });
}

// UI Updater
function updateUI() {
    // Preserve selection across sorts
    const selectedIds = selectedIndexes.map(idx => myHand[idx].id);
    sortMyHand();
    selectedIndexes = myHand
        .map((c, i) => selectedIds.includes(c.id) ? i : -1)
        .filter(i => i !== -1);

    // Status borders
    if (isMyTurn) {
        turnIndicator.textContent = "Du bist am Zug";
        turnIndicator.classList.add('active');
    } else {
        turnIndicator.textContent = "Gegner ist am Zug";
        turnIndicator.classList.remove('active');
    }

    myStatusEl.textContent = `Phase ${myPhaseLevel}`;
    opponentStatusEl.textContent = `Phase ${opponentPhaseLevel}${masterOpponentHandCount ? ` (${masterOpponentHandCount} Karten)` : ''}`;

    const phaseDef = PHASES.find(p => p.id === myPhaseLevel);
    currentPhaseDesc.textContent = `Ziel: ${phaseDef ? phaseDef.desc : 'Gewonnen!'}`;

    // Update discard
    discardTopElement.innerHTML = '';
    discardTopElement.className = 'card empty-slot';
    if (discardTopCard) {
        discardTopElement.className = `card ${discardTopCard.color}`;
        discardTopElement.innerHTML = `
            <div class="card-inner">${getCardLabel(discardTopCard)}</div>
        `;
        discardTopElement.setAttribute('data-value', getCardLabel(discardTopCard));
    }

    // Render Hand
    myHandContainer.innerHTML = '';
    myHand.forEach((card, idx) => {
        const cEl = document.createElement('div');
        cEl.className = `card ${card.color} ${selectedIndexes.includes(idx) ? 'selected' : ''}`;
        cEl.innerHTML = `<div class="card-inner">${getCardLabel(card)}</div>`;
        cEl.setAttribute('data-value', getCardLabel(card));

        cEl.onclick = () => {
            if (selectedIndexes.includes(idx)) {
                selectedIndexes = selectedIndexes.filter(i => i !== idx);
            } else {
                selectedIndexes.push(idx);
            }
            updateUI(); // re-render selection & buttons
        };
        myHandContainer.appendChild(cEl);
    });

    // Render Phases
    renderPhases(myPhaseContainer, myLaidPhases, 'host'); // 'owner' logic is a bit abstracted here, use 'my' vs 'opponent'
    renderPhases(opponentPhaseContainer, opponentLaidPhases, 'opponent');

    // Button states
    btnPlayPhase.disabled = !isMyTurn || !drawnThisTurn || myPhaseCompletedThisRound || selectedIndexes.length === 0;
    btnHitCard.disabled = !isMyTurn || !drawnThisTurn || !myPhaseCompletedThisRound || selectedIndexes.length !== 1;
    btnDiscard.disabled = !isMyTurn || !drawnThisTurn || selectedIndexes.length !== 1;
}

function renderPhases(container, phasesGroupArr, ownerId) {
    container.innerHTML = '';
    phasesGroupArr.forEach((group, groupIdx) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'phase-group';

        group.forEach(card => {
            const cEl = document.createElement('div');
            cEl.className = `card ${card.color}`;
            cEl.innerHTML = `<div class="card-inner">${getCardLabel(card)}</div>`;
            cEl.setAttribute('data-value', getCardLabel(card));

            // Hit logic listener
            cEl.onclick = () => {
                if (btnHitCard.disabled || selectedIndexes.length !== 1) return;
                const cardIdx = selectedIndexes[0];
                const targetOwner = ownerId === 'host' ? role : (role === 'host' ? 'guest' : 'host');

                if (role === 'host') {
                    hostExecuteHit('host', cardIdx, targetOwner, groupIdx);
                } else {
                    conn.send({ type: 'REQ_HIT', cardIdx: cardIdx, targetPlayer: targetOwner, targetGroupIdx: groupIdx });
                }
            };

            groupEl.appendChild(cEl);
        });
        container.appendChild(groupEl);
    });
}

function getCardLabel(c) {
    if (c.isWild) return 'Joker';
    if (c.isSkip) return 'Aussetzen';
    return c.value;
}

// --- Validation Helpers (Permissive for MVP) ---

function sortCardsWildsLast(cards) {
    return cards.slice().sort((a, b) => {
        if (a.isWild) return 1;
        if (b.isWild) return -1;
        return a.value - b.value;
    });
}

// Splits the laid cards into visual groups (e.g. 2 Drillinge -> 2 groups)
function smartGroup(sortedCards, phaseId) {
    if (sortedCards.length === 0) return [[]];

    const splits = {
        1: [3, 3], // 2 Drillinge
        2: [3, 4], // Drilling + Viererfolge
        3: [4, 4], // Vierling + Viererfolge
        4: [sortedCards.length], // Siebenerfolge (alles eins)
        5: [sortedCards.length], // Achterfolge
        6: [sortedCards.length], // Neunerfolge
        7: [4, 4], // 2 Vierlinge
        8: [sortedCards.length], // 7 gleiche Farbe
        9: [5, 2], // Fünfling + Zwilling
        10: [5, 3] // Fünfling + Drilling
    };

    const targetSplits = splits[phaseId] || [sortedCards.length];

    // For sets, we should ideally group identical values together instead of blind length splitting.
    // If we just want to split out the sets (Drilling, Vierling, etc), we find the groups of identical numbers first.
    let groups = [];
    let remaining = [...sortedCards];

    // Simple heuristic: if the phase has multiple groups (e.g., [3, 4]), try to extract the sets first.
    if (targetSplits.length > 1) {
        targetSplits.forEach(size => {
            // Find a value that appears `size` times (ignoring wilds for a moment, or including wilds)
            // Just blind split for MVP, but to prevent splitting a set in half, we can sort by value counts.
            // Let's do a simple count map.
            let extracted = [];
            let valCounts = {};
            remaining.forEach(c => { if (!c.isWild) valCounts[c.value] = (valCounts[c.value] || 0) + 1; });

            // Find a value with enough cards (or close enough that wilds can fill)
            let bestVal = Object.keys(valCounts).find(v => valCounts[v] > 1);

            if (size <= 5 && bestVal) { // Trying to extract a SET
                for (let i = remaining.length - 1; i >= 0; i--) {
                    if (extracted.length < size && (remaining[i].value == bestVal || remaining[i].isWild)) {
                        extracted.push(remaining.splice(i, 1)[0]);
                    }
                }
            } else {
                // Must be a run or remaining, just slice
                extracted = remaining.splice(0, size);
            }

            // If we didn't get enough (e.g. only 1 card and rest wilds), fill from remaining.
            while (extracted.length < size && remaining.length > 0) {
                extracted.push(remaining.shift());
            }

            if (extracted.length > 0) groups.push(extracted.reverse());
        });

        // Put any accidental leftovers into the last group
        if (remaining.length > 0 && groups.length > 0) {
            groups[groups.length - 1].push(...remaining);
        }
    } else {
        // Single group phase (Run, Color)
        groups.push([...remaining]);
    }

    return groups.length > 0 ? groups : [sortedCards];
}

// Extremely simplified permissive validation for MVP since writing a complete phase 10 validator is 300+ lines.
// We just verify it has enough cards and no skips.
function hasNoSkips(cards) {
    return !cards.some(c => c.isSkip);
}

function checkSets(cards, numSets, setLength, extraReq = null) {
    if (!hasNoSkips(cards)) return false;
    let requiredLength = numSets * setLength;
    if (extraReq) requiredLength += extraReq; // lazy length check
    if (cards.length < requiredLength) return false;

    // For V1 MVP: Trust the user mostly, just ensure length is exact
    return true;
}

function checkSetAndRun(cards, setLen, runLen) {
    if (!hasNoSkips(cards)) return false;
    if (cards.length < setLen + runLen) return false;
    return true;
}

function checkRun(cards, len) {
    if (!hasNoSkips(cards) || cards.length < len) return false;
    return true;
}

function checkColorChoice(cards, len) {
    if (cards.length < len) return false;
    // Actually check color
    let mainColor = null;
    for (const c of cards) {
        if (c.isSkip) return false;
        if (c.isWild) continue;
        if (!mainColor) mainColor = c.color;
        else if (mainColor !== c.color) return false; // Found mismatch
    }
    return true;
}

// Override back button
const backBtn = document.getElementById('back-btn');
if (backBtn) {
    backBtn.addEventListener('click', (e) => {
        if (roomCode && conn && conn.open) {
            e.preventDefault();
            conn.send({ type: 'BACK_TO_LOBBY' });

            const pathParts = window.location.pathname.split('/');
            pathParts.pop(); // index.html
            pathParts.pop(); // phase-10
            pathParts.pop(); // projekte
            const lobbyUrl = window.location.origin + pathParts.join('/') + `/index.html?room=${roomCode}&role=${role}`;
            window.location.href = lobbyUrl;
        }
    });
}
