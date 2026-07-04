import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import categoryRouter from './routes/category.js';
import tagRouter from './routes/tag.js';
import transactionRouter from './routes/transaction.js';
import walletRouter from './routes/wallet.js';
import analyticsRouter from './routes/analytics.js';
import agentRouter from './routes/agent.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

// CORS configuration (allow dynamic client requests)
app.use(cors({
  origin: true,
  credentials: true
}));

// Standard middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// Routes
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'SpendSense API is running',
    status: 'healthy',
    timestamp: new Date(),
  });
});

app.use('/api', healthRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/agent', agentRouter);
app.use('/api/auth', authRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/tags', tagRouter);
app.use('/api/transactions', transactionRouter);
app.use('/api/wallets', walletRouter);


// Fallback/NotFound handler
app.use((req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
});

// Centralized error handler
app.use(errorHandler);

export default app;
