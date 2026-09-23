'use strict';

// Root entrypoint: v2 ignores package.json `main` and loads `/index.js`,
// while v1 follows `main` -> src/v1.js. Re-export the v2 definition here
// so one package entry serves both hosts.
module.exports = require('./src/v2.js');
