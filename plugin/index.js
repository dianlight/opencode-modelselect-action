'use strict';

// Root entrypoint: v2 ignores package.json `main` and loads `/index.js`.
// `main` points here too so package consumers resolve the same v2
// definition — the v1 `server()` entry was removed (v2-only package).
module.exports = require('./src/v2.js');
