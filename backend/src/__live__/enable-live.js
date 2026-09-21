// Loaded by jest.live.config.js before each live test file.
process.env.RUN_LIVE_DB = '1';
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });
