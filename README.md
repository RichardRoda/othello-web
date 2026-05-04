# othello-web

[Click here to play the game](https://richardroda.github.io/othello-web/index.html).

Continuation of othello-rust: Create a Rust in the Browser (Web assembly) page for othello-rust.  This runs the move evaluation logic as native Wasm code in multiple threads.  This is many times faster than normal single-threaded JavaScript.

## Build and Deploy

Build the deployable WASM bundle:

```bash
./build.sh
```

This produces the deployable game files in the [www](www) directory.

The source code is in [static](static) The Rust declarations are in [src/lib.rs](src/lib.rs).

Does this really run multi-threaded?  This is Chrome with the game as its only tab and window opened.  The game is evaluating its next move.
```
PID    COMMAND      %CPU  TIME     #TH    #WQ  #PORT MEM    PURG   CMPR PGRP
12722  Google Chrom 492.9 00:14.01 24/6   3    249-  66M+   28K    0B   455
```
All your CPU are belong to us.
