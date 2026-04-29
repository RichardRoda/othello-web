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
            GameState::Playing => JsValue::null(),
            GameState::GameOver { winner } => match winner {
                Some(Player::Black) => JsValue::from_str("Black"),
                Some(Player::White) => JsValue::from_str("White"),
                None => JsValue::from_str("Tie"),
            },
        }
    }

    /// Apply a human move. Returns an error string if the move is invalid.
    pub fn make_move(&mut self, row: usize, col: usize) -> Result<(), JsValue> {
        self.game
            .make_move(Position::new(row, col))
            .map_err(|e| JsValue::from_str(&format!("Invalid move: {}", e)))
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
        assert_eq!(restored.current_player(), game.current_player());
    }
}