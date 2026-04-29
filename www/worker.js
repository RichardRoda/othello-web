// www/worker.js
// Runs inside a Web Worker. Loads the WASM module once, then evaluates
// assigned root moves on demand.

importScripts('./othello_web.js'); // relative to worker.js — works at any host path

// WASM initialisation — resolves .wasm path relative to this script automatically
let wasmReady = wasm_bindgen('./othello_web_bg.wasm');

onmessage = async ({ data }) => {
    if (data.type === 'init') {
        // Pre-warm: just ensure WASM is loaded before the first real request
        await wasmReady;
        postMessage({ type: 'ready' });
        return;
    }

    await wasmReady;
    const { gameJson, moves, depth, sharedAlpha } = data;

    let bestMove = null;
    let bestScore = -Infinity;

    for (const { row, col } of moves) {
        // Read latest shared alpha before each root move.
        let alpha = -Infinity;
        if (sharedAlpha) {
            alpha = Atomics.load(sharedAlpha, 0);
        }

        const result = window.wasm_bindgen.get_ai_move(gameJson, depth, row, col, alpha);
        const score = result.score;

        if (score > bestScore) {
            bestScore = score;
            bestMove = { row, col };
        }

        // Update shared alpha if we found a better score
        if (sharedAlpha && score > alpha) {
            Atomics.store(sharedAlpha, 0, score);
        }
    }

    postMessage({ move: bestMove, score: bestScore });
};