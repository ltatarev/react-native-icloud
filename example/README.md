# Example app

A test bed that shows every part of `@ltatarev/react-native-icloud`: the
status and `diagnose()`, documents, file transfer, the key-value store and
the events. Each button calls one store method and writes the result to the
log at the bottom of the screen.

## Requirements

- An iPhone, or a simulator signed in to iCloud. Sync between devices is
  slow on a simulator.
- A paid Apple Developer account.
- Two iPhones with the same Apple ID for the checks in
  [`TESTING.md`](./TESTING.md). One iPhone and a reinstall also work.

## Set up signing

The project uses the container `iCloud.com.ltatarev.icloud-example` on the
bundle id `com.ltatarev.icloud-example`. To run it with your own team:

1. Open `ios/ReactNativeIcloudExample.xcworkspace` in Xcode.
2. Select your team on the app target.
3. Change the bundle id to an id that your team owns.
4. Change the container to a container that your team owns. Change it in
   these places:
   - `ReactNativeIcloudExample.entitlements`
   - `ICloudContainerIdentifier` and `NSUbiquitousContainers` in
     `Info.plist`

## Run

From the repository root:

```sh
yarn
yarn nitrogen
cd example && bundle install && bundle exec pod install --project-directory=ios && cd ..
yarn example ios --device
```

The app uses the local package source, so a JS change shows without a
rebuild. A native change needs a rebuild.

## Check on devices

Follow [`TESTING.md`](./TESTING.md). Mark each check that passes. Record
each check that you cannot do, and the reason.
