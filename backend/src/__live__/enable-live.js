// Loaded by jest.live.config.js before each live test file.
process.env.RUN_LIVE_DB = '1';
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });
// Live tests start real processes against the one local Postgres (100
// connections). Keep each of them, and this test process, to a small pool.
process.env.DATABASE_URL = require('./helpers').withConnectionLimit(process.env.DATABASE_URL, 5);
