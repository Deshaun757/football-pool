import { z } from 'zod';

export const strongPassword = z.string().min(10,'Use at least 10 characters').max(128,'Use no more than 128 characters')
  .regex(/[a-z]/,'Include a lowercase letter').regex(/[A-Z]/,'Include an uppercase letter')
  .regex(/[0-9]/,'Include a number').regex(/[^a-zA-Z0-9\s]/,'Include a special character');
export const passwordPair = z.object({password:strongPassword,confirmPassword:z.string()})
  .refine(value=>value.password===value.confirmPassword,{message:'Passwords do not match',path:['confirmPassword']});
