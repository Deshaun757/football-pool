import { z } from 'zod';

const reservedNames = new Set([
  'admin',
  'administrator',
  'commissioner',
  'commish',
  'huddle pickem',
  'huddlepickem',
  'huddle pick em',
  'huddle',
  'support',
]);

const normalizeName = (value: string) => value.trim().replace(/\s+/g, ' ');
const allowedNameCharacters = /^[A-Za-z0-9 .&'-]+$/;

function createNameSchema(label: string, minimum: number, maximum: number) {
  return z.string()
    .transform(normalizeName)
    .pipe(z.string()
      .min(minimum, `${label} must be at least ${minimum} characters.`)
      .max(maximum, `${label} must be ${maximum} characters or fewer.`)
      .refine((value) => allowedNameCharacters.test(value), `${label} can only use letters, numbers, spaces, apostrophes, hyphens, periods, and ampersands.`)
      .refine((value) => !/[.@][^\s]*\.[^\s]+/.test(value), `${label} cannot be an email address or website.`)
      .refine((value) => !/(?:https?:\/\/|www\.)/i.test(value), `${label} cannot include a website.`)
      .refine((value) => !/^[a-f0-9]{24,}$/i.test(value), `${label} cannot look like an invite code.`)
      .refine((value) => !reservedNames.has(value.toLowerCase().replace(/\s+/g, ' ')), `${label} is reserved. Please choose another name.`));
}

export const displayNameSchema = createNameSchema('Display name', 2, 40);
export const groupNameSchema = createNameSchema('Group name', 3, 50);
