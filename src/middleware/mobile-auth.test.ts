import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks=vi.hoisted(()=>({query:vi.fn()}));
vi.mock('../config.js',()=>({config:{SESSION_COOKIE_NAME:'pickem_session'}}));
vi.mock('../db/pool.js',()=>({pool:{query:mocks.query}}));
import { requireAuth } from './auth.js';

function request(headers:Record<string,string>):Request {
  return {
    header:(name:string)=>headers[name.toLowerCase()],
  } as Request;
}

describe('mobile bearer authentication',()=>{
  beforeEach(()=>vi.resetAllMocks());

  it('authenticates a native bearer token through the existing session table',async()=>{
    const token='a'.repeat(43);
    mocks.query.mockResolvedValue([[{user_id:17,role:'player'}],[]]);
    const req=request({authorization:`Bearer ${token}`});
    const next=vi.fn() as NextFunction;
    await requireAuth(req,{} as Response,next);
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('FROM sessions'),[createHash('sha256').update(token).digest()]);
    expect(req.userId).toBe(17);
    expect(req.sessionTokenHash).toEqual(createHash('sha256').update(token).digest());
    expect(next).toHaveBeenCalledWith();
  });

  it('continues to authenticate browser cookies',async()=>{
    mocks.query.mockResolvedValue([[{user_id:21,role:'admin'}],[]]);
    const req=request({cookie:'pickem_session='+encodeURIComponent('b'.repeat(43))});
    const next=vi.fn() as NextFunction;
    await requireAuth(req,{} as Response,next);
    expect(req.userId).toBe(21);
    expect(req.userRole).toBe('admin');
    expect(next).toHaveBeenCalledWith();
  });

  it('rejects malformed bearer credentials',async()=>{
    const next=vi.fn() as NextFunction;
    await requireAuth(request({authorization:'Bearer not-a-session'}),{} as Response,next);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({status:401}));
  });
});
