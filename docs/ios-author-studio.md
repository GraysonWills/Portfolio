# Private iPhone Author Studio

The existing Angular authoring console is packaged as a Capacitor 8 iOS app. It runs the production web bundle locally inside the app and continues to use the existing Cognito and `api.grayson-wills.com` backend.

## What is included

- Native iPhone shell with bundle identifier `com.graysonwills.authorstudio`.
- Branded app icon and launch screen sourced from `blog-authoring-gui/mobile-assets/`.
- Compact header, bottom navigation, create button, and mobile More menu.
- Draft-first post creation with email delivery disabled by default.
- Debounced local draft recovery for unsaved posts.
- Camera, photo-library, and file upload choices for images.
- Native browser handoff for portfolio previews and social authorization.
- App-switcher privacy protection and an automatic Face ID re-lock after 30 seconds in the background.
- Device-only Keychain storage for the Cognito refresh credential; ID and access tokens stay in memory on iOS.

## Architecture

```text
Author Studio.app
├── local Angular bundle (capacitor://localhost)
├── Capacitor runtime
│   ├── App / Browser / Camera / Keyboard
│   ├── privacy screen / splash / status bar
│   └── SecureSessionPlugin (Swift)
│       └── iPhone Keychain + Face ID
└── HTTPS
    ├── Cognito user pool
    ├── https://api.grayson-wills.com/api
    └── signed S3 media uploads
```

The iOS project is checked in at `blog-authoring-gui/ios/App/App.xcodeproj`. Capacitor dependencies use Swift Package Manager, so CocoaPods is not part of the normal build path.

## Build from the command line

Requirements on this Mac:

- Xcode 26 or newer.
- Node 22.14.0, recorded in `blog-authoring-gui/.nvmrc`.
- An Apple account/team selected in Xcode for a physical-device build.

```bash
cd /Users/grayson/Desktop/Portfolio/blog-authoring-gui
source "$HOME/.nvm/nvm.sh"
nvm use
npm ci
npm run mobile:check
```

`mobile:check` performs a production Angular build, runs `cap sync ios`, and compiles the app for a generic iOS Simulator without code signing.

If the SVG branding changes, run `npm run mobile:assets` before `mobile:check`. The generator rasterizes the SVG sources and removes the alpha channel required to keep the App Store/Xcode asset validator happy.

## Install on the private iPhone

1. Connect the iPhone to this Mac, unlock it, trust the Mac, and enable Developer Mode if iOS asks for it.
2. Run `npm run mobile:open` from `blog-authoring-gui`.
3. In Xcode, select the **App** target, open **Signing & Capabilities**, enable automatic signing, and select the intended Apple team.
4. Confirm the bundle identifier remains `com.graysonwills.authorstudio`.
5. Select the connected iPhone as the run destination and press **Run**.
6. If iOS requests approval for the developer certificate, follow the prompt in Settings and launch the app again.

No signing certificates, provisioning profiles, Apple credentials, or device identifiers belong in this repository. A direct Xcode installation keeps the app off the public App Store. The signing profile may need renewal depending on the Apple team used.

## Native session security

On iOS, the custom Swift bridge stores only the Cognito username and refresh token. The Keychain item uses:

- `kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly`
- `SecAccessControlCreateFlags.biometryCurrentSet`
- non-synchronizing, device-only storage

The app obtains short-lived ID/access tokens after biometric unlock and keeps them in memory. It clears native browser storage, re-locks after an extended background transition, obscures app-switcher snapshots, and revokes the refresh token on logout when the network is available. Removing the device passcode or changing the enrolled biometric set invalidates the protected item.

Local draft recovery is separate from authentication. Draft snapshots live in the app's sandboxed local storage and are capped at roughly 2.5 MB. They are not placed in the Keychain; exceptionally sensitive unpublished material would need a future encrypted-draft store.

## “Only my phone” boundary

Direct installation can make this app available only on the chosen iPhone, while Face ID and the device-only Keychain protect the stored credential. That is a strong practical boundary for a private authoring client.

It is not server-enforced device exclusivity. The backend still accepts a valid Cognito token from another approved client, and a determined account holder could use the web console. Enforcing one registered physical device at the API would require a follow-up phase using App Attest assertions, a backend device-registration record, replay protection, and rejection of authoring calls without valid device proof.

## Authentication and deep links

- Username/password Cognito login is supported in the native app.
- Native Google hosted login is intentionally blocked until it uses a dedicated Cognito public client with authorization-code + PKCE. The web implicit-token flow should not be reused in a native app.
- Social-provider flows open in the system browser and return through `authorstudio://oauth/social`.
- The API CORS allowlist includes the exact Capacitor origin `capacitor://localhost`; arbitrary origins are not accepted.

## Physical-device acceptance checklist

Run this list on the actual iPhone before treating the build as production-ready:

- [ ] Fresh install reaches Cognito login and signs in successfully.
- [ ] Face ID is required after a cold start with a stored session.
- [ ] Returning after more than 30 seconds in the background re-locks the app.
- [ ] The app switcher does not expose authoring content.
- [ ] “Sign in instead” removes the stored native credential before showing login.
- [ ] Logout clears the credential and returns to login.
- [ ] A changed Face ID enrollment or removed passcode invalidates the stored credential.
- [ ] Reinstalling the app does not silently reuse an older Keychain session.
- [ ] A new post starts as Draft with subscriber email off.
- [ ] Force-closing during an edit offers to restore the local draft.
- [ ] Camera capture, photo-library selection, HEIC/JPEG handling, compression, upload, and removal all work.
- [ ] Dashboard, Content Studio, AI Queue, Distribution, and the More sheet fit without horizontal scrolling.
- [ ] Public preview links and each configured social OAuth flow return to the app.
- [ ] Publishing, scheduling, unpublishing, and subscriber-email confirmation behave as expected.
- [ ] Offline/poor-network failures leave the local draft recoverable and do not imply that a server save succeeded.

## Release workflow after web changes

```bash
cd /Users/grayson/Desktop/Portfolio/blog-authoring-gui
source "$HOME/.nvm/nvm.sh"
nvm use
npm ci
npm test -- --watch=false --browsers=ChromeHeadless
npm run mobile:check
npm run mobile:open
```

Run `npm run mobile:sync` after every Angular or native-plugin dependency change before opening the iOS project. Native Swift source and Xcode signing settings remain in the checked-in iOS project; the generated web bundle is refreshed by Capacitor sync.
