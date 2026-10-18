# Device checklist

Use two iPhones with the same Apple ID, or one iPhone and a reinstall. A
simulator can sign in to iCloud, but the sync between devices is slow there.

## Before you start

1. In the Apple Developer portal, make sure that the iCloud container
   `iCloud.com.ltatarev.icloud-example` exists. Assign it to the App ID
   `com.ltatarev.icloud-example`, with iCloud Documents enabled. Xcode can
   do both: open **Signing & Capabilities** and select the container.
2. Sign in to iCloud on each device. Turn on iCloud Drive.
3. Run `yarn` at the repo root, then `yarn example ios`, and select the
   device. The first run installs the pods.

The app uses its own container. "Delete all" never touches Lumee data.

Each button writes its result to the **Log** section at the bottom. Native
operations show in grey with the duration and the result. Failures show in
red with the error code. Select a log line to copy it.

## Setup

- [ ] **Status** shows `Supported: true`, `Available: true`,
      `Signed in: true`, `Container: iCloud.com.ltatarev.icloud-example ·
      infoPlist`, a container path, and `Problems: none`.
- [ ] Sign out of iCloud in Settings, go back, tap **Refresh status**:
      `Signed in: false` and the problem names the missing account. Sign in
      again: the problem goes away.

## Documents

- [ ] **Write**, then **Read**: the log shows `{"text":"hello"}`.
- [ ] **Stat**: the size and `local`.
- [ ] **Delete**, then **Read**: `absent`. **Exists**: `false`.
- [ ] **Write 10× at once**: the log shows `last count=10 (expect 10)`.
      **Writes** shows `in flight` while the writes run.
- [ ] On device A, **Write** a new value. On device B, tap **List**, then
      **Read**. B shows the new value. If the item shows `placeholder`, the
      read downloads it first, and the log shows the wait.
- [ ] On B, **Subscribe to events**. Write on A. B logs a
      `documentsChanged` event and lists the items again.

## Files

- [ ] **Upload small file**, then **Download**: the log shows the size and
      the text `Uploaded at …`.
- [ ] **Upload 1 MB file** on A. On B, **Download**: `1048576 B`.
- [ ] **List** with the directory `files`: the uploaded file shows.
- [ ] **Delete**, then **Download**: `absent`.

## Key-value store

- [ ] **Set**, then **Get**: `hello`. **Keys**: `["greeting"]`.
- [ ] **Synchronize** succeeds.
- [ ] On A, **Set** a new value and **Synchronize**. On B, subscribe and
      wait: B logs a `keyValueChanged` event. **Get** shows the new value.
      This can take a minute.
- [ ] **Remove**, then **Get**: `absent`.

## Delete all

- [ ] Write some documents, files and keys. Tap **Delete all** and confirm.
      **List** shows no items and **Keys** shows `[]`.
- [ ] The other device shows no items after the next **List**.

## Files app

- [ ] The Files app shows an **iCloud Example** folder in iCloud Drive with
      the uploaded items. The folder can take some time to show.

## Report

Copy the red log lines and the **Status** section, and add them to the
issue.
