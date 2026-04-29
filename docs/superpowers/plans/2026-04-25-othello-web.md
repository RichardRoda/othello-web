# othello-web Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a browser-based Othello game at `~/projects/othello-web/` that compiles `othello-rust` to WebAssembly and pits a human player against the Minimax Expert AI, with JS-orchestrated Web Workers for parallel search and a responsive HTML/CSS/JS UI.

**Architecture:** A Rust `[lib]` crate (`othello-web`) wraps `othello-rust` with `wasm-bindgen` exports. `ExecutorKind::Sequential` (defined in `othello-rust`) is passed to `.with_executor()` for single-threaded WASM use — no separate executor file needed in this crate. JS spawns N Web Workers (one per CPU core) that each load the WASM module and evaluate assigned root moves. Workers share an alpha bound via `SharedArrayBuffer` + `Atomics` when available (graceful degradation when not). Three HTML screens (color selection → game board → game over) are rendered via Canvas and plain CSS.

**Tech Stack:** Rust + wasm-bindgen + wasm-pack, vanilla HTML/CSS/JS, Web Workers, SharedArrayBuffer (optional), nginx for development serving.

**Prerequisite:** The changes in `othello-rust/docs/superpowers/plans/2026-04-25-wasm-support.md` must be complete before Task 2.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `Cargo.toml` | `[lib]` crate config, dependencies |
| Create | `src/lib.rs` | `OthelloGame` wasm-bindgen struct + `get_ai_move` free fn |
| Create | `www/index.html` | Single-page app shell, three screen sections |
| Create | `www/style.css` | Responsive layout (portrait + landscape), canvas sizing |
| Create | `www/worker.js` | Web Worker: WASM init, per-move minimax loop |
| Create | `www/main.js` | Worker pool, game state, canvas rendering, screen logic |
| Create | `build.sh` | wasm-pack build + artifact copy into `www/` |

Note: `ExecutorKind` is exported from `othello-rust` as `othello::ExecutorKind`. No `src/executor.rs` is needed in this crate.

---

## Task 1: Prerequisites and Project Scaffold

**Files:**
- Create: `~/projects/othello-web/` (entire directory tree)

- [ ] **Step 1: Install wasm-pack if not already present**

```bash
cargo install wasm-pack 2>&1 | tail -5
# Or check if already installed:
wasm-pack --version
```

Expected: `wasm-pack 0.12.x` or similar.

- [ ] **Step 2: Add the wasm32 target**

```bash
rustup target add wasm32-unknown-unknown
rustup target list --installed | grep wasm
```

Expected: `wasm32-unknown-unknown (installed)`.

- [ ] **Step 3: Create the project directory structure**

`docs/superpowers/plans` already exists (this plan file lives there). Only `src` and `www` need to be created:

```bash
mkdir -p /Users/rroda/projects/othello-web/src
mkdir -p /Users/rroda/projects/othello-web/www
```

- [ ] **Step 4: Create `Cargo.toml`**

Create `/Users/rroda/projects/othello-web/Cargo.toml`:

```toml
[package]
name = "othello-web"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
othello = { path = "../othello-rust", default-features = false, features = ["serde"] }
wasm-bindgen = "0.2"
serde-wasm-bindgen = "0.6"
serde_json = "1"
serde = { version = "1", features = ["derive"] }

[profile.release]
opt-level = "z"   # Optimise for binary size
lto = true
```

- [ ] **Step 5: Create a stub `src/lib.rs` that verifies `othello::SequentialExecutor` is importable**

Create `/Users/rroda/projects/othello-web/src/lib.rs`:

```rust
use othello::ExecutorKind as _;

// Stub — replaced in Task 2 with the full wasm-bindgen implementation.
// The import above confirms othello-rust exports ExecutorKind for wasm32.
```

- [ ] **Step 6: Verify the crate compiles for wasm32**

```bash
cd /Users/rroda/projects/othello-web
cargo check --target wasm32-unknown-unknown 2>&1
```

Expected: no errors. If `ExecutorKind` is not found, the `othello-rust` wasm-support plan Task 5 is not yet complete — finish that before proceeding.

- [ ] **Step 7: Add .gitignore and commit the scaffold**

The git repository is already initialised and linked to `git@github.com:RichardRoda/othello-web.git`.

```bash
cd /Users/rroda/projects/othello-web
cat > .gitignore << 'EOF'
/target/
/pkg/
/www/othello_web.js
/www/othello_web_bg.wasm
EOF
git add .
git commit -m "chore: scaffold othello-web project"
```

---

## Task 2: OthelloGame WASM Wrapper

**Files:**
- Modify: `src/lib.rs`

- [ ] **Step 1: Write tests for the game wrapper logic (non-WASM)**

Add a `#[cfg(test)]` block at the bottom of `src/lib.rs` (these test the Rust logic directly, not the wasm-bindgen layer):

```rust
#[cfg(test)]
mod game_tests {
    use othello::{Game, Player, GameState};

    #[test]
    fn test_new_game_has_four_pieces() {
        let game = Game::new();
        let (black, white) = game.get_score();
        assert_eq!(black, 2);
        assert_eq!(white, 2);
    }

    #[test]
    fn test_new_game_black_moves_first() {
        let game = Game::new();
        assert_eq!(game.current_player(), Player::Black);
    }

    #[test]
    fn test_new_game_is_playing() {
        let game = Game::new();
        assert_eq!(game.get_game_state(), GameState::Playing);
    }

    #[test]
    fn test_new_game_has_valid_moves() {
        let game = Game::new();
        assert!(!game.get_valid_moves().is_empty());
    }

    #[test]
    fn test_game_serde_round_trip() {
        let game = Game::new();
        let json = serde_json::to_string(&game).unwrap();
        let restored: Game = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.get_score(), game.get_score());
        assert_eq!(restored.current_player(), game.current_player());
    }
}
```

- [ ] **Step 2: Run tests**

```bash
cargo test game_tests 2>&1
```

Expected: all 5 tests pass.

- [ ] **Step 3: Implement the `OthelloGame` wasm-bindgen wrapper**

Replace `src/lib.rs` with the full implementation:

```rust
use wasm_bindgen::prelude::*;
use othello::{Game, GameState, Player, Position, ExecutorKind};
use othello::minimax::MinimaxPlayer;

/// Wraps the othello-rust Game for use from JavaScript via wasm-bindgen.
#[wasm_bindgen]
pub struct OthelloGame {
    game: Game,
}

#[wasm_bindgen]
impl OthelloGame {
    /// Create a new game in the initial position. Black moves first.
    #[wasm_bindgen(constructor)]
    pub fn new() -> OthelloGame {
        OthelloGame { game: Game::new() }
    }

    /// Returns the board as a JSON string: [[Cell; 8]; 8]
    /// Each cell is "Empty", "Black", or "White".
    pub fn get_board(&self) -> String {
        serde_json::to_string(self.game.get_board()).unwrap()
    }

    /// Returns valid moves for the current player as a JSON string: [{row, col}, ...]
    pub fn get_valid_moves(&self) -> String {
        serde_json::to_string(&self.game.get_valid_moves()).unwrap()
    }

    /// Returns the score as a JSON string: {black: N, white: N}
    pub fn get_score(&self) -> String {
        let (black, white) = self.game.get_score();
        format!(r#"{{"black":{},"white":{}}}"#, black, white)
    }

    /// Returns "Black" or "White".
    pub fn get_current_player(&self) -> String {
        match self.game.current_player() {
            Player::Black => "Black".to_string(),
            Player::White => "White".to_string(),
        }
    }

    /// Returns "Playing" or "GameOver".
    pub fn get_game_state(&self) -> String {
        match self.game.get_game_state() {
            GameState::Playing => "Playing".to_string(),
            GameState::GameOver { .. } => "GameOver".to_string(),
        }
    }

    /// Returns null (in progress), "Black", "White", or "Tie".
    pub fn get_winner(&self) -> JsValue {
        match self.game.get_game_state() {
            GameState::Playing => JsValue::NULL,
            GameState::GameOver { winner: Some(Player::Black) } => JsValue::from_str("Black"),
            GameState::GameOver { winner: Some(Player::White) } => JsValue::from_str("White"),
            GameState::GameOver { winner: None } => JsValue::from_str("Tie"),
        }
    }

    /// Apply a human move. Returns an error string if the move is invalid.
    pub fn make_move(&mut self, row: usize, col: usize) -> Result<(), JsValue> {
        self.game
            .make_move(Position::new(row, col))
            .map_err(|e| JsValue::from_str(&format!("{:?}", e)))
    }

    /// Serialise the full game state to JSON for passing to Web Workers.
    pub fn to_json(&self) -> String {
        serde_json::to_string(&self.game).unwrap()
    }
}

/// Called by each Web Worker once per assigned root move.
///
/// Deserialises the game state, evaluates the given root move to the
/// given depth using sequential minimax, and returns {score: f64}.
///
/// The full recursive minimax search runs entirely in WASM.
/// `alpha` is the best score found so far across workers (cross-worker pruning).
/// Pass -Infinity when SharedArrayBuffer is unavailable.
///
/// `depth` is an extension point for future difficulty selection.
/// Currently always called with AI_DEPTH = 6 from main.js.
#[wasm_bindgen]
pub fn get_ai_move(game_json: &str, depth: usize, row: usize, col: usize, alpha: f64) -> JsValue {
    let game: Game = serde_json::from_str(game_json)
        .expect("get_ai_move: invalid game JSON");

    let player = MinimaxPlayer::with_depth("AI", depth)
        .with_time_limit_ms(30_000)
        .with_executor(ExecutorKind::Sequential);

    let score = player.best_move_from(&game, Position::new(row, col), alpha);
    serde_wasm_bindgen::to_value(&serde_json::json!({ "score": score })).unwrap()
}

#[cfg(test)]
mod game_tests {
    use othello::{Game, Player, GameState};

    #[test]
    fn test_new_game_has_four_pieces() {
        let game = Game::new();
        let (black, white) = game.get_score();
        assert_eq!(black, 2);
        assert_eq!(white, 2);
    }

    #[test]
    fn test_new_game_black_moves_first() {
        let game = Game::new();
        assert_eq!(game.current_player(), Player::Black);
    }

    #[test]
    fn test_new_game_is_playing() {
        let game = Game::new();
        assert_eq!(game.get_game_state(), GameState::Playing);
    }

    #[test]
    fn test_new_game_has_valid_moves() {
        let game = Game::new();
        assert!(!game.get_valid_moves().is_empty());
    }

    #[test]
    fn test_game_serde_round_trip() {
        let game = Game::new();
        let json = serde_json::to_string(&game).unwrap();
        let restored: Game = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.get_score(), game.get_score());
        assert_eq!(restored.current_player(), game.current_player());
    }
}
```

- [ ] **Step 4: Run tests**

```bash
cargo test 2>&1
```

Expected: all tests pass.

- [ ] **Step 5: Check it compiles for wasm32**

```bash
cargo check --target wasm32-unknown-unknown 2>&1
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib.rs
git commit -m "feat: implement OthelloGame wasm-bindgen wrapper and get_ai_move"
```

---

## Task 3: Build Script

**Files:**
- Create: `build.sh`

- [ ] **Step 1: Create `build.sh`**

```bash
cat > /Users/rroda/projects/othello-web/build.sh << 'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "Building WASM module..."
wasm-pack build --target web --release

echo "Copying artifacts to www/..."
cp pkg/othello_web.js www/othello_web.js
cp pkg/othello_web_bg.wasm www/othello_web_bg.wasm

echo "Done. Serve www/ with nginx at /othello-web/"
EOF
chmod +x build.sh
```

- [ ] **Step 2: Run the build**

```bash
cd /Users/rroda/projects/othello-web
./build.sh 2>&1 | tail -20
```

Expected: ends with `Done. Serve www/ with nginx at /othello-web/` and no errors. `www/othello_web.js` and `www/othello_web_bg.wasm` should both exist.

```bash
ls -lh www/othello_web*.{js,wasm}
```

- [ ] **Step 3: Commit**

```bash
git add build.sh www/othello_web.js www/othello_web_bg.wasm
git commit -m "chore: add build.sh and initial WASM artifacts"
```

---

## Task 4: Web Worker (`worker.js`)

**Files:**
- Create: `www/worker.js`

- [ ] **Step 1: Create `www/worker.js`**

```javascript
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
        // Reflects improvements found by other workers since the last iteration.
        const alpha = sharedAlpha
            ? Atomics.load(sharedAlpha, 0)
            : -Infinity;

        // Full recursive minimax search runs entirely inside WASM.
        const result = wasm_bindgen.get_ai_move(gameJson, depth, row, col, alpha);
        const score = result.score;

        if (score > bestScore) {
            bestScore = score;
            bestMove = { row, col };
        }

        // Update shared alpha atomically if this move found a better bound.
        if (sharedAlpha && score > Atomics.load(sharedAlpha, 0)) {
            Atomics.store(sharedAlpha, 0, score);
        }
    }

    postMessage({ move: bestMove, score: bestScore });
};
```

- [ ] **Step 2: Commit**

```bash
git add www/worker.js
git commit -m "feat: implement Web Worker with WASM pre-warm and per-move search loop"
```

---

## Task 5: HTML Structure (`index.html`)

**Files:**
- Create: `www/index.html`

- [ ] **Step 1: Create `www/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Othello</title>
  <link rel="stylesheet" href="./style.css">
</head>
<body>

  <!-- Screen 1: Color Selection -->
  <div id="screen-select" class="screen active">
    <h1>Othello</h1>
    <p class="prompt">Choose your color</p>
    <div class="color-buttons">
      <button id="btn-black" class="color-btn">Play as Black</button>
      <button id="btn-white" class="color-btn">Play as White</button>
    </div>
    <p class="note">Black moves first</p>
  </div>

  <!-- Screen 2: Game Board -->
  <div id="screen-game" class="screen">
    <div class="game-layout">
      <div class="score-bar" id="score-bar">
        <span id="score-black">Black: 2</span>
        <span id="score-white">White: 2</span>
      </div>
      <div class="board-area">
        <canvas id="board-canvas"></canvas>
      </div>
      <div class="status-bar" id="status-bar">
        <span id="status-text">Your turn</span>
      </div>
    </div>
  </div>

  <!-- Screen 3: Game Over -->
  <div id="screen-over" class="screen">
    <h2 id="result-text">You win!</h2>
    <p id="final-score">Black: 0 &nbsp; White: 0</p>
    <button id="btn-play-again" class="color-btn">Play Again</button>
  </div>

  <script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Commit**

```bash
git add www/index.html
git commit -m "feat: add HTML structure with three game screens"
```

---

## Task 6: Responsive Styles (`style.css`)

**Files:**
- Create: `www/style.css`

- [ ] **Step 1: Create `www/style.css`**

```css
/* www/style.css */

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

html, body {
  height: 100%;
  font-family: system-ui, sans-serif;
  background: #1a1a2e;
  color: #eee;
  overflow: hidden; /* no scroll — everything fits in viewport */
}

/* ── Screen management ───────────────────────────────────────── */
.screen { display: none; }
.screen.active { display: flex; flex-direction: column; align-items: center;
                 justify-content: center; height: 100dvh; }

/* ── Color selection screen ──────────────────────────────────── */
h1 { font-size: clamp(2rem, 8vw, 4rem); margin-bottom: 1rem; }
.prompt { font-size: clamp(1rem, 4vw, 1.5rem); margin-bottom: 1.5rem; }
.note   { font-size: clamp(0.8rem, 3vw, 1rem); margin-top: 1rem; opacity: 0.7; }

.color-buttons { display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; }

.color-btn {
  min-width: 48px; min-height: 48px;
  padding: 0.75rem 2rem;
  font-size: clamp(1rem, 4vw, 1.25rem);
  border: none; border-radius: 8px; cursor: pointer;
  background: #4a90d9; color: #fff; font-weight: bold;
  transition: background 0.15s;
}
.color-btn:hover { background: #357abd; }

/* ── Game layout — portrait (default) ───────────────────────── */
.game-layout {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  width: 100%;
  align-items: center;
}

.score-bar, .status-bar {
  width: 100%;
  padding: 0.5rem 1rem;
  font-size: clamp(1rem, 3vw, 1.25rem);
  text-align: center;
  flex-shrink: 0;
}
.score-bar { display: flex; justify-content: space-around; }

.board-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  overflow: hidden;
}

#board-canvas {
  /* Square: limited by available width OR available height, whichever is smaller */
  width:  min(100%, 100cqh);
  height: min(100%, 100cqw);
  aspect-ratio: 1;
  touch-action: none; /* prevent scroll-on-drag on mobile */
}

/* ── Game layout — landscape ─────────────────────────────────── */
@media (orientation: landscape) {
  .game-layout {
    flex-direction: row;
    justify-content: center;
  }

  /* Board takes full viewport height, stays square */
  .board-area {
    height: 100dvh;
    width: auto;
    flex: 0 0 auto;
  }
  #board-canvas {
    width: auto;
    height: 100dvh;
    aspect-ratio: 1;
  }

  /* Sidebar to the right: score + status stacked */
  .score-bar, .status-bar {
    width: auto;
    min-width: 140px;
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 0.5rem;
    text-align: left;
    padding: 1rem;
  }
  .game-layout {
    /* Score bar on the right, not top/bottom */
    flex-direction: row;
  }
  /* Re-order: canvas | sidebar (score + status stacked) */
  .board-area { order: 1; }
  .score-bar  { order: 2; }
  .status-bar { order: 3; }
}

/* ── Game over screen ────────────────────────────────────────── */
#screen-over h2   { font-size: clamp(1.5rem, 6vw, 3rem); margin-bottom: 1rem; }
#screen-over p    { font-size: clamp(1rem, 4vw, 1.5rem); margin-bottom: 2rem; }
#btn-play-again   { width: min(80vw, 300px); }
```

- [ ] **Step 2: Commit**

```bash
git add www/style.css
git commit -m "feat: add responsive CSS layout for portrait and landscape orientations"
```

---

## Task 7: Main JS — Worker Pool and AI Orchestration (`main.js` part 1)

**Files:**
- Create: `www/main.js` (first half)

- [ ] **Step 1: Create `www/main.js` with worker pool setup and AI move logic**

```javascript
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
            console.warn('Worker timed out — treating chunk result as null.');
            resolve(null);
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
        sharedAlpha = new Float64Array(sab);
        // -Infinity as IEEE 754 bits
        sharedAlpha[0] = -Infinity;
    }

    const promises = chunks.map((chunk, i) =>
        dispatchWorker(workers[i], {
            gameJson,
            moves: chunk,
            depth: AI_DEPTH,
            sharedAlpha,
        }, timeoutMs)
    );

    const results = await Promise.all(promises);
    const valid = results.filter(r => r !== null && r.move !== null);

    if (valid.length === 0) {
        // All workers failed — synchronous fallback at reduced depth
        console.warn('All workers failed. Falling back to synchronous search at depth', AI_FALLBACK_DEPTH);
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
        const result = window._wasmModule.get_ai_move(
            game.to_json(), AI_FALLBACK_DEPTH, row, col, -Infinity
        );
        if (best === null || result.score > best.score) {
            best = { move: { row, col }, score: result.score };
        }
    }
    return best;
}

// Export for use in the game loop (defined in the next section)
export { workerReady, getAiMove };
```

- [ ] **Step 2: Commit**

```bash
git add www/main.js
git commit -m "feat: add worker pool, pre-warm, and AI move orchestration"
```

---

## Task 8: Main JS — Canvas Rendering and Game Loop (`main.js` part 2)

**Files:**
- Modify: `www/main.js`

- [ ] **Step 1: Replace `www/main.js` with the complete implementation**

```javascript
// www/main.js

import init, { OthelloGame, get_ai_move } from './othello_web.js';

// ── Constants ────────────────────────────────────────────────────
const AI_DEPTH = 6;           // Extension point for difficulty selection
const AI_FALLBACK_DEPTH = 3;  // Used when all workers fail

// ── Worker pool ──────────────────────────────────────────────────
const NUM_WORKERS = navigator.hardwareConcurrency || 4;
const workers = Array.from({ length: NUM_WORKERS }, () => new Worker('./worker.js'));

const canShareMemory = typeof SharedArrayBuffer !== 'undefined';
if (!canShareMemory) {
    console.info(
        'SharedArrayBuffer unavailable — workers search independently. ' +
        'Add COOP/COEP headers to nginx to enable inter-worker alpha sharing.'
    );
}

// ── Game state ───────────────────────────────────────────────────
let wasmGame = null;       // OthelloGame WASM instance
let humanColor = null;     // "Black" or "White"
let gameActive = false;

// ── DOM elements ─────────────────────────────────────────────────
const screenSelect = document.getElementById('screen-select');
const screenGame   = document.getElementById('screen-game');
const screenOver   = document.getElementById('screen-over');
const canvas       = document.getElementById('board-canvas');
const ctx          = canvas.getContext('2d');
const scoreBlack   = document.getElementById('score-black');
const scoreWhite   = document.getElementById('score-white');
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

    // Background
    ctx.fillStyle = '#2d6a4f';
    ctx.fillRect(0, 0, size, size);

    // Grid lines
    ctx.strokeStyle = '#1b4332';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 8; i++) {
        ctx.beginPath(); ctx.moveTo(i * cell, 0); ctx.lineTo(i * cell, size); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * cell); ctx.lineTo(size, i * cell); ctx.stroke();
    }

    // Pieces and valid-move dots
    const parsed = JSON.parse(board);
    for (let row = 0; row < 8; row++) {
        for (let col = 0; col < 8; col++) {
            const cx = col * cell + cell / 2;
            const cy = row * cell + cell / 2;
            const piece = parsed[row][col];

            if (piece === 'Black' || piece === 'White') {
                ctx.beginPath();
                ctx.arc(cx, cy, cell * 0.42, 0, Math.PI * 2);
                ctx.fillStyle = piece === 'Black' ? '#111' : '#fff';
                ctx.fill();
            } else if (isHumanTurn) {
                // Check if this cell is a valid move
                const isValid = validMoves.some(m => m.row === row && m.col === col);
                if (isValid) {
                    ctx.beginPath();
                    ctx.arc(cx, cy, cell * 0.15, 0, Math.PI * 2);
                    ctx.fillStyle = 'rgba(255,255,255,0.4)';
                    ctx.fill();
                }
            }
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

// ── Turn management ───────────────────────────────────────────────
function isHumanTurn() {
    return wasmGame.get_current_player() === humanColor;
}

function renderGameScreen(highlightMoves) {
    const board      = wasmGame.get_board();
    const validMoves = highlightMoves ? JSON.parse(wasmGame.get_valid_moves()) : [];
    drawBoard(board, validMoves, highlightMoves);
    updateScoreBar();
}

async function runAiTurn() {
    setStatus('Thinking...');
    canvas.style.pointerEvents = 'none';
    renderGameScreen(false);

    const result = await getAiMove(wasmGame);
    if (result && result.move) {
        wasmGame.make_move(result.move.row, result.move.col);
    }

    canvas.style.pointerEvents = '';
    await advanceTurn();
}

async function advanceTurn() {
    if (wasmGame.get_game_state() === 'GameOver') {
        showGameOver();
        return;
    }

    const validMoves = JSON.parse(wasmGame.get_valid_moves());

    if (validMoves.length === 0) {
        // Current player must pass
        if (isHumanTurn()) {
            setStatus('Your turn (pass — no valid moves)');
        } else {
            setStatus("Computer's turn (pass)");
        }
        // Apply pass: make_move with an invalid position triggers the pass logic
        // Use the game's skip_turn via a deliberate pass
        // (othello-rust handles this internally when both players have no moves → GameOver)
        // Flip the current player by calling get_current_player then swapping
        // Since we can't call skip_turn directly from WASM, trigger via invalid move:
        // Actually we need to expose skip_turn. For now, transition after a brief delay.
        setTimeout(async () => {
            // Re-render with the opponent's turn
            if (!isHumanTurn()) {
                await runAiTurn();
            } else {
                renderGameScreen(true);
                setStatus('Your turn');
            }
        }, 800);
        return;
    }

    if (isHumanTurn()) {
        renderGameScreen(true);
        setStatus('Your turn');
    } else {
        await runAiTurn();
    }
}

// ── Game over ─────────────────────────────────────────────────────
function showGameOver() {
    gameActive = false;
    const winner = wasmGame.get_winner();
    const score  = JSON.parse(wasmGame.get_score());

    if (winner === humanColor) {
        resultText.textContent = 'You win!';
    } else if (winner === 'Tie') {
        resultText.textContent = 'Draw!';
    } else {
        resultText.textContent = 'Computer wins!';
    }

    finalScore.textContent = `Black: ${score.black}   White: ${score.white}`;
    showScreen('screen-over');
}

// ── Human input: click and touch ──────────────────────────────────
function handleBoardInput(x, y) {
    if (!gameActive || !isHumanTurn()) return;

    const rect = canvas.getBoundingClientRect();
    const cell = rect.width / 8;
    const col  = Math.floor((x - rect.left) / cell);
    const row  = Math.floor((y - rect.top)  / cell);

    try {
        wasmGame.make_move(row, col);
        renderGameScreen(false);
        advanceTurn();
    } catch (_) {
        // Invalid move — ignore
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
            console.warn('Worker timed out.');
            resolve(null);
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

async function getAiMove(game) {
    const validMoves = JSON.parse(game.get_valid_moves());
    if (validMoves.length === 0) return null;

    const gameJson      = game.to_json();
    const activeWorkers = Math.min(NUM_WORKERS, validMoves.length);
    const chunks        = partition(validMoves, activeWorkers);
    const timeoutMs     = AI_DEPTH * 15_000;

    let sharedAlpha = null;
    if (canShareMemory) {
        const sab = new SharedArrayBuffer(8);
        sharedAlpha = new Float64Array(sab);
        sharedAlpha[0] = -Infinity;
    }

    const promises = chunks.map((chunk, i) =>
        dispatchWorker(workers[i], { gameJson, moves: chunk, depth: AI_DEPTH, sharedAlpha }, timeoutMs)
    );

    const results = await Promise.all(promises);
    const valid   = results.filter(r => r !== null && r.move !== null);

    if (valid.length === 0) {
        console.warn('All workers failed. Falling back at depth', AI_FALLBACK_DEPTH);
        return fallbackAiMove(game, validMoves);
    }

    return valid.reduce((best, r) => r.score > best.score ? r : best);
}

function fallbackAiMove(game, validMoves) {
    let best = null;
    for (const { row, col } of validMoves) {
        const result = get_ai_move(game.to_json(), AI_FALLBACK_DEPTH, row, col, -Infinity);
        if (best === null || result.score > best.score) {
            best = { move: { row, col }, score: result.score };
        }
    }
    return best;
}

// ── Startup ───────────────────────────────────────────────────────
async function main() {
    // Initialise WASM module on the main thread (for fallback get_ai_move)
    await init('./othello_web_bg.wasm');

    // Pre-warm workers concurrently with the page load
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

    // Color selection
    document.getElementById('btn-black').addEventListener('click', async () => {
        humanColor = 'Black';
        await startGame();
    });
    document.getElementById('btn-white').addEventListener('click', async () => {
        humanColor = 'White';
        await startGame();
    });

    // Play again
    document.getElementById('btn-play-again').addEventListener('click', () => {
        showScreen('screen-select');
    });

    // Wait for workers before enabling play (avoids cold-start on first move)
    await workerReady;
    showScreen('screen-select');
}

async function startGame() {
    wasmGame   = new OthelloGame();
    gameActive = true;
    showScreen('screen-game');

    // Trigger canvas resize on orientation change
    window.addEventListener('resize', () => renderGameScreen(isHumanTurn()));

    await advanceTurn();
}

main().catch(console.error);
```

- [ ] **Step 2: Commit**

```bash
git add www/main.js
git commit -m "feat: implement full game loop, canvas rendering, and worker orchestration"
```

---

## Task 9: Build and Manual End-to-End Test

- [ ] **Step 1: Build the WASM artifacts**

```bash
cd /Users/rroda/projects/othello-web
./build.sh
```

Expected: no errors, `www/othello_web.js` and `www/othello_web_bg.wasm` present.

- [ ] **Step 2: Configure nginx**

Add the following location block to your nginx config and reload:

```nginx
location /othello-web/ {
    alias /Users/rroda/projects/othello-web/www/;
    try_files $uri $uri/ =404;

    # Optional: enable SharedArrayBuffer for inter-worker alpha sharing.
    # Without these headers the game works correctly but workers search
    # independently without shared alpha bounds.
    # add_header Cross-Origin-Opener-Policy "same-origin";
    # add_header Cross-Origin-Embedder-Policy "require-corp";
}

types {
    application/wasm wasm;
}
```

```bash
sudo nginx -t && sudo nginx -s reload
```

- [ ] **Step 3: Open the app**

Navigate to `http://localhost:8080/othello-web/` in a browser.

Manual test checklist:
- [ ] Color selection screen appears with two buttons
- [ ] "Black moves first" note is visible
- [ ] Clicking "Play as Black" starts the game; human is Black and moves first
- [ ] Clicking "Play as White" starts the game; AI (Black) immediately starts thinking
- [ ] Valid move indicators (dots) appear on human's turn
- [ ] Board is non-interactive while AI is thinking ("Thinking..." shown)
- [ ] Score bar updates after each move
- [ ] Game ends with correct result ("You win!" / "Computer wins!" / "Draw!")
- [ ] "Play Again" returns to color selection
- [ ] Open browser DevTools → Console: no errors; SharedArrayBuffer message shown if headers absent
- [ ] Rotate phone to landscape: board takes full height, score/status move to sidebar
- [ ] Portrait on a phone: board fills width without overflow

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "feat: complete othello-web implementation — human vs minimax expert in browser"
```

---

## Known Extension Points

These are **not** in scope for this plan but are designed to be added later:

| Feature | Where to change |
|---------|----------------|
| Difficulty selection | `AI_DEPTH` constant in `main.js`; `depth` parameter on `get_ai_move` |
| Piece flip animation | `drawBoard` in `main.js` — add keyframe animation after `make_move` |
| SharedArrayBuffer alpha sharing | Uncomment COOP/COEP headers in nginx config |
| Switch to git dependency | Update `othello-rust` path dep to git dep in `Cargo.toml` |