import type { Request } from 'express';
import { config } from '../config.js';

export const allowedClientOrigins = new Set([
  new URL(config.APP_URL).origin,
  ...config.MOBILE_APP_ORIGINS,
]);

export function isNativeClient(request: Request): boolean {
  const origin=request.header('origin');
  return request.header('x-huddle-client')==='ios' && !!origin && config.MOBILE_APP_ORIGINS.includes(origin);
}
