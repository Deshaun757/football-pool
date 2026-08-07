import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { resolve } from 'node:path';
import { ZodError } from 'zod';
import { HttpError } from './lib/http-error.js';
import { requireSameOrigin } from './middleware/same-origin.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { entriesRouter } from './routes/entries.js';
import { stripeWebhookRouter } from './routes/stripe-webhook.js';
import { weeksRouter } from './routes/weeks.js';
import { teamBadgesRouter } from './routes/team-badges.js';
import { notificationsRouter } from './routes/notifications.js';

export const app = express();
app.use(helmet({ contentSecurityPolicy: { directives: { imgSrc: ["'self'", 'data:', 'https:'] } } }));
app.use(cors());

// Must precede express.json(): Stripe verifies the exact raw request bytes.
app.use('/webhooks', stripeWebhookRouter);
app.use(express.json({ limit: '5mb' }));
app.use(requireSameOrigin);

app.get('/health', (_request, response) => response.json({ ok: true }));
app.use('/team-badges', teamBadgesRouter);
app.use('/api/auth', authRouter);
app.use('/api', entriesRouter);
app.use('/api', weeksRouter);
app.use('/api', adminRouter);
app.use('/api', notificationsRouter);
app.use(express.static(resolve('public')));
app.get(/.*/, (_request, response) => response.sendFile(resolve('public/index.html')));

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  if (error instanceof HttpError) { response.status(error.status).json({ error: error.message }); return; }
  if (error instanceof ZodError) { response.status(400).json({ error: 'Invalid request', details: error.issues }); return; }
  console.error(error);
  response.status(500).json({ error: 'Internal server error' });
});
