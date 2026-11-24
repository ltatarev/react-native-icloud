# @ltatarev/react-native-icloud

[![npm version](https://img.shields.io/npm/v/@ltatarev/react-native-icloud)](https://www.npmjs.com/package/@ltatarev/react-native-icloud)
[![npm downloads](https://img.shields.io/npm/dm/@ltatarev/react-native-icloud)](https://www.npmjs.com/package/@ltatarev/react-native-icloud)
[![CI](https://img.shields.io/github/actions/workflow/status/ltatarev/react-native-icloud/ci.yml?branch=main&label=CI)](https://github.com/ltatarev/react-native-icloud/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@ltatarev/react-native-icloud)](LICENSE)
![platform](https://img.shields.io/badge/platform-iOS-lightgrey)
[![Nitro module](https://img.shields.io/badge/Nitro-module-blue)](https://nitro.margelo.com)

iCloud for React Native on iOS: the ubiquity container, documents, binary
files, the key-value store, change events and setup checks. The package is a
[Nitro module](https://nitro.margelo.com). It has no Android code. On other
platforms, `isSupported()` is `false`.

The package owns the iCloud plumbing only. Your app owns what to sync and
how to merge it.

## Install

```sh
yarn add @ltatarev/react-native-icloud react-native-nitro-modules
cd ios && pod install
```

The package needs `react-native-nitro-modules` 0.36.5 or later.

The repository commits `nitrogen/generated/`, so a CI build does not have to
run nitrogen. When you change `src/ReactNativeIcloud.nitro.ts`, run
`yarn nitrogen` and commit the result.

## Set up iCloud

Do all steps. `diagnose()` tells you which step is missing.

1. In the Apple Developer portal, open the App ID. Enable **iCloud** and
   assign an iCloud container, for example `iCloud.com.example`.
2. In Xcode, open **Signing & Capabilities** for the app target. Add
   **iCloud**. Select **iCloud Documents** and **Key-value storage**. Select
   the container.
3. Make sure that the entitlements file has these keys:

   ```xml
   <key>com.apple.developer.icloud-container-identifiers</key>
   <array><string>iCloud.com.example</string></array>
   <key>com.apple.developer.icloud-services</key>
   <array><string>CloudDocuments</string></array>
   <key>com.apple.developer.ubiquity-container-identifiers</key>
   <array><string>iCloud.com.example</string></array>
   <key>com.apple.developer.ubiquity-kvstore-identifier</key>
   <string>$(TeamIdentifierPrefix)$(CFBundleIdentifier)</string>
   ```

4. Add the container id to `Info.plist`. The package reads it from there when
   you do not pass `container`:

   ```xml
   <key>ICloudContainerIdentifier</key>
   <string>iCloud.com.example</string>
   ```

5. Optional: to show the `Documents` folder in the Files app, declare the
   container in `Info.plist`:

   ```xml
   <key>NSUbiquitousContainers</key>
   <dict>
     <key>iCloud.com.example</key>
     <dict>
       <key>NSUbiquitousContainerIsDocumentScopePublic</key><true/>
       <key>NSUbiquitousContainerName</key><string>Example</string>
       <key>NSUbiquitousContainerSupportedFolderLevels</key><string>Any</string>
     </dict>
   </dict>
   ```

6. Sign in to iCloud on the test device. A simulator can sign in too, but
   the sync between devices is slow there.

### Container resolution

The package uses the first match:

1. `config.container`.
2. `ICloudContainerIdentifier` in `Info.plist`.
3. The first container in the entitlement.

When the id from step 1 or 2 is not reachable, the package uses the default
container (step 3), and `diagnose()` reports the fallback. iOS has no public
API to read the entitlements at runtime, so the package cannot check them
directly.

## Use

```ts
import { createICloudStore } from '@ltatarev/react-native-icloud';

const store = createICloudStore({
  directory: 'Documents', // default
  downloadTimeoutMs: 15000, // default
  onError: error => report(error),
  onLog: entry => log(`icloud.${entry.operation}`, entry),
});

if (store.isSupported() && (await store.isAvailable())) {
  await store.doc<Settings>('settings.json').write({ theme: 'dark' });
  const settings = await store.doc<Settings>('settings.json').read();

  await store.files.upload(localPath, 'images/a.jpg');
  await store.files.download('images/a.jpg', otherLocalPath);

  const items = await store.list(); // name, size, modifiedAt, isDownloaded
}
```

Create one store per app and keep it.

- **Documents.** `doc(name, codec)` returns a handle. The default codec is
  JSON. For a string that you already serialized, pass a codec that returns
  the string unchanged, and use `readRaw()` and `writeRaw()`.
- **Placeholders.** An item that is in iCloud but not on the device is a
  placeholder. `read()` and `files.download()` start the download and wait up
  to `downloadTimeoutMs`. Then they reject with `downloadTimeout`. `stat()`
  does not download unless you pass `downloadTimeoutMs`.
- **Write order.** Writes to the same name run one after the other. Writes
  to different names run in parallel.
- **Idle.** `isIdle()` and `waitUntilIdle(timeoutMs)` track the writes in
  flight. Call `waitUntilIdle()` before you delete everything.
- **Key-value store.** `kv.get`, `kv.set`, `kv.remove`, `kv.keys` and
  `kv.synchronize`. The limits are 1 MB and 1024 keys.
- **Events.** `subscribe(listener)` starts the native observers with the
  first listener and stops them after the last one. The events are
  `documentsChanged`, `keyValueChanged` and `availabilityChanged`.

## Errors

Reads resolve to `undefined` when the item does not exist. All other
failures reject with `ICloudError`. Its `code` is one of these:

| Code | Meaning |
| --- | --- |
| `unsupportedPlatform` | Not iOS, or the native module is not linked. |
| `notSignedIn` | No iCloud account on the device. |
| `containerUnavailable` | The container is not reachable. |
| `notFound` | The source file of an upload does not exist. |
| `downloadTimeout` | A placeholder did not download in time. Try again later. |
| `coordinationFailed` | The file coordinator or a file operation failed. |
| `quotaExceeded` | The iCloud storage of the user is full. |
| `writeFailed` | A write or delete failed. |

`onError` receives every failure. `onLog` receives every native operation
with its name, duration, outcome, error code and a short result summary. The
summary never holds file content.

## Troubleshooting

Call `await store.diagnose()`. It never throws. Each entry in `problems`
names the step to fix.

| Problem | Fix |
| --- | --- |
| The native module is not linked | Run `pod install` and rebuild the app. |
| No iCloud account is signed in | Sign in to iCloud in the device Settings. |
| `<id>` is not reachable, so the default container is used | Add `<id>` to both container entitlements (step 3), or fix the id in `Info.plist`. |
| No container is reachable | Check the capability (step 2), the entitlements (step 3) and the App ID (step 1). |
| `list failed` | Read the error code in the message. |

## Tests

`@ltatarev/react-native-icloud/testing` has an in-memory store with the same
behavior as the native one. It needs no native code, so it runs in node.

```ts
import { createMemoryICloudStore } from '@ltatarev/react-native-icloud/testing';

const store = createMemoryICloudStore({
  documents: { 'state.json': '{}' },
  files: { 'images/a.jpg': 'bytes' },
  localFiles: { '/device/a.jpg': 'bytes' },
});

store.remoteWrite('state.json', '{"v":2}'); // a second device writes
store.setDownloaded('state.json', false); // the file is a placeholder
store.setAvailable(false); // the user signs out
store.failNext('writeFailed', 'remove'); // the next delete fails
store.peek('state.json'); // the stored content, with no checks
```

Run the package tests with:

```sh
yarn test
```

## Example app

`example/` is a test bed with one button for each store method, a status
panel and a log of every native operation. It uses its own container,
`iCloud.com.ltatarev.icloud-example`. To run it on a device:

```sh
yarn
yarn example ios
```

`example/TESTING.md` has the device checklist.
