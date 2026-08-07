# Weekly Pick’em

Node.js/TypeScript and MySQL 8.4 foundation for a weekly football pick’em pool. Entries remain drafts until Stripe reports a successful payment through a signature-verified webhook.

## Local setup

1. Copy `.env.example` to `.env` and add Stripe test credentials.
2. Start MySQL with `docker compose up -d mysql`.
3. Run `npm install`, `npm run db:migrate`, then `npm run dev`.
4. Forward Stripe test events with `stripe listen --forward-to localhost:3000/webhooks/stripe` and copy its signing secret into `.env`.

To preview a completed previous-week dashboard with fake players, paid entries, picks, results, and a prize pool, run `npm run db:seed-demo`. The seed is clearly labeled and safe to run repeatedly. Demo accounts use reserved `.invalid` email addresses and cannot log in.

Registration and login use salted scrypt password hashes and opaque, HTTP-only session cookies. Set `ADMIN_EMAIL` before registering the commissioner account; that matching account receives administrator access.

## Implemented flow

- `PUT /api/weeks/:weekId/entry` validates and saves a complete draft ballot.
- `POST /api/entries/:entryId/checkout` creates one idempotent Stripe Checkout Session.
- `POST /webhooks/stripe` verifies the raw-body signature and atomically changes payment to `paid` and entry to `submitted`.
- Duplicate webhook events are ignored safely.
- `charge.updated` reconciles Stripe's exact processing fee and net pool contribution once its balance transaction is available.

The success redirect is informational only and never submits an entry. The web interface also includes weekly ballots, standings, and commissioner forms for schedules, results, scoring, and pool calculation.

## Schedule import and team badges

The commissioner screen can import a complete regular season from the nflverse schedules release or upload the same `games.csv` format manually. Imports are repeatable: stable external game IDs update scheduled kickoff times instead of creating duplicates. Schedule data is provided by [nflverse](https://github.com/nflverse/nflverse-data) under its published CC-BY-4.0 license.

All 32 teams use locally served PNG artwork from `public/logos` when those files are installed, with locally rendered color-and-abbreviation badges available as a fallback. A commissioner can also provide a custom HTTPS logo URL when adding a team. Obtain appropriate permission before publicly distributing trademarked artwork.

## Money model

When payments are explicitly enabled, amounts are stored as integer cents and each payment tracks gross, Stripe processing fee, and net contribution separately. Exact ties split a configured pool evenly, with any remainder cents assigned by entry ID. Payments and payouts should remain disabled unless the contest and processor eligibility are independently confirmed.

## Commissioner pick review

Payments are disabled by default with `PAYMENTS_ENABLED=false`. In this mode, a player saves a complete ballot and submits it for review. The entry becomes locked in `pending_review`, commissioner accounts receive an in-app badge and review-queue item, and only an approved entry moves to `submitted`. Rejected entries unlock for correction and can be submitted again. The public community board continues to enforce the weekly deadline before revealing approved selections.

Players may create multiple numbered entries for the same week. Each entry has independent picks, a tiebreaker, review status, history, scoring, and public-board row. Approval and rejection decisions create player notifications in the in-app inbox; unread notifications appear as a badge on the hamburger menu.
