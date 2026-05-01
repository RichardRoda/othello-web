// www/main.js

import init, { OthelloGame, get_ai_move } from './othello_web.js';

// ── Constants ───────────────────────────────────────────────────
const VALID_DEPTHS = new Set([2, 3, 5, 7, 10]);
const AI_FALLBACK_DEPTH = 3;  // Used when all workers fail

function getAiDepth() {
    const val = parseInt(document.getElementById('difficulty')?.value, 10);
    return VALID_DEPTHS.has(val) ? val : 2;
}

// ── Worker pool ──────────────────────────────────────────────────
const NUM_WORKERS = navigator.hardwareConcurrency || 4;
const workers = Array.from({ length: NUM_WORKERS }, () => new Worker('./worker.js', { type: 'module' }));

const canShareMemory = typeof SharedArrayBuffer !== 'undefined';

// Pack a float64 into the BigInt64 bit pattern that Atomics can handle.
function floatToBits(f) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, f);
    return new DataView(buf).getBigInt64(0);
}


// Pre-warm all workers: send an init message so WASM loads before the first move
const workerReady = Promise.all(
    workers.map(worker => new Promise(resolve => {
        const handler = ({ data }) => {
            if (data.type === 'ready') {
                worker.removeEventListener('message', handler);
                resolve();
            }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'init' });
    }))
);

// ── Game state ───────────────────────────────────────────────────
let wasmGame = null;       // OthelloGame WASM instance
let humanColor = null;     // "Black" or "White"
let gameActive = false;
let aiDepth = 2;

// ── DOM elements ─────────────────────────────────────────────────
const screenSelect = document.getElementById('screen-select');
const screenGame   = document.getElementById('screen-game');
const screenOver   = document.getElementById('screen-over');
const canvas       = document.getElementById('board-canvas');
const ctx          = canvas.getContext('2d');
const scoreBlack   = document.getElementById('score-black');
const scoreWhite   = document.getElementById('score-white');
const aiEmojiEl    = document.getElementById('ai-emoji');
const statusText   = document.getElementById('status-text');
const resultText   = document.getElementById('result-text');
const finalScore   = document.getElementById('final-score');

// ── Screen transitions ───────────────────────────────────────────
function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
}

// ── Canvas board rendering ────────────────────────────────────────
function getBoardSize() {
    return canvas.getBoundingClientRect().width; // CSS controls size; canvas always square
}

function resizeCanvas() {
    const size = getBoardSize();
    canvas.width  = size;
    canvas.height = size;
}

function drawBoard(board, validMoves, isHumanTurn) {
    resizeCanvas();
    const size = canvas.width;
    const cell = size / 8;

    ctx.fillStyle = '#1a6b2a';
    ctx.fillRect(0, 0, size, size);

    // Draw grid
    ctx.strokeStyle = '#145222';
    ctx.lineWidth = 2;
    for (let i = 1; i < 8; i++) {
        const pos = i * cell;
        ctx.beginPath();
        ctx.moveTo(pos, 0);
        ctx.lineTo(pos, size);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, pos);
        ctx.lineTo(size, pos);
        ctx.stroke();
    }

    // Draw pieces
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const x = col * cell + cell / 2;
            const y = row * cell + cell / 2;
            const radius = cell * 0.4;

            if (board.grid[row][col] === 'Black') {
                ctx.fillStyle = '#000';
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
                ctx.fill();
            } else if (board.grid[row][col] === 'White') {
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, 2 * Math.PI);
                ctx.fill();
            }
        }
    }

    // Draw valid move indicators (dots) if it's human's turn
    if (isHumanTurn && validMoves) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        for (const { row, col } of validMoves) {
            const x = col * cell + cell / 2;
            const y = row * cell + cell / 2;
            ctx.beginPath();
            ctx.arc(x, y, cell * 0.1, 0, 2 * Math.PI);
            ctx.fill();
        }
    }
}

function updateScoreBar() {
    const score = JSON.parse(wasmGame.get_score());
    scoreBlack.textContent = `Black: ${score.black}`;
    scoreWhite.textContent = `White: ${score.white}`;
}

function setStatus(msg) {
    statusText.textContent = msg;
}

function setAiEmoji(score) {
    if (score === Infinity)       aiEmojiEl.textContent = '😄';
    else if (score === -Infinity) aiEmojiEl.textContent = '😢';
    else                          aiEmojiEl.textContent = '';
}

// ── Turn management ───────────────────────────────────────────────
function isHumanTurn() {
    return wasmGame.get_current_player() === humanColor;
}

function renderGameScreen(highlightMoves) {
    const board      = JSON.parse(wasmGame.get_board());
    const validMoves = highlightMoves ? JSON.parse(wasmGame.get_valid_moves()) : null;
    drawBoard(board, validMoves, highlightMoves);
    updateScoreBar();
}

async function runAiTurn() {
    setStatus('Thinking...');
    renderGameScreen(false); // no highlights while AI thinks

    const aiMove = await getAiMove(wasmGame);
    if (aiMove) {
        wasmGame.make_move(aiMove.move.row, aiMove.move.col);
        setAiEmoji(aiMove.score);
    }

    await advanceTurn();
}

async function advanceTurn() {
    if (wasmGame.get_game_state() === 'GameOver') {
        showGameOver();
        return;
    }

    renderGameScreen(true); // show valid moves

    if (!isHumanTurn()) {
        await runAiTurn();
    } else {
        setStatus('Your turn');
    }
}

// ── Game over ─────────────────────────────────────────────────────
function showGameOver() {
    gameActive = false;
    const winner = wasmGame.get_winner();
    const score = JSON.parse(wasmGame.get_score());

    if (winner === null) {
        resultText.textContent = 'Draw!';
    } else if (winner === humanColor) {
        resultText.textContent = 'You win!';
    } else {
        resultText.textContent = 'Computer wins!';
    }

    finalScore.textContent = `Final score: Black ${score.black} - White ${score.white}`;
    showScreen('screen-over');
}

// ── Human input: click and touch ──────────────────────────────────
function handleBoardInput(x, y) {
    if (!gameActive || !isHumanTurn()) return;

    const rect = canvas.getBoundingClientRect();
    const size = rect.width;
    const cell = size / 8;
    const col = Math.floor((x - rect.left) / cell);
    const row = Math.floor((y - rect.top) / cell);

    if (row >= 0 && row < 8 && col >= 0 && col < 8) {
        try {
            wasmGame.make_move(row, col);
            advanceTurn();
        } catch (e) {
            // Invalid move, ignore
        }
    }
}

canvas.addEventListener('click', e => handleBoardInput(e.clientX, e.clientY));
canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    const t = e.touches[0];
    handleBoardInput(t.clientX, t.clientY);
}, { passive: false });

// ── Worker helpers ────────────────────────────────────────────────
function partition(arr, n) {
    const count = Math.min(n, arr.length);
    const chunks = Array.from({ length: count }, () => []);
    arr.forEach((item, i) => chunks[i % count].push(item));
    return chunks;
}

function dispatchWorker(worker, payload, timeoutMs) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            worker.removeEventListener('message', handler);
            worker.removeEventListener('error', errorHandler);
            resolve(null);
        }, timeoutMs);

        const handler = ({ data }) => {
            clearTimeout(timer);
            worker.removeEventListener('message', handler);
            worker.removeEventListener('error', errorHandler);
            resolve(data);
        };

        const errorHandler = (e) => {
            clearTimeout(timer);
            worker.removeEventListener('message', handler);
            worker.removeEventListener('error', errorHandler);
            console.error('Worker error:', e.message);
            resolve(null);
        };

        worker.addEventListener('message', handler);
        worker.addEventListener('error', errorHandler);
        worker.postMessage(payload);
    });
}

// Heuristic priority for root move ordering: corners > edges > interior > X-squares.
// Mirrors what the Rust minimax does internally so alpha rises fast and pruning is effective.
function rootMoveScore({ row, col }) {
    const isCorner  = (row === 0 || row === 7) && (col === 0 || col === 7);
    const isXSquare = (row === 1 || row === 6) && (col === 1 || col === 6);
    const isEdge    = row === 0 || row === 7 || col === 0 || col === 7;
    if (isCorner)  return 3;
    if (isEdge)    return 2;
    if (isXSquare) return 0;
    return 1;
}

async function getAiMove(game) {
    const validMoves = JSON.parse(game.get_valid_moves());
    if (validMoves.length === 0) return null;

    // Order best moves first so alpha rises quickly across workers.
    const orderedMoves = [...validMoves].sort((a, b) => rootMoveScore(b) - rootMoveScore(a));

    const gameJson = game.to_json();
    const activeWorkers = Math.min(NUM_WORKERS, orderedMoves.length);
    const chunks = partition(orderedMoves, activeWorkers);
    const timeoutMs = aiDepth * 15_000;

    let sharedAlpha = null;
    if (canShareMemory) {
        const sab = new SharedArrayBuffer(8);
        sharedAlpha = new BigInt64Array(sab);
        Atomics.store(sharedAlpha, 0, floatToBits(-Infinity));
    }

    const promises = chunks.map((chunk, i) =>
        dispatchWorker(workers[i], {
            gameJson,
            moves: chunk,
            depth: aiDepth,
            sharedAlpha,
        }, timeoutMs)
    );

    const results = await Promise.all(promises);
    const valid = results.filter(r => r !== null && r.move !== null);

    if (valid.length === 0) {
        // All workers failed — synchronous fallback at reduced depth
        console.warn('All workers failed, using synchronous fallback');
        return fallbackAiMove(game, orderedMoves);
    }

    return valid.reduce((best, r) => r.score > best.score ? r : best);
}

function fallbackAiMove(game, validMoves) {
    let best = null;
    for (const { row, col } of validMoves) {
        const score = get_ai_move(game.to_json(), AI_FALLBACK_DEPTH, row, col, -Infinity);
        if (!best || score > best.score) {
            best = { move: { row, col }, score };
        }
    }
    return best;
}

// ── Startup ───────────────────────────────────────────────────────
async function main() {
    // Initialise WASM module on the main thread (for fallback get_ai_move)
    await init();

    // Wait for workers to be ready
    await workerReady;

    // Set up event listeners
    document.getElementById('btn-black').addEventListener('click', () => startGame('Black'));
    document.getElementById('btn-white').addEventListener('click', () => startGame('White'));
    document.getElementById('btn-play-again').addEventListener('click', () => location.reload());

    showScreen('screen-select');
}

async function startGame(color) {
    wasmGame   = new OthelloGame();
    humanColor = color;
    gameActive = true;
    aiDepth    = getAiDepth();
    aiEmojiEl.textContent = '';

    showScreen('screen-game');
    renderGameScreen(true);

    if (humanColor === 'White') {
        // AI (Black) moves first
        await runAiTurn();
    } else {
        setStatus('Your turn');
    }
}

main().catch(console.error);

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js');
}
