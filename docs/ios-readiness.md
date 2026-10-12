# Huddle Pick'em iOS readiness

This branch prepares the existing web application for a later Capacitor iOS target. The production Node API and MySQL database remain the source of truth.

## Step 1: web-app preparation

- [x] Add standalone-app metadata and an install manifest.
- [x] Support iPhone safe areas and dynamic viewport height.
- [x] Keep form controls at an iOS-friendly font size.
- [x] Show a clear offline state and friendly failed-request message.
- [x] Preserve the existing HTTPS, HTTP-only cookie, origin-check, and password protections.
- [x] Confirm the project builds and its automated tests pass before native work.

## Remaining iOS work

1. [x] Add authenticated in-app account deletion and document retention behavior.
2. [x] Create stable App Review commissioner/member demo accounts and sample content.
3. [x] Introduce a configurable API base URL and a mobile-safe authentication flow.
4. [x] Add Capacitor, generate the iOS project, and store native sessions in iOS Keychain.
5. [x] Add app icons, launch assets, native sharing, deep links, and lifecycle handling.
6. [x] Add Apple Push Notification service registration and notification preferences.
7. Test on physical iPhones and distribute a release candidate through TestFlight.
8. Complete App Store privacy disclosures, screenshots, review notes, and submission.

Do not point a native build at production until the API-origin and mobile-session work is complete. The current same-origin cookie flow intentionally remains unchanged during Step 1.

## Step 2: App Review sample data

Create the commissioner and member accounts normally, put them in exactly one shared review group, and assign the expected roles. Configure `APP_REVIEW_COMMISSIONER_EMAIL` and `APP_REVIEW_MEMBER_EMAIL`, deploy a fresh build, then run `npm run app-review:setup` from the deployed application directory over SSH.

The command uses the next accessible open schedule week to create a submitted commissioner entry and a member entry awaiting approval. When a finalized week exists, it also creates scored pick history and a winner for that group. It sends no email, stores no passwords, changes no other group, and is safe to rerun. The entire operation rolls back if the accounts, shared group, roles, or open schedule week are not ready.

## Step 4: Capacitor iOS project

The website and iOS app share the files in `public`, but `npm run ios:build` creates a separate ignored `ios-web` bundle. That bundle enables native mode, points API requests to `https://huddlepickem.com`, and includes the Keychain-backed session bridge. Set `IOS_API_URL` when building to target another HTTPS API.

Use `npm run ios:sync` after changing web files or native plugins. On a Mac with Xcode installed, use `npm run ios:open`, select the Redcrows Solutions Apple development team, and choose a simulator or connected iPhone. The generated `ios` project is committed; the generated `ios-web` files are rebuilt locally and are not committed.

## Step 5: native experience

- The iOS asset catalog contains branded Huddle Pick'em app icons and light/dark launch artwork generated from the source files in `assets`.
- Commissioners can share a group invitation through the native iOS share sheet. The same button uses the browser share sheet or copies the invitation when used on the website.
- The app recognizes `huddlepickem://join?inviteCode=CODE` immediately. HTTPS invitations use `https://huddlepickem.com/?inviteCode=CODE`, which opens the website when the app is unavailable.
- Set `APPLE_TEAM_ID` to the 10-character Team ID from the Apple Developer portal to serve the Apple association file. The iOS target is prepared for `applinks:huddlepickem.com`; enabling Associated Domains for the App ID and verifying it on a device must be completed later with the Apple account and Xcode.
- Returning from the background refreshes deadlines, picks, notifications, and commissioner reviews without reloading the whole interface.

## Step 6: push notifications

- Migration `013_push_notifications.sql` creates per-user preferences, registered-device records, and a retryable push outbox. Account deletion removes all three through foreign-key cascades.
- The iOS Account screen requests notification permission only after the user selects **Enable notifications**. It registers the APNs device token with the signed-in account and removes that device association on logout.
- Push categories cover deadline reminders, commissioner review requests, approval/rejection decisions, weekly results, and group activity. They are queued from the same transactions as the corresponding service emails.
- The server sends APNs token-authenticated HTTP/2 requests, retries temporary failures, and removes invalid device tokens. Delivery remains inactive until all APNs environment variables are configured.
- On the Apple Developer portal, enable Push Notifications for `com.redcrowssolutions.huddlepickem` and create an APNs `.p8` key. Base64-encode the key file and configure `APPLE_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY_BASE64`, `APNS_TOPIC`, and `APNS_ENVIRONMENT` in Hostinger. Xcode capability verification and physical-device testing remain part of Step 7.
