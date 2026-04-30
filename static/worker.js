// www/worker.js
// Runs inside a Web Worker. Loads the WASM module once, then evaluates
// assigned root moves on demand.

import init, { get_ai_move } from './othello_web.js';

let wasmReady = init({ module_or_path: './othello_web_bg.wasm' });

function floatToBits(f) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, f);
    return new DataView(buf).getBigInt64(0);
}

function bitsToFloat(b) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setBigInt64(0, b);
    return new DataView(buf).getFloat64(0);
}

// Atomically update arr[index] to value if value is greater than the current float.
function atomicMaxFloat(arr, index, value) {
    const newBits = floatToBits(value);
    while (true) {
        const currentBits = Atomics.load(arr, index);
        if (bitsToFloat(currentBits) >= value) return;
        if (Atomics.compareExchange(arr, index, currentBits, newBits) === currentBits) return;
    }
}

onmessage = async ({ data }) => {
    if (data.type === 'init') {
        await wasmReady;
        postMessage({ type: 'ready' });
        return;
    }

    await wasmReady;
    const { gameJson, moves, depth, sharedAlpha } = data;

    let bestMove = null;
    let bestScore = -Infinity;

    for (const { row, col } of moves) {
        const alpha = sharedAlpha
            ? bitsToFloat(Atomics.load(sharedAlpha, 0))
            : -Infinity;

        const score = get_ai_move(gameJson, depth, row, col, alpha);

        if (score > bestScore) {
            bestScore = score;
            bestMove = { row, col };
        }

        if (sharedAlpha) atomicMaxFloat(sharedAlpha, 0, score);
    }

    postMessage({ move: bestMove, score: bestScore });
};
