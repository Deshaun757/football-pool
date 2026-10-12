import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.url().default("http://localhost:3000"),
  APPLE_TEAM_ID: z.preprocess(
    value => value === '' ? undefined : value,
    z.string().trim().regex(/^[A-Z0-9]{10}$/).optional(),
  ),
  APNS_KEY_ID: z.preprocess(value => value === '' ? undefined : value, z.string().trim().min(1).optional()),
  APNS_PRIVATE_KEY_BASE64: z.preprocess(value => value === '' ? undefined : value, z.string().trim().min(1).optional()),
  APNS_TOPIC: z.string().trim().min(1).default('com.redcrowssolutions.huddlepickem'),
  APNS_ENVIRONMENT: z.enum(['production','sandbox']).default('production'),
  MOBILE_APP_ORIGINS: z.string().default('capacitor://localhost').transform(value => value.split(',').map(origin => origin.trim()).filter(Boolean)),
  MYSQL_URL: z.string().min(1),
  SESSION_COOKIE_NAME: z.string().min(1).default("pickem_session"),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  ADMIN_EMAIL: z.string().email().optional(),
  APP_REVIEW_COMMISSIONER_EMAIL: z.preprocess(value => value === '' ? undefined : value, z.string().email().optional()),
  APP_REVIEW_MEMBER_EMAIL: z.preprocess(value => value === '' ? undefined : value, z.string().email().optional()),
  SMTP_HOST: z.string().default("127.0.0.1"),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().email().default("no-reply@pickem.local"),
});

export const config = schema.parse(process.env);
