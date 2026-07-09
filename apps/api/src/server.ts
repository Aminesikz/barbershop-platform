import http from 'node:http';
import { app } from './app.js';
import { env } from './config/env.js';
import { testConnection } from './config/db.js';
import { attachWebSocketServer } from './realtime/ws.server.js';
import { registerBookingEmailNotifications } from './notifications/bookingEmails.js';
import { registerReviewEmailNotifications } from './notifications/reviewEmails.js';
import { startPendingExpirySweep } from './sweeps/pendingExpiry.js';

async function main(): Promise<void> {
  await testConnection();

  const httpServer = http.createServer(app);
  attachWebSocketServer(httpServer);
  registerBookingEmailNotifications();
  registerReviewEmailNotifications();
  startPendingExpirySweep();

  httpServer.listen(env.PORT, () => {
    console.log(`API listening on port ${env.PORT} [${env.NODE_ENV}]`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
