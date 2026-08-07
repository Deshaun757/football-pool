import type { RequestHandler } from 'express';
import { HttpError } from '../lib/http-error.js';

// Temporary development seam. Replace with session authentication before launch.
export const devAuth: RequestHandler = (request, _response, next) => {
  const value = request.header('x-user-id');
  const userId = Number(value);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    next(new HttpError(401, 'A valid x-user-id header is required during development'));
    return;
  }
  request.userId = userId;
  next();
};
