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
2. Create stable App Review commissioner/member demo accounts and sample content.
3. [x] Introduce a configurable API base URL and a mobile-safe authentication flow.
4. Add Capacitor and generate the Xcode project on macOS.
5. Add app icons, launch assets, native sharing, deep links, and lifecycle handling.
6. Add Apple Push Notification service registration and notification preferences.
7. Test on physical iPhones and distribute a release candidate through TestFlight.
8. Complete App Store privacy disclosures, screenshots, review notes, and submission.

Do not point a native build at production until the API-origin and mobile-session work is complete. The current same-origin cookie flow intentionally remains unchanged during Step 1.
