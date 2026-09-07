import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const smtp = nodemailer.createTransport({
  host: config.SMTP_HOST,
  port: config.SMTP_PORT,
  secure: config.SMTP_SECURE,
  auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
  connectionTimeout: 10000,
  socketTimeout: 10000,
});

const brandName = "Huddle Pick'em";
const brandIconPath = fileURLToPath(new URL('../../public/huddle-link-preview.png', import.meta.url));
const brandIconDataUrl = `data:image/png;base64,${readFileSync(brandIconPath).toString('base64')}`;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]!);
}

function linkify(text: string): string {
  return escapeHtml(text).replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" style="color:#154f36;font-weight:700;">$1</a>',
  );
}

function renderEmailHtml(subject: string, text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 16px;line-height:1.55;">${linkify(block).replace(/\n/g, '<br>')}</p>`)
    .join('');

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f3e8;color:#10251b;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f7f3e8;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fffdf7;border:1px solid #ded8c8;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#154f36;padding:22px 26px;color:#fffdf7;">
                <table role="presentation" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="padding-right:12px;">
                      <img src="${brandIconDataUrl}" width="44" height="44" alt="" style="display:block;border-radius:10px;">
                    </td>
                    <td>
                      <div style="font-size:20px;font-weight:800;letter-spacing:.2px;">${brandName}</div>
                      <div style="font-size:12px;color:#e7aa36;font-weight:700;text-transform:uppercase;letter-spacing:.08em;">Weekly Pick'em</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:28px 26px 18px;">
                <h1 style="margin:0 0 18px;font-size:24px;line-height:1.2;color:#10251b;">${escapeHtml(subject)}</h1>
                <div style="font-size:15px;color:#253b30;">${paragraphs}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 26px 26px;border-top:1px solid #eee7d8;color:#637167;font-size:12px;line-height:1.5;">
                You received this email because you have a Huddle Pick'em account or were invited to a group.
                <br>
                <a href="${new URL('/support.html', config.APP_URL)}" style="color:#154f36;">Support and email preferences</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export async function sendEmail(to: string, subject: string, text: string, messageId?: string): Promise<void> {
  await smtp.sendMail({ from: config.MAIL_FROM, to, subject, text, html: renderEmailHtml(subject, text), messageId });
}

export async function sendPasswordReset(email: string, token: string): Promise<void> {
  const link = new URL('/reset-password', config.APP_URL);
  // The fragment keeps the secret out of HTTP requests, access logs, and referrers.
  link.hash = `token=${token}`;
  const subject = "Reset your Huddle Pick'em password";
  const text = `Reset your password using this link:\n\n${link.toString()}\n\nThis link expires in 30 minutes and can only be used once. If you did not request this, you can ignore this email.`;
  await smtp.sendMail({ from: config.MAIL_FROM, to: email, subject, text, html: renderEmailHtml(subject, text) });
}
