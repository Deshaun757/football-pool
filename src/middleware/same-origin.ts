import type { RequestHandler } from 'express';
import { HttpError } from '../lib/http-error.js';
import { allowedClientOrigins } from '../lib/client-origins.js';

export const requireSameOrigin: RequestHandler = (request, _response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { next(); return; }
  const origin = request.header('origin');
  if (origin && !allowedClientOrigins.has(origin)) { next(new HttpError(403, 'Invalid request origin')); return; }
  next();
};
