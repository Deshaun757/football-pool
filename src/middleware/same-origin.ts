import type { RequestHandler } from 'express';
import { config } from '../config.js';
import { HttpError } from '../lib/http-error.js';

export const requireSameOrigin: RequestHandler = (request, _response, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) { next(); return; }
  const origin = request.header('origin');
  if (origin && origin !== new URL(config.APP_URL).origin) { next(new HttpError(403, 'Invalid request origin')); return; }
  next();
};
