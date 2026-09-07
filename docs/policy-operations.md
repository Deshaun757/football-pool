# Huddle Pick'em policies and requests

Operator details supplied by the owner: Redcrows Solutions, Norfolk, Virginia, United States; support@huddlepickem.com. Create and monitor that mailbox before publication. Public pages live in `public/privacy.html`, `terms.html`, `rules.html`, `cookies.html`, and `support.html`.

These are app-specific legal drafts, not a determination of compliance in every jurisdiction. Have the operator's legal adviser review them before public launch, especially eligibility, external contests/prizes, applicable regional privacy laws, provider locations, retention, and the precise legal entity name. No mailing address, incorporation suffix, transfer certification, or universal privacy-law coverage was invented.

The drafting approach follows the FTC's guidance to explain actual practices and honor privacy promises: https://www.ftc.gov/business-guidance/privacy-security. Disclosure topics were also checked against the ICO's right-to-be-informed guidance: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/individual-rights/individual-rights/right-to-be-informed/. Inclusion of these topics does not establish that UK GDPR applies.

## Registration and updates

New registrations must explicitly submit `acceptTerms: true`. The database records version `2026-09-06` and a server timestamp. Existing users have NULL acceptance fields; do not represent them as having checked this agreement. Future material changes require a deliberate notice/acceptance workflow rather than simply changing the version recorded for existing people.

## Processing requests

Sign in as an app administrator and open `/support.html`. The Administrator request inbox shows requests and requester addresses. Ordinary users see only their own requests and do not need a group. Check the inbox and support mailbox regularly; the app does not send an email alert or promise a response deadline. Applicable statutory deadlines still need operational handling.

Verify account ownership proportionately. Reply through the monitored mailbox as needed. Access, correction, and deletion are manual reviews, not automatic actions performed by the Resolve button. Before deleting, review commissioner responsibilities, records shared with other players, delivery/support records, sessions, and any necessary preservation. Determine the appropriate deletion or de-identification approach, explain retained information and reasons, perform and verify the action, and then mark resolved. Do not request passwords or reset links. Marking resolved only updates tracking status; it does not email a reply or delete an account.

Account deletion cascades the new support and email records associated with that account, but existing pool relationships require separate review. No generic production deletion script is included, avoiding accidental destruction of group history. Define and implement a justified retention schedule for accounts, outbox messages, support requests, hosting logs, mailbox correspondence, and backups. The policy currently discloses the absence of automatic purging rather than promising a schedule that the app does not enforce.

## Preferences and verification

Reminder/results preferences apply across groups, persist on the user, and are checked again before sending queued mail. Reset, welcome, invitation, and pick-decision mail remain separate service messages. Preference links are included in reminder/results mail. No optional advertising/analytics integration was added, and no cosmetic consent banner claims to control nonexistent trackers.

Migration 011 runs automatically at startup. Run `npm run build`, `npm test`, and `node scripts/test-support.mjs` against a migrated local database. The integration script removes its fixtures. The existing group/password-reset integration scripts now submit the required Terms agreement.
