# Weekly Pick’em

A Node.js/TypeScript and MySQL 8.4 football pick’em pool. Players submit ballots for commissioner approval. The app does not collect payments.

## Local setup

1. Copy `.env.example` to `.env`. Set `ADMIN_EMAIL` before registering the app administrator account.
2. Run `docker compose up -d mysql` and wait for MySQL to become healthy.
3. Run `npm install`, `npm run db:migrate`, then `npm run dev`.
4. Open http://localhost:3000, register, and import a schedule from App administration.

For compiled operation, run `npm run build` and `npm start`. Run tests with `npm test`.

After importing teams, `npm run db:seed-demo` creates a labeled completed demo week with fictional players, picks, and results. Demo accounts cannot log in.

## Entries and results

Players can create multiple numbered entries per week. Each ballot requires one selection per game and a predicted combined score for the tiebreaker game.

- Save a draft with `PUT /api/groups/:groupId/weeks/:weekId/entry`.
- Submit it with `POST /api/groups/:groupId/entries/:entryId/submit-review`.
- Pending entries are locked until approved or rejected. Rejected entries can be edited and resubmitted before the deadline.
- Decisions create in-app notifications. Approved picks become visible to signed-in players after the deadline.

The app administrator enters shared final results and scores the week. Winners are calculated independently for each group: most correct picks wins, followed by the smallest absolute tiebreaker difference. Exact ties remain co-winners. No payment processing or payouts are performed.

Accounts use salted scrypt password hashes and HTTP-only session cookies.

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
