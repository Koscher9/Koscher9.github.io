const ROWS = 6;
const COLS = 7;
let board = [];
let currentPlayer = 1; // 1 = Rot, 2 = Gelb
let gameActive = true;

const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const restartBtn = document.getElementById('restart-btn');
const connectionOverlay = document.getElementById('connection-overlay');
const connStatus = document.getElementById('conn-status');

// Multiplayer Setup
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('room');
const role = urlParams.get('role'); // 'host' or 'guest'

let peer = null;
let conn = null;
let myPlayerId = 1;

if (roomCode && role) {
    if (connectionOverlay) connectionOverlay.style.display = 'flex';
    myPlayerId = role === 'host' ? 1 : 2;

    if (role === 'host') {
        peer = new Peer(`koscher9-game-c4-${roomCode}`);
        if (connStatus) connStatus.textContent = `Warte auf Gegner...`;

        peer.on('connection', (connection) => {
            conn = connection;
            setupConnection();
        });
        peer.on('error', (err) => {
            if (connStatus) {
                connStatus.textContent = "Fehler: " + err.type;
                connStatus.style.color = "red";
            }
        });
    } else {
        // Guest
        peer = new Peer();
        peer.on('open', () => {
            if (connStatus) connStatus.textContent = "Verbinde zum Host...";
            conn = peer.connect(`koscher9-game-c4-${roomCode}`);
            setupConnection();
        });
        peer.on('error', (err) => {
            if (connStatus) {
                connStatus.textContent = "Verbindungsfehler: " + err.type;
                connStatus.style.color = "red";
            }
        });
    }
}

function setupConnection() {
    conn.on('open', () => {
        if (connectionOverlay) connectionOverlay.style.display = 'none';
        initGame();
    });

    conn.on('data', (data) => {
        if (data.type === 'MOVE') {
            applyMoveLocally(data.col);
        } else if (data.type === 'RESTART') {
            initGame();
        }
    });

    conn.on('close', () => {
        if (connectionOverlay) connectionOverlay.style.display = 'flex';
        if (connStatus) {
            connStatus.textContent = "Verbindung getrennt. Gegner hat das Spiel verlassen.";
            connStatus.style.color = "red";
        }
    });
}

function initGame() {
    board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
    currentPlayer = 1;
    gameActive = true;
    updateStatus();
    renderBoard();
}

function renderBoard() {
    boardElement.innerHTML = '';
    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.row = r;
            cell.dataset.col = c;

            const token = document.createElement('div');
            token.classList.add('token');
            token.id = `token-${r}-${c}`;

            cell.appendChild(token);
            cell.addEventListener('click', () => handleColumnClick(c));

            boardElement.appendChild(cell);
        }
    }
}

function handleColumnClick(col) {
    if (!gameActive) return;

    // Reject move if it's multiplayer and not our turn
    if (conn && conn.open && currentPlayer !== myPlayerId) {
        return;
    }

    for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][col] === 0) {
            if (conn && conn.open && currentPlayer === myPlayerId) {
                conn.send({ type: 'MOVE', col: col });
            }
            applyMoveToBoard(r, col);
            return;
        }
    }
}

function applyMoveLocally(col) {
    if (!gameActive) return;
    for (let r = ROWS - 1; r >= 0; r--) {
        if (board[r][col] === 0) {
            applyMoveToBoard(r, col);
            return;
        }
    }
}

function applyMoveToBoard(r, col) {
    board[r][col] = currentPlayer;

    const token = document.getElementById(`token-${r}-${col}`);
    token.classList.add(currentPlayer === 1 ? 'player1' : 'player2', 'show');

    const winningCells = checkWin(r, col, currentPlayer);

    if (winningCells) {
        gameActive = false;
        highlightWinningCells(winningCells);
        if (conn) {
            statusElement.textContent = currentPlayer === myPlayerId ? "Du gewinnst! 🏆" : "Gegner gewinnt! 🏆";
        } else {
            statusElement.textContent = `Spieler ${currentPlayer} gewinnt! 🏆`;
        }
        statusElement.className = `status player${currentPlayer}-text win-anim`;
    } else if (checkDraw()) {
        gameActive = false;
        statusElement.textContent = "Unentschieden! 🤝";
        statusElement.className = "status draw-text";
    } else {
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        updateStatus();
    }
}

function updateStatus() {
    if (conn) {
        statusElement.textContent = currentPlayer === myPlayerId ? "Du bist am Zug" : "Gegner ist am Zug";
    } else {
        statusElement.textContent = `Spieler ${currentPlayer} ist am Zug`;
    }
    statusElement.className = `status player${currentPlayer}-text`;
}

function checkWin(row, col, player) {
    const directions = [
        [0, 1],
        [1, 0],
        [1, 1],
        [1, -1]
    ];

    for (const [dr, dc] of directions) {
        let count = 1;
        let cells = [[row, col]];

        for (let i = 1; i <= 3; i++) {
            const r = row + dr * i;
            const c = col + dc * i;
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
                count++;
                cells.push([r, c]);
            } else break;
        }

        for (let i = 1; i <= 3; i++) {
            const r = row - dr * i;
            const c = col - dc * i;
            if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
                count++;
                cells.push([r, c]);
            } else break;
        }

        if (count >= 4) return cells;
    }
    return null;
}

function checkDraw() {
    for (let c = 0; c < COLS; c++) {
        if (board[0][c] === 0) return false;
    }
    return true;
}

function highlightWinningCells(cells) {
    for (const [r, c] of cells) {
        const token = document.getElementById(`token-${r}-${c}`);
        if (token && token.parentElement) {
            token.parentElement.classList.add('winning-cell');
        }
    }
}

restartBtn.addEventListener('click', () => {
    if (conn && conn.open) {
        conn.send({ type: 'RESTART' });
    }
    initGame();
});

// Avoid early init if multiplayer is loading
if (!roomCode) {
    initGame();
}
