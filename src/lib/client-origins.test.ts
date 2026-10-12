import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config.js',()=>({config:{APP_URL:'https://huddlepickem.com',MOBILE_APP_ORIGINS:['capacitor://localhost']}}));
import { allowedClientOrigins, isNativeClient } from './client-origins.js';

function request(origin:string,client='ios'):Request {
  return {header:(name:string)=>name.toLowerCase()==='origin'?origin:name.toLowerCase()==='x-huddle-client'?client:undefined} as Request;
}

describe('client origin policy',()=>{
  it('allows the website and configured Capacitor origin',()=>{
    expect(allowedClientOrigins.has('https://huddlepickem.com')).toBe(true);
    expect(allowedClientOrigins.has('capacitor://localhost')).toBe(true);
  });

  it('identifies only the configured iOS client',()=>{
    expect(isNativeClient(request('capacitor://localhost'))).toBe(true);
    expect(isNativeClient(request('https://attacker.example'))).toBe(false);
    expect(isNativeClient(request('capacitor://localhost','web'))).toBe(false);
  });
});
