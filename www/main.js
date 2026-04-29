// www/main.js
// Game constants — extension points for future difficulty selection
const AI_DEPTH = 6;
const AI_FALLBACK_DEPTH = 3; // used when all workers fail or time out

// Worker pool — created once, reused every AI turn
const NUM_WORKERS = navigator.hardwareConcurrency || 4;
const workers = Array.from({ length: NUM_WORKERS }, () => new Worker('./worker.js'));

// Detect SharedArrayBuffer availability for inter-worker alpha sharing
const canShareMemory = typeof SharedArrayBuffer !== 'undefined';
if (!canShareMemory) {
    console.info(
        'SharedArrayBuffer unavailable — workers search independently. ' +
        'Add COOP/COEP headers to nginx to enable inter-worker alpha sharing.'
    );
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

/**
 * Partition an array into `n` roughly equal chunks.
 * If array.length < n, returns array.length chunks of size 1.
 */
function partition(arr, n) {
    const count = Math.min(n, arr.length);
    const chunks = Array.from({ length: count }, () => []);
    arr.forEach((item, i) => chunks[i % count].push(item));
    return chunks;
}

/**
 * Dispatch a single move chunk to a worker and return a Promise.
 * Resolves with {move, score} or null on timeout/error.
 */
function dispatchWorker(worker, payload, timeoutMs) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            resolve(null); // timeout
        }, timeoutMs);

        const handler = ({ data }) => {
            clearTimeout(timer);
            worker.removeEventListener('message', handler);
            resolve(data);
        };

        worker.addEventListener('message', handler);
        worker.postMessage(payload);
    });
}

/**
 * Get the best AI move for the current game state.
 * Returns {move: {row, col}, score} or null if no moves available.
 */
async function getAiMove(game) {
    const validMoves = JSON.parse(game.get_valid_moves());
    if (validMoves.length === 0) return null;

    const gameJson = game.to_json();
    const activeWorkers = Math.min(NUM_WORKERS, validMoves.length);
    const chunks = partition(validMoves, activeWorkers);
    const timeoutMs = AI_DEPTH * 15_000;

    // Allocate a fresh SharedArrayBuffer per turn (starts at -Infinity)
    let sharedAlpha = null;
    if (canShareMemory) {
        const sab = new SharedArrayBuffer(8); // one float64
        const sharedAlphaView = new Float64Array(sab);
        sharedAlphaView[0] = -Infinity;
        sharedAlpha = sharedAlphaView;
    }

    const promises = chunks.map((chunk, i) =>
        dispatchWorker(workers[i], {
            gameJson,
            moves: chunk,
            depth: AI_DEPTH,
            sharedAlpha
        }, timeoutMs)
    );

    const results = await Promise.all(promises);
    const valid = results.filter(r => r !== null && r.move !== null);

    if (valid.length === 0) {
        // All workers failed — synchronous fallback at reduced depth
        console.warn('All workers failed, using synchronous fallback');
        return fallbackAiMove(game, validMoves);
    }

    return valid.reduce((best, r) => r.score > best.score ? r : best);
}

/**
 * Synchronous fallback: evaluate all moves on the main thread at reduced depth.
 * Called when all workers fail or time out.
 */
function fallbackAiMove(game, validMoves) {
    // Import get_ai_move from the WASM module (available after init)
    let best = null;
    for (const { row, col } of validMoves) {
        const result = window.wasm_bindgen.get_ai_move(
            game.to_json(),
            AI_FALLBACK_DEPTH,
            row,
            col,
            -Infinity
        );
        const score = result.score;
        if (!best || score > best.score) {
            best = { move: { row, col }, score };
        }
    }
    return best;
}

// Export for use in the game loop (defined in the next section)
export { getAiMove, workerReady };
