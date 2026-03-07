const ROWS = 6;
const COLS = 7;
let board = [];
let currentPlayer = 1; // 1 = Rot, 2 = Gelb
let gameActive = true;

const boardElement = document.getElementById('board');
const statusElement = document.getElementById('status');
const restartBtn = document.getElementById('restart-btn');

function initGame() {
  board = Array.from({ length: ROWS }, () => Array(COLS).fill(0));
  currentPlayer = 1;
  gameActive = true;
  updateStatus();
  renderBoard();
}

function renderBoard() {
  boardElement.innerHTML = '';
  // CSS Grid renderisiert Zeilen von oben nach unten, typisch für 4 Gewinnt
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.classList.add('cell');
      cell.dataset.row = r;
      cell.dataset.col = c;
      
      const token = document.createElement('div');
      token.classList.add('token');
      // ID for direct access later
      token.id = `token-${r}-${c}`;
      
      cell.appendChild(token);
      
      // Klick auf eine beliebige Zelle in der Spalte wirft den Chip in diese Spalte
      cell.addEventListener('click', () => handleColumnClick(c));
      
      boardElement.appendChild(cell);
    }
  }
}

function handleColumnClick(col) {
  if (!gameActive) return;
  
  // Finde die niedrigste freie Zeile in dieser Spalte (ROWS-1 ist unten!)
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === 0) {
      // Setze den Chip im logischen Board
      board[r][col] = currentPlayer;
      
      // Animiere den Chip-Fall im UI
      const token = document.getElementById(`token-${r}-${col}`);
      token.classList.add(currentPlayer === 1 ? 'player1' : 'player2', 'show');
      
      // Überprüfe Gewinnbedingung
      const winningCells = checkWin(r, col, currentPlayer);
      
      if (winningCells) {
        gameActive = false;
        highlightWinningCells(winningCells);
        statusElement.textContent = `Spieler ${currentPlayer} gewinnt! 🏆`;
        statusElement.className = `status player${currentPlayer}-text win-anim`;
      } else if (checkDraw()) {
        gameActive = false;
        statusElement.textContent = "Unentschieden! 🤝";
        statusElement.className = "status draw-text";
      } else {
        // Spielerwechsel
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        updateStatus();
      }
      return; 
    }
  }
}

function updateStatus() {
  statusElement.textContent = `Spieler ${currentPlayer} ist am Zug`;
  statusElement.className = `status player${currentPlayer}-text`;
}

function checkWin(row, col, player) {
  // Richtungen: [dRow, dCol]
  const directions = [
    [0, 1],  // Horizontal
    [1, 0],  // Vertikal
    [1, 1],  // Diagonal (unten-rechts nach oben-links)
    [1, -1]  // Diagonal (unten-links nach oben-rechts)
  ];
  
  for (const [dr, dc] of directions) {
    let count = 1;
    let cells = [[row, col]];
    
    // In positive Richtung prüfen
    for (let i = 1; i <= 3; i++) {
      const r = row + dr * i;
      const c = col + dc * i;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
        count++;
        cells.push([r, c]);
      } else {
        break;
      }
    }
    
    // In negative Richtung prüfen
    for (let i = 1; i <= 3; i++) {
      const r = row - dr * i;
      const c = col - dc * i;
      if (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === player) {
        count++;
        cells.push([r, c]);
      } else {
        break;
      }
    }
    
    if (count >= 4) {
      return cells; // Gib die gewinnenden Zellen zurück
    }
  }
  
  return null;
}

function checkDraw() {
  // Wenn die oberste Zeile voll ist, ist das Spielfeld voll
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

restartBtn.addEventListener('click', initGame);

// Starte das Spiel beim Laden der Seite
initGame();
