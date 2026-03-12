console.log("Schiffe versenken loaded!");

// DOM Elements
const screenModeSelection = document.getElementById('screen-mode-selection');
const screenPlacement = document.getElementById('screen-placement');
const screenBattle = document.getElementById('screen-battle');
const screenGameOver = document.getElementById('screen-game-over');

const btnModeNormal = document.getElementById('btn-mode-normal');
const btnModeVerrueckt = document.getElementById('btn-mode-verrueckt');
const btnRotate = document.getElementById('btn-rotate');
const btnResetPlacement = document.getElementById('btn-reset-placement');
const btnReady = document.getElementById('btn-ready');

const fleetContainer = document.getElementById('fleet-container');
const placementBoard = document.getElementById('placement-board');
const battlePlayerBoard = document.getElementById('battle-player-board');
const battleOpponentBoard = document.getElementById('battle-opponent-board');

const turnIndicator = document.getElementById('turn-indicator');
const winnerText = document.getElementById('winner-text');
const statusMessage = document.getElementById('status-message');
const roomBadge = document.getElementById('room-badge');
const powersUi = document.getElementById('powers-ui');
const verruecktPointsEl = document.getElementById('verrueckt-points');
const btnPowerMine = document.getElementById('btn-power-mine');
const mineStatusText = document.getElementById('mine-status-text');

// URL params and Multiplayer info
const urlParams = new URLSearchParams(window.location.search);
const isHost = urlParams.get('role') === 'host';
const roomCode = urlParams.get('room');

let peer = null;
let conn = null;

// Game State
let gameMode = null; // 'normal' or 'verrueckt'
let myBoard = Array(100).fill(null).map(() => ({ isShip: false, isHit: false, isMiss: false, shipId: -1 }));
let opponentBoardState = Array(100).fill(null).map(() => ({ isHit: false, isMiss: false }));

let shipsToPlace = []; // { id, name, shape: [{x, y}], placed: false }
let placedShipsCount = 0;
let selectedShipId = null;
let currentRotation = 0; // 0: 0°, 1: 90°, 2: 180°, 3: 270°

let isMyTurn = isHost; // Host gets the first turn
let opponentReady = false;
let myReady = false;
let gameStarted = false;
let myHealth = 0; // total ship cells
let opponentHealth = 0;

// Verrückt Mode Powers
let verruecktPoints = 0;
let placingMine = false;
let opponentShipHits = {}; // Track opponent ships to detect when they are sunk (we don't know IDs initially, so we just track total health for win condition, but we need ID for sunk state)
// Actually we can't track opponent's exact ship visually until it's fully sunk, unless they tell us.
// We will rely on opposite side telling us "You sunk my ship X".

// Ship Definitions
const shipDefsNormal = [
    { name: "Schlachtschiff", length: 5 },
    { name: "Kreuzer", length: 4 },
    { name: "Zerstörer", length: 3 },
    { name: "U-Boot", length: 3 },
    { name: "Patrouillenboot", length: 2 }
];

const shipDefsVerrueckt = [
    { name: "U-Form", shape: [{x:0,y:0}, {x:0,y:1}, {x:1,y:1}, {x:2,y:1}, {x:2,y:0}] },
    { name: "L-Form", shape: [{x:0,y:0}, {x:0,y:1}, {x:0,y:2}, {x:1,y:2}] },
    { name: "T-Form", shape: [{x:0,y:0}, {x:1,y:0}, {x:2,y:0}, {x:1,y:1}] },
    { name: "Quadrat", shape: [{x:0,y:0}, {x:1,y:0}, {x:0,y:1}, {x:1,y:1}] },
    { name: "Z-Form", shape: [{x:0,y:0}, {x:1,y:0}, {x:1,y:1}, {x:2,y:1}] }
];

// Helper to convert linear length to shape array
function lengthToShape(length) {
    let shape = [];
    for(let i=0; i<length; i++) shape.push({x: i, y: 0});
    return shape;
}

// Applies rotation matrix for right angles
function rotateShape(shape, rotation) {
    return shape.map(part => {
        let x = part.x;
        let y = part.y;
        if (rotation === 1) return { x: -y, y: x };
        if (rotation === 2) return { x: -x, y: -y };
        if (rotation === 3) return { x: y, y: -x };
        return { x, y };
    });
}

// GUI switching
function showScreen(screen) {
    screenModeSelection.classList.add('hidden');
    screenPlacement.classList.add('hidden');
    screenBattle.classList.add('hidden');
    screenGameOver.classList.add('hidden');
    if(screen) screen.classList.remove('hidden');
}

// Initialization
function init() {
    roomBadge.textContent = `Room: ${roomCode || 'Offline'} | Role: ${isHost ? 'Host' : 'Guest'}`;
    
    if (roomCode) {
        initMultiplayer();
    } else {
        // Offline Test Mode
        statusMessage.textContent = "Offline Modus";
        if (isHost) {
            showScreen(screenModeSelection);
        } else {
            statusMessage.textContent = "Warte auf Modusauswahl des Hosts...";
        }
    }

    createGrids();
    setupEventListeners();
}

function createGrids() {
    // Generate 100 cells for all 3 boards
    [placementBoard, battlePlayerBoard, battleOpponentBoard].forEach(board => {
        board.innerHTML = '';
        for (let i = 0; i < 100; i++) {
            let cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.index = i;
            if (board === placementBoard) {
                cell.addEventListener('mouseover', handlePlacementHover);
                // Also trigger hover on click in case someone uses touch
                cell.addEventListener('click', handlePlacementClick);
            } else if (board === battleOpponentBoard) {
                cell.addEventListener('click', handleAttackClick);
            }
            board.appendChild(cell);
        }
    });
}

function setupEventListeners() {
    btnModeNormal.addEventListener('click', () => selectMode('normal'));
    btnModeVerrueckt.addEventListener('click', () => selectMode('verrueckt'));
    
    btnRotate.addEventListener('click', () => {
        currentRotation = (currentRotation + 1) % 4;
    });

    // Keyboard rotation shortcut
    document.addEventListener('keydown', (e) => {
        if ((e.key.toLowerCase() === 'r' || e.key === ' ') && !screenPlacement.classList.contains('hidden')) {
            currentRotation = (currentRotation + 1) % 4;
        }
    });

    btnResetPlacement.addEventListener('click', resetPlacement);
    btnReady.addEventListener('click', handleReady);
    
    // Powers
    btnPowerMine.addEventListener('click', () => {
        if(verruecktPoints >= 3 && isMyTurn) {
            placingMine = !placingMine;
            if(placingMine) {
                btnPowerMine.classList.add('active');
                mineStatusText.style.display = 'block';
                battlePlayerBoard.classList.add('placing-mine');
                // Temporarily disable attack board
                battleOpponentBoard.classList.add('disabled');
            } else {
                cancelMinePlacement();
            }
        }
    });
    
    // Listen for clicks on player board during battle (for mine placement)
    battlePlayerBoard.addEventListener('click', (e) => {
        if(placingMine && e.target.classList.contains('cell')) {
            let index = parseInt(e.target.dataset.index);
            if(!myBoard[index].isShip && !myBoard[index].isHit && !myBoard[index].isMiss && !myBoard[index].isMine) {
                placeMine(index);
            }
        }
    });
}

function cancelMinePlacement() {
    placingMine = false;
    btnPowerMine.classList.remove('active');
    mineStatusText.style.display = 'none';
    battlePlayerBoard.classList.remove('placing-mine');
    updateTurnIndicator(); // restore board states
}

function resetPlacement() {
    myBoard.forEach(c => { c.isShip = false; c.shipId = -1; });
    placedShipsCount = 0;
    selectedShipId = null;
    shipsToPlace.forEach(s => s.placed = false);
    btnReady.classList.add('hidden');
    
    // Clear UI
    Array.from(placementBoard.children).forEach(c => {
        c.className = 'cell';
    });
    renderFleetContainer();
}

// ------ Mode Selection ------
function selectMode(modeName) {
    gameMode = modeName;
    if (conn) {
        conn.send({ type: 'MODE_SELECTED', mode: modeName });
    }
    startPlacementPhase();
}

function startPlacementPhase() {
    shipsToPlace = [];
    myHealth = 0;
    if (gameMode === 'normal') {
        shipDefsNormal.forEach((def, id) => {
            shipsToPlace.push({ id, name: def.name, shape: lengthToShape(def.length), placed: false });
            myHealth += def.length;
        });
    } else {
        shipDefsVerrueckt.forEach((def, id) => {
            shipsToPlace.push({ id, name: def.name, shape: def.shape, placed: false });
            myHealth += def.shape.length;
        });
    }

    opponentHealth = myHealth; // Identical modes, health will be identical

    renderFleetContainer();
    statusMessage.textContent = "Platziere deine Schiffe!";
    showScreen(screenPlacement);
}

function renderFleetContainer() {
    fleetContainer.innerHTML = '<h3>Deine Flotte</h3><p style="font-size: 0.8rem; color: #a1a1aa; margin-bottom: 1rem;">Wähle ein Schiff aus zum Platzieren</p>';
    shipsToPlace.forEach(ship => {
        let el = document.createElement('div');
        el.className = 'ship-preview';
        if (ship.placed) el.classList.add('placed');
        if (ship.id === selectedShipId) el.classList.add('selected');
        
        let label = document.createElement('div');
        label.style.gridColumn = '1 / -1';
        label.style.fontWeight = '600';
        label.style.marginBottom = '5px';
        label.textContent = ship.name;
        el.appendChild(label);

        // draw mini shape
        let minX = 0, minY = 0, maxX = 0, maxY = 0;
        ship.shape.forEach(p => {
            if(p.x < minX) minX = p.x; if(p.x > maxX) maxX = p.x;
            if(p.y < minY) minY = p.y; if(p.y > maxY) maxY = p.y;
        });
        
        el.style.gridTemplateColumns = `repeat(${maxX - minX + 1}, 20px)`;
        el.style.gridTemplateRows = `auto repeat(${maxY - minY + 1}, 20px)`; 

        ship.shape.forEach(p => {
            let part = document.createElement('div');
            part.className = 'part';
            part.style.gridColumn = (p.x - minX + 1);
            // +1 for row 1 being the title label layout, so row 2 starts the grid
            part.style.gridRow = (p.y - minY + 2);
            el.appendChild(part);
        });

        el.addEventListener('click', () => {
            if (!ship.placed) {
                selectedShipId = ship.id;
                currentRotation = 0;
                renderFleetContainer();
            }
        });

        fleetContainer.appendChild(el);
    });
}

// ------ Placement Logic ------
function getAbsoluteCoords(originIndex, shape, rotation) {
    const originX = originIndex % 10;
    const originY = Math.floor(originIndex / 10);
    const rotatedShape = rotateShape(shape, rotation);
    
    let coords = [];
    for (let part of rotatedShape) {
        let absX = originX + part.x;
        let absY = originY + part.y;
        
        if (absX < 0 || absX >= 10 || absY < 0 || absY >= 10) return null; // Shape goes out of bounds
        
        let idx = absY * 10 + absX;
        coords.push(idx);
    }
    return coords;
}

function handlePlacementHover(e) {
    if (!e.target.classList.contains('cell')) return;
    
    // Remove old hover states
    Array.from(placementBoard.children).forEach(c => {
        c.classList.remove('hover-valid', 'hover-invalid');
    });

    if (selectedShipId === null) return;
    let ship = shipsToPlace.find(s => s.id === selectedShipId);
    if (!ship || ship.placed) return;

    let index = parseInt(e.target.dataset.index);
    let coords = getAbsoluteCoords(index, ship.shape, currentRotation);

    if (coords) {
        // Validate no overlap
        let isValid = coords.every(i => !myBoard[i].isShip);
        coords.forEach(i => {
            if (placementBoard.children[i]) {
                placementBoard.children[i].classList.add(isValid ? 'hover-valid' : 'hover-invalid');
            }
        });
    } else {
        // Just highlight origin cell invalid if completely out of bounds
        e.target.classList.add('hover-invalid');
    }
}

function handlePlacementClick(e) {
    if (!e.target.classList.contains('cell')) return;
    
    if (selectedShipId === null) return;
    let ship = shipsToPlace.find(s => s.id === selectedShipId);
    if (!ship || ship.placed) return;

    let index = parseInt(e.target.dataset.index);
    let coords = getAbsoluteCoords(index, ship.shape, currentRotation);

    if (coords && coords.every(i => !myBoard[i].isShip)) {
        // Place the ship permanently
        coords.forEach(i => {
            myBoard[i].isShip = true;
            myBoard[i].shipId = ship.id;
            placementBoard.children[i].classList.add('ship');
        });
        
        // Remove hover effects immediately
        Array.from(placementBoard.children).forEach(c => c.classList.remove('hover-valid', 'hover-invalid'));
        
        ship.placed = true;
        placedShipsCount++;
        
        // Auto-select next unplaced ship
        let nextUnplaced = shipsToPlace.find(s => !s.placed);
        selectedShipId = nextUnplaced ? nextUnplaced.id : null;
        currentRotation = 0;
        
        renderFleetContainer();

        if (placedShipsCount === shipsToPlace.length) {
            btnReady.classList.remove('hidden');
        }
    }
}

// ------ Battle Phase ------
function handleReady() {
    myReady = true;
    btnReady.classList.add('hidden');
    statusMessage.textContent = "Warte auf Gegner...";
    btnResetPlacement.classList.add('hidden');
    
    if (conn) {
        conn.send({ type: 'READY', health: myHealth });
    } else {
        opponentReady = true; // Automatically ready in offline mode
    }

    checkStartBattle();
}

function checkStartBattle() {
    if (myReady && opponentReady) {
        gameStarted = true;
        // Copy placement board layout to the battle screen player board
        for (let i = 0; i < 100; i++) {
            if (myBoard[i].isShip) {
                battlePlayerBoard.children[i].classList.add('ship');
            }
        }
        
        if(gameMode === 'verrueckt') {
            powersUi.classList.remove('hidden');
            updatePointsUi();
        } else {
            powersUi.classList.add('hidden');
        }
        
        showScreen(screenBattle);
        statusMessage.textContent = "Gefecht aktiv!";
        updateTurnIndicator();
    }
}

function updatePointsUi() {
    verruecktPointsEl.textContent = verruecktPoints;
    if(verruecktPoints >= 3) {
        btnPowerMine.classList.add('ready');
    } else {
        btnPowerMine.classList.remove('ready');
        if(placingMine) cancelMinePlacement();
    }
}

function placeMine(index) {
    verruecktPoints -= 3;
    myBoard[index].isMine = true;
    battlePlayerBoard.children[index].classList.add('mine');
    updatePointsUi();
    cancelMinePlacement();
    
    // Placing a mine ends your turn
    isMyTurn = false;
    updateTurnIndicator();
    if(conn) conn.send({ type: 'MINE_PLACED', index: index });
}

function updateTurnIndicator() {
    if(!gameStarted) return;
    if (isMyTurn) {
        turnIndicator.textContent = "Du bist am Zug!";
        turnIndicator.style.background = "var(--accent-green)";
        if(!placingMine) battleOpponentBoard.classList.remove('disabled');
    } else {
        turnIndicator.textContent = "Gegner zielt...";
        turnIndicator.style.background = "var(--accent-red)";
        battleOpponentBoard.classList.add('disabled');
        cancelMinePlacement();
    }
}

function handleAttackClick(e) {
    if (!gameStarted || !isMyTurn || placingMine) return;
    if (!e.target.classList.contains('cell')) return;
    
    let index = parseInt(e.target.dataset.index);
    if (opponentBoardState[index].isHit || opponentBoardState[index].isMiss) return; // Ignore already attacked cells

    // Optimistically disable turning logic
    isMyTurn = false;
    updateTurnIndicator();

    if (conn) {
        conn.send({ type: 'SHOT', index: index });
    } else {
        // Offline test mode: Always Miss to simulate response
        receiveShotResult(index, false, false, [], false, null);
    }
}

function receiveShotResult(index, isHit, isSunk = false, sunkCoords = [], isMineHit = false, randomShotIndex = null) {
    let cell = battleOpponentBoard.children[index];
    
    if (isMineHit) {
        // We hit a mine!
        cell.classList.add('mine', 'hit'); // Visual for hitting mine
        opponentBoardState[index].isHit = true;
        
        // Let's visualize the random shot hitting us
        if(randomShotIndex !== null) {
            statusMessage.textContent = "💥 Mine getroffen! Feindlicher Gegenfeuerschlag!";
            statusMessage.style.color = "var(--accent-red)";
            setTimeout(() => {
                statusMessage.style.color = "";
                statusMessage.textContent = "Gefecht aktiv!";
                handleIncomingShot(randomShotIndex);
            }, 1000);
        }
        // Our turn is immediately over
        isMyTurn = false;
        updateTurnIndicator();
        return;
    }
    
    if (isHit) {
        opponentBoardState[index].isHit = true;
        cell.classList.add('hit');
        opponentHealth--;
        
        if (isSunk) {
            sunkCoords.forEach(c => {
                battleOpponentBoard.children[c].classList.add('sunk');
            });
        }
        
        // Player gets another turn if they hit
        isMyTurn = true; 
    } else {
        opponentBoardState[index].isMiss = true;
        cell.classList.add('miss');
        // Player's turn is over
    }
    
    checkWinCondition();
    if (!gameStarted) return; // Ensure turn indicator isn't updated if game is over
    updateTurnIndicator();
}

function handleIncomingShot(index) {
    if(myBoard[index].isMine) {
        // They hit a mine!
        myBoard[index].isHit = true; // Mine explodes
        battlePlayerBoard.children[index].classList.add('hit');
        
        // Calculate random shot back
        let availableTargets = opponentBoardState
            .map((b, i) => (!b.isHit && !b.isMiss) ? i : -1)
            .filter(i => i !== -1);
            
        let randomShotIndex = availableTargets.length > 0 
            ? availableTargets[Math.floor(Math.random() * availableTargets.length)] 
            : null;
            
        if (conn) {
            conn.send({ type: 'SHOT_RESULT', index: index, hit: false, isMineHit: true, randomShotIndex: randomShotIndex });
            // Let the opponent's receiveShotResult trigger the actual shot back against themselves
        }
        isMyTurn = true;
        updateTurnIndicator();
        return;
    }
    
    let isHit = myBoard[index].isShip;
    let cell = battlePlayerBoard.children[index];
    let isSunk = false;
    let sunkCoords = [];
    
    if (isHit) {
        myBoard[index].isHit = true;
        cell.classList.add('hit');
        myHealth--;
        
        // Check if sunk
        let shipId = myBoard[index].shipId;
        let coordsOfShip = myBoard.map((c, i) => c.shipId === shipId ? i : -1).filter(i => i !== -1);
        isSunk = coordsOfShip.every(i => myBoard[i].isHit);
        
        if (isSunk) {
            sunkCoords = coordsOfShip;
            coordsOfShip.forEach(i => battlePlayerBoard.children[i].classList.add('sunk'));
        }
        
        // Opponent gets another turn, my turn remains false
        
        if(gameMode === 'verrueckt') {
            verruecktPoints += isSunk ? 2 : 1;
            updatePointsUi();
        }
        
    } else {
        myBoard[index].isMiss = true;
        cell.classList.add('miss');
        // Opponent missed, my turn now
        isMyTurn = true; 
    }
    
    if (conn) {
        conn.send({ type: 'SHOT_RESULT', index: index, hit: isHit, isSunk: isSunk, sunkCoords: sunkCoords });
    }
    
    checkWinCondition();
    if (!gameStarted) return;
    updateTurnIndicator();
}

function checkWinCondition() {
    if (opponentHealth <= 0) {
        gameStarted = false;
        showScreen(screenGameOver);
        winnerText.textContent = "DU HAST GEWONNEN! 🎉";
        winnerText.style.background = "linear-gradient(135deg, #fff 20%, var(--accent-green) 100%)";
        winnerText.style.webkitBackgroundClip = "text";
        statusMessage.textContent = "Spiel beendet.";
    } else if (myHealth <= 0) {
        gameStarted = false;
        showScreen(screenGameOver);
        winnerText.textContent = "VERLOREN! 💥";
        winnerText.style.background = "linear-gradient(135deg, #fff 20%, var(--accent-red) 100%)";
        winnerText.style.webkitBackgroundClip = "text";
        statusMessage.textContent = "Spiel beendet.";
    }
}

// ------ Multiplayer Implementation ------
function initMultiplayer() {
    statusMessage.textContent = "Verbinde...";
    peer = new Peer(`koscher9-sv-${roomCode}-${isHost ? 'host' : 'guest'}`);

    peer.on('open', (id) => {
        if (isHost) {
            statusMessage.textContent = "Warte auf Mitspieler...";
            // Host waits for guest to connect to their ID
            peer.on('connection', (connection) => {
                conn = connection;
                setupConnection();
                statusMessage.textContent = "Mitspieler verbunden!";
                showScreen(screenModeSelection);
            });
        } else {
            // Guest connecting to host ID
            conn = peer.connect(`koscher9-sv-${roomCode}-host`);
            conn.on('open', () => {
                setupConnection();
                statusMessage.textContent = "Verbinde... Warte auf Modus-Auswahl des Hosts.";
                showScreen(null); // Keep a generic loading state
            });
            conn.on('error', err => {
                statusMessage.textContent = "Fehler bei der Verbindung zum Host.";
            });
        }
    });

    peer.on('error', (err) => {
        console.error(err);
        statusMessage.textContent = "Verbindungsfehler: " + err.type;
    });
}

function setupConnection() {
    conn.on('data', (data) => {
        console.log("Received data:", data);
        if (data.type === 'MODE_SELECTED') {
            gameMode = data.mode;
            startPlacementPhase();
        } else if (data.type === 'READY') {
            opponentReady = true;
            checkStartBattle();
        } else if (data.type === 'SHOT') {
            handleIncomingShot(data.index);
        } else if (data.type === 'SHOT_RESULT') {
            receiveShotResult(data.index, data.hit, data.isSunk, data.sunkCoords, data.isMineHit, data.randomShotIndex);
        } else if (data.type === 'MINE_PLACED') {
            // Track opponent placed a mine, no specific logic needed except knowing they spent a turn
            isMyTurn = true;
            updateTurnIndicator();
        }
    });
}

// Start sequence
init();
