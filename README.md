# Weekly Pick’em

A Node.js/TypeScript and MySQL 8.4 football pick’em pool. Players submit ballots for commissioner approval. The app does not collect payments.

## Local setup

1. Copy `.env.example` to `.env`. Set `ADMIN_EMAIL` before registering the app administrator account.
2. Run `docker compose up -d mysql` and wait for MySQL to become healthy.
3. Run `npm install`, then `npm run dev`. Pending database migrations run automatically before the server starts.
4. Open http://localhost:3000, register, and import a schedule from App administration.

For compiled operation, run `npm run build` and `npm start`. Run tests with `npm test`.

## Automatic migrations and deployment

Fresh deployments create empty application tables, plus migration-history records. Startup never runs demo seeding or copies data from another environment. Original pool is created only when upgrading a database that already contains users or results. Demo seeding is an explicit local command and is blocked when NODE_ENV=production. Existing records in an already-deployed database are not deleted.

Every startup checks `schema_migrations` and applies missing SQL files in order, under a database advisory lock. Existing data is preserved by the current migrations. Concurrent app instances wait for the same lock. Include the repository's `db/migrations` directory with the deployment; its location is resolved relative to the application files, not the shell's working directory.

Hostinger settings remain build `npm run build`, entry `dist/server.js`, and start `npm start`. Set the production `MYSQL_URL` before deployment; its user needs permission to create and alter tables. No separate Flyway installation or manual SSH migration command is required. `node dist/db/migrate.js` remains available for manual use after building.

Migrations support MySQL 8 and detect MariaDB's UCA 1400 accent-sensitive, case-insensitive collation when available. Unsupported group-name collations stop initialization before application tables are changed. Compatibility must still be confirmed for the database version in your hosting account.

MySQL/MariaDB DDL is not transactionally rolled back. An interrupted migration is marked in `schema_migration_failures` and blocks automatic retry. Repair/complete that migration and reconcile its history before clearing the marker; do not blindly remove it. Runtime logs identify failed migration filenames and database error codes without printing connection credentials.

After importing teams, `npm run db:seed-demo` creates a labeled completed demo week with fictional players, picks, and results. Demo accounts cannot log in.

## Entries and results

Players can create multiple numbered entries per week. Each ballot requires one selection per game and a predicted combined score for the tiebreaker game.

- Save a draft with `PUT /api/groups/:groupId/weeks/:weekId/entry`.
- Submit it with `POST /api/groups/:groupId/entries/:entryId/submit-review`.
- Pending entries are locked until approved or rejected. Rejected entries can be edited and resubmitted before the deadline.
- Decisions create in-app notifications. Approved picks become visible to signed-in players after the deadline.

The app administrator enters shared final results and scores the week. Winners are calculated independently for each group: most correct picks wins, followed by the smallest absolute tiebreaker difference. Exact ties remain co-winners. No payment processing or payouts are performed.

Accounts use salted scrypt password hashes and HTTP-only session cookies.

New passwords and password resets require matching confirmation and 10–128 characters, including uppercase, lowercase, a number, and a special character. Existing accounts can still sign in with their current passwords.

## Local email and password recovery

Run `docker compose up -d` to start MySQL and MailHog, or `docker compose up -d mailhog` to start email alone. MailHog captures local mail on SMTP port 1025; open http://localhost:8025 to read it. It runs separately from the Node app and does not deliver mail to real inboxes.

Use Forgot password on the sign-in screen. Reset links expire after 30 minutes, work once, and invalidate existing sessions when used. Recovery requests are rate-limited and return the same message for known and unknown addresses. Set APP_URL to the address users open; SMTP_HOST, SMTP_PORT, SMTP_SECURE, optional SMTP_USER/SMTP_PASSWORD, and MAIL_FROM configure email delivery. Restart Node after changing these variables. For deployment, configure an actual SMTP provider instead of MailHog.

With local services running, `npm run test:password-reset` checks email delivery, token expiration, single use, and session invalidation using temporary fixtures.

The app also queues welcome emails for new registrations, commissioner email invitations, pick approval/rejection notices (including rejection reasons), and weekly results for group members when the administrator scores a week. Commissioners send invitations from **Group commissioner → Invite a player**; recipients sign in or register and paste the supplied invite code in My groups. Joining must be enabled. Invitations are limited to 20 per group per hour, with a one-hour cooldown per recipient.

Members without a submitted or pending-review entry receive one reminder per group/week during the 24 hours before an open week's deadline. Reminders require a scheduled game and are cancelled if the member submits, leaves, or the week closes before delivery. No historical registration emails are backfilled. Unchanged rescoring does not repeat results emails; changed scores can send updated results.

Migration 010 creates `email_outbox` automatically on startup. A worker starts with the Node server and checks every minute, sending up to 10 queued messages per pass. Failed messages retry after five minutes, up to five attempts; exhausted attempts are logged with the queue item ID and retained for inspection. A database lock coordinates multiple app instances. SMTP delivery is at-least-once: a crash after SMTP acceptance but before recording success can duplicate a message. The server must remain running for reminders; expired reminders are skipped after downtime. Password reset emails still send immediately.

## Schedules and badges

The app administrator can import a regular season from [nflverse](https://github.com/nflverse/nflverse-data) or upload its games.csv format. Repeated imports update schedules using stable external game IDs. Downloads require outbound internet access from the server. Schedule data is provided under nflverse's published CC-BY-4.0 license.

Team logos are served from public/logos; local badge routes are also available. Obtain appropriate permission before publicly distributing trademarked artwork.

Historical migrations retain unused payment tables and monetary columns for compatibility with existing databases. Current code does not read payment records or accept payments.

## Groups and permissions

Any registered player can create a group and becomes that group's commissioner. Commissioners share an invite code from My groups; players use it to join. Players may belong to multiple groups and switch between them using the current-group selector.

Group names are unique across the app, ignoring capitalization and extra whitespace. Display capitalization is preserved. A database unique index prevents simultaneous requests from creating duplicates; invite codes remain the way to join a group.

Commissioners' own picks submit immediately without review. In Group commissioner, commissioners and app administrators can toggle member pick approval, multiple entries per week, and joining by invite code, or replace the invite code. All three toggles default to enabled. Approval changes affect future submissions; pending entries still need a decision. Disabling multiple entries preserves existing ballots. Disabling joining or rotating codes never removes existing members. Deadlines still apply to everyone.

Each group has independent entries, entry numbering, picks, standings, review queues, and notifications. Commissioners approve or reject only their group's entries. Group creation never grants app administrator privileges. Schedules, deadlines, and game results are shared and managed by the app administrator, who can oversee every group.

Migration 006 preserves existing entries and memberships in Original pool, with the earliest existing administrator as its commissioner. New registrations do not join it automatically.

Run `npm run test:groups` after database migrations and importing teams to test group permissions and scoring against the configured database. The test creates isolated fixtures and removes them afterward.
