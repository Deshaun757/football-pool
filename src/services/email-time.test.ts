import { describe, expect, it } from 'vitest';
import { formatEasternDateTime } from './email-outbox.js';

describe('email date formatting', () => {
  it('shows a UTC lock time on the correct Eastern calendar date during daylight time', () => {
    expect(formatEasternDateTime('2026-10-09T00:15:00.000Z'))
      .toBe('Thursday, October 8, 2026 at 8:15 PM EDT');
  });

  it('uses Eastern Standard Time after daylight saving time ends', () => {
    expect(formatEasternDateTime('2026-12-04T01:15:00.000Z'))
      .toBe('Thursday, December 3, 2026 at 8:15 PM EST');
  });
});
