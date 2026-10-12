import { createSign } from 'node:crypto';
import { connect } from 'node:http2';
import { config } from '../config.js';

let cachedToken:{value:string;createdAt:number}|undefined;

function base64Url(value:Buffer|string):string {
  return Buffer.from(value).toString('base64url');
}

function providerToken():string {
  const now=Math.floor(Date.now()/1000);
  if(cachedToken && now-cachedToken.createdAt<3000) return cachedToken.value;
  if(!config.APPLE_TEAM_ID || !config.APNS_KEY_ID || !config.APNS_PRIVATE_KEY_BASE64) throw new Error('APNs credentials are incomplete');
  const header=base64Url(JSON.stringify({alg:'ES256',kid:config.APNS_KEY_ID}));
  const claims=base64Url(JSON.stringify({iss:config.APPLE_TEAM_ID,iat:now}));
  const unsigned=`${header}.${claims}`;
  const signer=createSign('SHA256');
  signer.update(unsigned);
  signer.end();
  const key=Buffer.from(config.APNS_PRIVATE_KEY_BASE64,'base64').toString('utf8');
  const signature=signer.sign({key,dsaEncoding:'ieee-p1363'});
  cachedToken={value:`${unsigned}.${base64Url(signature)}`,createdAt:now};
  return cachedToken.value;
}

export function apnsConfigured():boolean {
  return !!(config.APPLE_TEAM_ID && config.APNS_KEY_ID && config.APNS_PRIVATE_KEY_BASE64);
}

export async function sendApns(deviceToken:string,payload:Record<string,unknown>):Promise<{status:number;reason?:string}> {
  const authority=config.APNS_ENVIRONMENT==='sandbox'?'https://api.sandbox.push.apple.com':'https://api.push.apple.com';
  const client=connect(authority);
  return new Promise((resolve,reject)=>{
    const request=client.request({
      ':method':'POST',
      ':path':`/3/device/${deviceToken}`,
      authorization:`bearer ${providerToken()}`,
      'apns-topic':config.APNS_TOPIC,
      'apns-push-type':'alert',
      'apns-priority':'10',
    });
    let status=0,body='';
    request.setEncoding('utf8');
    request.on('response',headers=>{status=Number(headers[':status'] ?? 0);});
    request.on('data',chunk=>{body+=chunk;});
    request.on('end',()=>{
      client.close();
      let reason:string|undefined;
      try { reason=body?JSON.parse(body).reason:undefined; } catch { reason=body || undefined; }
      resolve({status,reason});
    });
    request.on('error',error=>{client.destroy();reject(error);});
    client.on('error',error=>{request.destroy();reject(error);});
    request.end(JSON.stringify(payload));
  });
}
