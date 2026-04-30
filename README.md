# othello-web

Continuation of othello-rust: Create a Rust in the Browser (Web assembly) page for othello-rust

## Build and Deploy

Build the deployable WASM bundle:

```bash
cd /Users/rroda/projects/othello/othello-web
./build.sh
```

This produces `www/othello_web.js` and `www/othello_web_bg.wasm` in `www/`.

### nginx Configuration

Configure nginx to serve the `www/` directory and enable WebAssembly MIME type:

```nginx
location /othello-web/ {
    alias /Users/rroda/projects/othello/othello-web/www/;
    
    # Optional headers to support inter-worker alpha value sharing and SharedArrayBuffer support.
    add_header Cross-Origin-Opener-Policy "same-origin";
    add_header Cross-Origin-Embedder-Policy "require-corp";

    try_files $uri $uri/ =404;
}

types {
    application/wasm wasm;
}
```
