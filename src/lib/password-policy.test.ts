import { describe,it,expect } from 'vitest';
import { passwordPair,strongPassword } from './password-policy.js';
describe('new passwords',()=>{
  it('accepts a 10-character password and rejects 9',()=>{
    expect(strongPassword.safeParse('Abcdefg1!x').success).toBe(true);
    expect(strongPassword.safeParse('Abcdefg1!').success).toBe(false);
  });
  it('enforces maximum length and each character requirement',()=>{
    expect(strongPassword.safeParse('Aa1!'+ 'x'.repeat(124)).success).toBe(true);
    for(const value of ['Aa1!'+ 'x'.repeat(125),'abcdefgh1!','ABCDEFGH1!','Abcdefghi!','Abcdefghi1','Abcdefgh1 ']) expect(strongPassword.safeParse(value).success).toBe(false);
  });
  it('requires confirmation to match',()=>{
    expect(passwordPair.safeParse({password:'Abcdefg1!x',confirmPassword:'different'}).success).toBe(false);
    expect(passwordPair.safeParse({password:'Abcdefg1!x'}).success).toBe(false);
  });
});
