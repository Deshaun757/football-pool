import nodemailer from 'nodemailer';
import { config } from '../config.js';

const smtp = nodemailer.createTransport({
  host:config.SMTP_HOST,port:config.SMTP_PORT,secure:config.SMTP_SECURE,
  auth:config.SMTP_USER ? {user:config.SMTP_USER,pass:config.SMTP_PASSWORD} : undefined,
  connectionTimeout:10000,socketTimeout:10000,
});
export async function sendPasswordReset(email:string,token:string):Promise<void> {
  const link=new URL('/reset-password',config.APP_URL);
  // The fragment keeps the secret out of HTTP requests, access logs, and referrers.
  link.hash = `token=${token}`;
  await smtp.sendMail({from:config.MAIL_FROM,to:email,subject:'Reset your Sunday Ticket Pick’em password',
    text:`Reset your password using this link:\n\n${link.toString()}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.`,
  });
}
