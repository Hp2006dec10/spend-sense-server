import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import app from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.port, async () => {
  console.log(`Server running in ${env.nodeEnv} mode on port ${env.port}`);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error(`Unhandled Rejection Error: ${err.message}`);
  // Close server & exit process
  server.close(() => process.exit(1));
});
