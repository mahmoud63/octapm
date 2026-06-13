const { createServer } = require('http');
const { Server } = require('socket.io');
const { createApp } = require('./app');
const { createSocketCorsOptions, validateProductionEnv } = require('./config/security');
const { startBillingScheduler } = require('./jobs/billing-scheduler');
const { startNotificationScheduler } = require('./jobs/notification-scheduler');

validateProductionEnv();

const app = createApp();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: createSocketCorsOptions(),
});

app.set('io', io);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`PMcopilots API running on port ${PORT}`);
});

startBillingScheduler();
startNotificationScheduler();

module.exports = { app, httpServer, io };
