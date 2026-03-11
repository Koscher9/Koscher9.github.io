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
const btnDevNext = document.getElementById('btn-dev-next');

const summaryOverlay = document.getElementById('summary-overlay');
const summaryTitle = document.getElementById('summary-title');
const summaryContent = document.getElementById('summary-content');
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
let myTotalPoints = 0;
let opponentTotalPoints = 0;
let myPhaseCompletedThisRound = false;
let opponentPhaseCompletedThisRound = false;
let roundStarter = 'guest'; // Will immediately flip to 'host' in first startNewRoundHost

let myLaidPhases = []; // Array of groups (arrays) of cards
let opponentLaidPhases = [];

let discardTopCard = null;
let deckEmpty = false;
let masterOpponentHandCount = 10;

// Turn State
let isMyTurn = false;
let drawnThisTurn = false;
let selectedIndexes = []; // specific indices in myHand
let lastDrawnCardId = null; // for highlighting

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
        if (btnDevNext) btnDevNext.style.display = 'inline-block';
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
            myTotalPoints = data.guestTotalPoints;
            opponentTotalPoints = data.hostTotalPoints;
            myLaidPhases = data.guestLaid;
            opponentLaidPhases = data.hostLaid;
            discardTopCard = data.discardTop;
            deckEmpty = data.deckEmpty;
            masterOpponentHandCount = data.hostHandCount;
            if (data.activePlayer === 'guest' && !isMyTurn) {
                lastDrawnCardId = null; // Clear glow when my turn starts
                drawnThisTurn = false; // FINALLY reset the optimistic lock!
            }
            isMyTurn = data.activePlayer === 'guest';

            summaryOverlay.style.display = 'none'; // Ensure guest overlay hides on new round
            selectedIndexes = []; // Reset selection on sync
            if (data.lastDrawnCard) lastDrawnCardId = data.lastDrawnCard;
            updateUI();
        } else if (data.type === 'ROUND_OVER') {
            handleRoundOver(data.data);
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
            hostExecutePlayPhase('guest', data.cardIds);
        } else if (data.type === 'REQ_HIT') {
            if (isMyTurn) return;
            hostExecuteHit('guest', data.cardId, data.targetPlayer, data.targetGroupIdx);
        } else if (data.type === 'REQ_DISCARD') {
            if (isMyTurn) return;
            hostExecuteDiscard('guest', data.cardId);
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

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

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

    return shuffleArray(deck);
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

    // Alternate starter
    roundStarter = roundStarter === 'host' ? 'guest' : 'host';
    isMyTurn = (roundStarter === 'host');

    drawnThisTurn = false;
    lastDrawnCardId = null;

    // IMPORTANT: hide overlay on host!
    summaryOverlay.style.display = 'none';

    broadcastStateFromHost();
}

function checkDeckReshuffle() {
    if (masterDeck.length === 0 && masterDiscard.length > 1) {
        const top = masterDiscard.pop();
        masterDeck = shuffleArray(masterDiscard);
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
        guestTotalPoints: opponentTotalPoints,
        hostTotalPoints: myTotalPoints,
        guestLaid: opponentLaidPhases,
        hostLaid: myLaidPhases,
        discardTop: discardTopCard,
        deckEmpty: deckEmpty,
        hostHandCount: myHand.length,
        activePlayer: isMyTurn ? 'host' : 'guest',
        lastDrawnCard: lastDrawnCardId
    });
}

function calculatePoints(hand) {
    let pts = 0;
    for (let c of hand) {
        if (c.isWild) pts += 25;
        else if (c.isSkip) pts += 15;
        else if (c.value >= 10) pts += 10;
        else pts += 5;
    }
    return pts;
}

function checkRoundOverHost() {
    if (myHand.length === 0 || masterGuestHand.length === 0) {
        const winner = myHand.length === 0 ? 'host' : 'guest';

        const hostPenalty = calculatePoints(myHand);
        const guestPenalty = calculatePoints(masterGuestHand);
        myTotalPoints += hostPenalty;
        opponentTotalPoints += guestPenalty;

        // Advance phases
        if (myPhaseCompletedThisRound) myPhaseLevel++;
        if (opponentPhaseCompletedThisRound) opponentPhaseLevel++;

        let isGameOver = false;
        let finalWinner = '';
        if (myPhaseLevel > 10 && opponentPhaseLevel > 10) {
            isGameOver = true;
            finalWinner = myTotalPoints <= opponentTotalPoints ? 'host' : 'guest';
        } else if (myPhaseLevel > 10) {
            isGameOver = true;
            finalWinner = 'host';
        } else if (opponentPhaseLevel > 10) {
            isGameOver = true;
            finalWinner = 'guest';
        }

        const summaryData = {
            winner: winner,
            isGameOver: isGameOver,
            finalWinner: finalWinner,
            hostPhase: Math.min(10, myPhaseLevel),
            guestPhase: Math.min(10, opponentPhaseLevel),
            hostPenalty: hostPenalty,
            guestPenalty: guestPenalty,
            hostTotal: myTotalPoints,
            guestTotal: opponentTotalPoints
        };

        // Trigger overlay for host
        handleRoundOver(summaryData);

        // Trigger overlay for guest
        conn.send({ type: 'ROUND_OVER', data: summaryData });
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
        lastDrawnCardId = card.id;
    } else {
        masterGuestHand.push(card);
        lastDrawnCardId = card.id;
        // Guest handles drawnThisTurn locally via activePlayer
    }

    broadcastStateFromHost();
}

function hostExecutePlayPhase(player, cardIds) {
    const hand = player === 'host' ? myHand : masterGuestHand;
    const phaseLevel = player === 'host' ? myPhaseLevel : opponentPhaseLevel;
    const isCompleted = player === 'host' ? myPhaseCompletedThisRound : opponentPhaseCompletedThisRound;

    if (isCompleted) {
        if (player === 'guest') conn.send({ type: 'ERROR', msg: "Phase bereits ausgelegt." });
        return;
    }

    const selectedCards = cardIds.map(id => hand.find(c => c.id === id)).filter(Boolean);

    if (selectedCards.length !== cardIds.length || selectedCards.some(c => c.isSkip)) {
        if (player === 'guest') conn.send({ type: 'ERROR', msg: "Ungültige Karten." });
        return;
    }

    const grouped = validateAndGroupPhase(selectedCards, phaseLevel);

    if (grouped) {
        if (player === 'host') {
            grouped.forEach(g => myLaidPhases.push(g));
            myPhaseCompletedThisRound = true;
            cardIds.forEach(id => {
                const i = myHand.findIndex(c => c.id === id);
                if (i > -1) myHand.splice(i, 1);
            });
        } else {
            grouped.forEach(g => opponentLaidPhases.push(g));
            opponentPhaseCompletedThisRound = true;
            cardIds.forEach(id => {
                const i = masterGuestHand.findIndex(c => c.id === id);
                if (i > -1) masterGuestHand.splice(i, 1);
            });
        }
        if (!checkRoundOverHost()) broadcastStateFromHost();
    } else {
        const msg = "Ungültige Phasenkombination!";
        if (player === 'guest') conn.send({ type: 'ERROR', msg });
        if (player === 'host') alert(msg);
    }
}

function hostExecuteHit(player, cardId, targetOwner, targetGroupIdx) {
    const hand = player === 'host' ? myHand : masterGuestHand;
    const meCompleted = player === 'host' ? myPhaseCompletedThisRound : opponentPhaseCompletedThisRound;

    if (!meCompleted) {
        const msg = "Du musst erst deine eigene Phase auslegen!";
        if (player === 'guest') conn.send({ type: 'ERROR', msg }); else alert(msg);
        return;
    }

    const cardIdx = hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;
    const card = hand[cardIdx];

    const targetPhases = targetOwner === player ?
        (player === 'host' ? myLaidPhases : opponentLaidPhases) :
        (player === 'host' ? opponentLaidPhases : myLaidPhases);

    const group = targetPhases[targetGroupIdx];
    if (!group) return;

    if (card.isSkip) {
        const msg = "Aussetzer können nicht angelegt werden.";
        if (player === 'guest') conn.send({ type: 'ERROR', msg }); else alert(msg);
        return;
    }

    let isSet = false, isColor = false, isRun = false;
    const realCards = group.filter(c => !c.isWild);

    if (realCards.length >= 2) {
        if (realCards[0].value === realCards[1].value) isSet = true;
        else if (realCards[0].color === realCards[1].color && Math.abs(realCards[0].value - realCards[1].value) !== 1) isColor = true;
        else isRun = true;
    } else {
        isSet = true;
    }

    if (isSet) {
        const targetVal = realCards[0].value;
        if (!card.isWild && card.value !== targetVal) {
            const msg = "Falscher Wert für diesen Drilling/Vierling.";
            if (player === 'guest') conn.send({ type: 'ERROR', msg }); else alert(msg);
            return;
        }
        group.push(card);
    } else if (isColor) {
        const targetCol = realCards[0].color;
        if (!card.isWild && card.color !== targetCol) {
            const msg = "Falsche Farbe für diese Farb-Phase.";
            if (player === 'guest') conn.send({ type: 'ERROR', msg }); else alert(msg);
            return;
        }
        group.push(card);
        group.sort((a, b) => (a.isWild ? 99 : a.value) - (b.isWild ? 99 : b.value));
    } else { // isRun
        let firstRealIdx = group.findIndex(c => !c.isWild);
        let headVal = group[firstRealIdx].value - firstRealIdx;
        let tailVal = headVal + group.length - 1;

        if (card.isWild) {
            if (tailVal >= 12 && headVal <= 1) {
                const msg = "Folge kann in keine Richtung erweitert werden.";
                if (player === 'guest') conn.send({ type: 'ERROR', msg }); else alert(msg);
                return;
            }
            if (tailVal < 12) group.push(card);
            else group.unshift(card);
        } else {
            if (card.value === tailVal + 1) group.push(card);
            else if (card.value === headVal - 1) group.unshift(card);
            else {
                const msg = `Karte passt nicht. Erwartet: ${headVal - 1} oder ${tailVal + 1}`;
                if (player === 'guest') conn.send({ type: 'ERROR', msg }); else alert(msg);
                return;
            }
        }
    }

    if (player === 'host') {
        myHand.splice(cardIdx, 1);
    } else {
        masterGuestHand.splice(cardIdx, 1);
    }

    if (!checkRoundOverHost()) broadcastStateFromHost();
}

function hostExecuteDiscard(player, cardId) {
    const hand = player === 'host' ? myHand : masterGuestHand;
    const cardIdx = hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return;
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

function handleRoundOver(data) {
    if (data.isGameOver) {
        summaryTitle.textContent = data.finalWinner === role ? "SPIELSIEG! Du hast Phase 10 geschafft!" : "Verloren! Gegner hat Phase 10 geschafft!";
        summaryTitle.style.background = data.finalWinner === role ? "linear-gradient(135deg, #fff, #4ade80)" : "linear-gradient(135deg, #fff, #f87171)";
        summaryTitle.style.webkitBackgroundClip = "text";
        summaryTitle.style.webkitTextFillColor = "transparent";
    } else {
        summaryTitle.textContent = data.winner === role ? "Du gewinnst die Runde!" : "Gegner gewinnt die Runde!";
        summaryTitle.style.background = "none";
        summaryTitle.style.webkitBackgroundClip = "initial";
        summaryTitle.style.webkitTextFillColor = "initial";
    }

    // Determine my stats vs opponent stats based on role
    const myPhase = role === 'host' ? data.hostPhase : data.guestPhase;
    const oppPhase = role === 'host' ? data.guestPhase : data.hostPhase;
    const myPenalty = role === 'host' ? data.hostPenalty : data.guestPenalty;
    const oppPenalty = role === 'host' ? data.guestPenalty : data.hostPenalty;
    const myTotal = role === 'host' ? data.hostTotal : data.guestTotal;
    const oppTotal = role === 'host' ? data.guestTotal : data.hostTotal;

    summaryContent.innerHTML = `
        <table class="summary-table">
            <thead>
                <tr>
                    <th>Spieler</th>
                    <th>Nächste Phase</th>
                    <th>Straf-Punkte</th>
                    <th>Gesamt-Punkte</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td><strong>Du</strong></td>
                    <td>Phase ${myPhase}</td>
                    <td>+${myPenalty}</td>
                    <td><strong>${myTotal}</strong></td>
                </tr>
                <tr>
                    <td>Gegner</td>
                    <td>Phase ${oppPhase}${data.isGameOver ? ' (Ende)' : ''}</td>
                    <td>+${oppPenalty}</td>
                    <td><strong>${oppTotal}</strong></td>
                </tr>
            </tbody>
        </table>
    `;

    if (data.isGameOver) {
        summaryContent.innerHTML += `<p class="overlay-text">Das Spiel ist vorbei!</p>`;
        btnNextRound.style.display = 'none';

        // Add a button to return to lobby directly
        if (!document.getElementById('btn-gameover-lobby')) {
            const btn = document.createElement('a');
            const pathParts = window.location.pathname.split('/');
            pathParts.pop(); pathParts.pop(); pathParts.pop();
            btn.href = window.location.origin + pathParts.join('/') + `/index.html?room=${roomCode}&role=${role}`;
            btn.id = 'btn-gameover-lobby';
            btn.className = 'btn btn-outline';
            btn.textContent = 'Zurück zur Übersicht';
            summaryContent.appendChild(btn);
        }
    } else if (role === 'host') {
        btnNextRound.style.display = 'inline-block';
        btnNextRound.onclick = () => {
            startNewRoundHost();
        };
    } else {
        btnNextRound.style.display = 'none';
        summaryContent.innerHTML += "<p class='overlay-text'>Warte auf Host...</p>";
    }
    summaryOverlay.style.display = 'flex';
}

// --- Local Interactions ---

// Deck / Discard click
deckElement.addEventListener('click', () => {
    if (!isMyTurn || drawnThisTurn) return;
    lastDrawnCardId = null; // reset glow
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
    lastDrawnCardId = null; // reset glow
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

    const cardIds = selectedIndexes.map(i => myHand[i].id);
    if (role === 'host') {
        hostExecutePlayPhase('host', cardIds);
    } else {
        conn.send({ type: 'REQ_PLAY_PHASE', cardIds: cardIds });
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

    const cardId = myHand[selectedIndexes[0]].id;

    // Once discarded, clear drawn status / turn 
    if (role === 'host') {
        hostExecuteDiscard('host', cardId);
    } else {
        conn.send({ type: 'REQ_DISCARD', cardId: cardId });
        isMyTurn = false; // Optimistic lock
        drawnThisTurn = false; // Reset to ensure safe state
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
        let classes = `card ${card.color} `;
        if (selectedIndexes.includes(idx)) classes += 'selected ';
        if (card.id === lastDrawnCardId) classes += 'glow-green ';

        cEl.className = classes;
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
                const cardId = myHand[selectedIndexes[0]].id;
                const targetOwner = ownerId === 'host' ? role : (role === 'host' ? 'guest' : 'host');

                if (role === 'host') {
                    hostExecuteHit('host', cardId, targetOwner, groupIdx);
                } else {
                    conn.send({ type: 'REQ_HIT', cardId: cardId, targetPlayer: targetOwner, targetGroupIdx: groupIdx });
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

// --- Strict Phase 10 Validation & Grouping ---

function validateAndGroupPhase(cards, phaseId) {
    const rules = {
        1: ['s3', 's3'], 2: ['s3', 'r4'], 3: ['s4', 'r4'], 4: ['r7'], 5: ['r8'],
        6: ['r9'], 7: ['s4', 's4'], 8: ['c7'], 9: ['s5', 's2'], 10: ['s5', 's3']
    }[phaseId];

    let wilds = cards.filter(c => c.isWild);
    let normals = cards.filter(c => !c.isWild);

    const totalNeeded = rules.reduce((acc, r) => acc + parseInt(r.substring(1)), 0);
    if (cards.length !== totalNeeded) return null;

    function extractSet(poolWilds, poolNormals, size) {
        let valMap = {};
        poolNormals.forEach(c => { valMap[c.value] = (valMap[c.value] || []).concat(c); });

        let bestVal = -1, bestCount = -1;
        for (let v in valMap) {
            if (valMap[v].length > bestCount) { bestCount = valMap[v].length; bestVal = parseInt(v); }
        }

        let extracted = [], rNorms = [...poolNormals], rWilds = [...poolWilds];
        if (bestVal !== -1) {
            let matches = rNorms.filter(c => c.value === bestVal);
            extracted.push(...matches.slice(0, size));
            rNorms = rNorms.filter(c => !extracted.includes(c));
        }
        while (extracted.length < size && rWilds.length > 0) extracted.push(rWilds.pop());

        if (extracted.length === size) return { group: extracted, remW: rWilds, remN: rNorms };
        return null;
    }

    function extractRun(poolWilds, poolNormals, size) {
        for (let start = 1; start <= 13 - size; start++) {
            let extracted = [], rNorms = [...poolNormals], rWilds = [...poolWilds], success = true;
            for (let v = start; v < start + size; v++) {
                let idx = rNorms.findIndex(c => c.value === v);
                if (idx !== -1) {
                    extracted.push(rNorms.splice(idx, 1)[0]);
                } else if (rWilds.length > 0) {
                    extracted.push(rWilds.pop()); // Will be perfectly ordered inline!
                } else {
                    success = false; break;
                }
            }
            if (success) return { group: extracted, remW: rWilds, remN: rNorms };
        }
        return null;
    }

    function extractColor(poolWilds, poolNormals, size) {
        let colMap = {};
        poolNormals.forEach(c => { colMap[c.color] = (colMap[c.color] || []).concat(c); });

        let bestCol = null, bestCount = -1;
        for (let c in colMap) {
            if (colMap[c].length > bestCount) { bestCount = colMap[c].length; bestCol = c; }
        }

        let extracted = [], rNorms = [...poolNormals], rWilds = [...poolWilds];
        if (bestCol) {
            let matches = rNorms.filter(c => c.color === bestCol);
            extracted.push(...matches.slice(0, size));
            rNorms = rNorms.filter(c => !extracted.includes(c));
        }
        while (extracted.length < size && rWilds.length > 0) extracted.push(rWilds.pop());

        if (extracted.length === size) {
            extracted.sort((a, b) => (a.isWild ? 99 : a.value) - (b.isWild ? 99 : b.value));
            return { group: extracted, remW: rWilds, remN: rNorms };
        }
        return null;
    }

    let cW = wilds, cN = normals, groups = [];
    let sortedRules = [...rules].sort((a, b) => a[0] === 's' ? -1 : 1);

    for (let r of sortedRules) {
        let type = r[0], sz = parseInt(r.substring(1)), res = null;
        if (type === 's') res = extractSet(cW, cN, sz);
        else if (type === 'r') res = extractRun(cW, cN, sz);
        else if (type === 'c') res = extractColor(cW, cN, sz);

        if (!res) return null;
        groups.push(res.group);
        cW = res.remW; cN = res.remN;
    }

    if (cW.length === 0 && cN.length === 0) return groups;
    return null;
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

// Dev Test Button
if (btnDevNext) {
    btnDevNext.addEventListener('click', () => {
        if (role !== 'host') return;

        // Force complete phases for testing
        myPhaseCompletedThisRound = true;
        opponentPhaseCompletedThisRound = true;

        const hostPenalty = calculatePoints(myHand);
        const guestPenalty = calculatePoints(masterGuestHand);
        myTotalPoints += hostPenalty;
        opponentTotalPoints += guestPenalty;

        myPhaseLevel++;
        opponentPhaseLevel++;

        const summaryData = {
            winner: 'host', // dummy
            hostPhase: myPhaseLevel,
            guestPhase: opponentPhaseLevel,
            hostPenalty: hostPenalty,
            guestPenalty: guestPenalty,
            hostTotal: myTotalPoints,
            guestTotal: opponentTotalPoints
        };

        handleRoundOver(summaryData);
        conn.send({ type: 'ROUND_OVER', data: summaryData });
    });
}
