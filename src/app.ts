import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { HttpError } from './lib/http-error.js';
import { errorFields, logger } from './lib/logger.js';
import { requireSameOrigin } from './middleware/same-origin.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { entriesRouter } from './routes/entries.js';
import { weeksRouter } from './routes/weeks.js';
import { teamBadgesRouter } from './routes/team-badges.js';
import { groupsRouter } from './routes/groups.js';
import { reviewsRouter } from './routes/reviews.js';
import { requireAuth } from './middleware/auth.js';
import { requireGroup } from './middleware/group.js';
import { notificationsRouter } from './routes/notifications.js';
import { supportRouter } from './routes/support.js';

export const app = express();
app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'https:'] } } }));
app.use(cors());
app.use((request, response, next) => {
  const startedAt = performance.now();
  response.on('finish', () => {
    const durationMs = Math.round(performance.now() - startedAt);
    const level = response.statusCode >= 500 ? 'error' : response.statusCode >= 400 || durationMs > 1000 ? 'warn' : 'info';
    logger[level]('http_request', {
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs,
      userId: request.userId,
      groupId: request.groupId,
    });
  });
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(requireSameOrigin);

app.get('/health', (_request, response) => response.json({ ok: true }));
app.use('/team-badges', teamBadgesRouter);
app.use('/api/auth', authRouter);
app.use('/api/support', supportRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/groups/:groupId', requireAuth, requireGroup, entriesRouter, weeksRouter, reviewsRouter, notificationsRouter);
app.use('/api', adminRouter);
app.use('/api', (_request, response) => response.status(404).json({ error: 'API route not found' }));
app.use(express.static(resolve('public'), {
  setHeaders(response) { response.setHeader('Cache-Control', 'no-cache'); },
}));
app.get(/.*/, (_request, response) => {
  response.setHeader('Cache-Control', 'no-cache');
  response.sendFile(resolve('public/index.html'));
});

app.use((error: unknown, request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof HttpError) { response.status(error.status).json({ error: error.message }); return; }
  if (error instanceof ZodError) { response.status(400).json({ error: 'Invalid request', details: error.issues }); return; }
  logger.error('unhandled_request_error', {
    ...errorFields(error),
    method: request.method,
    path: request.path,
    userId: request.userId,
    groupId: request.groupId,
  });
  response.status(500).json({ error: 'Internal server error' });
});
