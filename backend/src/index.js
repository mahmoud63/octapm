require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createServer } = require('http');
const { Server } = require('socket.io');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const userRoutes = require('./routes/users');
const configRoutes = require('./routes/config');
const billingRoutes = require('./routes/billing');
const { HttpError } = require('./utils/http-error');
const { sendError } = require('./utils/api-response');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: process.env.FRONTEND_URL || 'http://localhost:5173' },
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(
  '/api/v1/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  require('./routes/stripe-webhook'),
);
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: { status: 'ok', timestamp: new Date().toISOString() },
  });
});

// API routes
const { subscriptionGate } = require('./middleware/subscription-gate');

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/projects', subscriptionGate, projectRoutes);
app.use('/api/v1/users', subscriptionGate, userRoutes);
app.use('/api/v1/config', configRoutes);
app.use('/api/v1/billing', billingRoutes);

app.use((req, res, next) => {
  next(
    new HttpError(
      404,
      'NOT_FOUND',
      `Route not found: ${req.method} ${req.originalUrl}`,
    ),
  );
});

// Global error handler
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  console.error(err.stack);
  return sendError(
    res,
    err.status || 500,
    err.code || 'INTERNAL_ERROR',
    err.message || 'Something went wrong',
    process.env.NODE_ENV === 'production' ? undefined : err.details,
  );
});

// Make io accessible in routes
app.set('io', io);

const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`🚀 PMcopilots API running on port ${PORT}`);
});
