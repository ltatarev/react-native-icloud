import Foundation
import NitroModules

/// The native iCloud backend. The JS store is the only caller.
///
/// All names are relative to the configured directory in the container.
/// Every method resolves the container in the same way (`containerURL()`).
/// Failures throw a message that starts with `[<ICloudErrorCode>]`.
final class ReactNativeIcloud: HybridReactNativeIcloudSpec, @unchecked Sendable {
  private static let infoPlistKey = "ICloudContainerIdentifier"
  private static let pollInterval: TimeInterval = 0.1

  private let fileManager = FileManager.default
  private let kvStore = NSUbiquitousKeyValueStore.default
  private let lock = NSLock()

  private var config = NativeConfig(container: nil, directory: "Documents")
  private var listeners: [Double: (RawEvent) -> Void] = [:]
  private var nextListenerId: Double = 1

  // Main thread only.
  private var query: NSMetadataQuery?
  private var observerTokens: [NSObjectProtocol] = []
  private var observedDirectoryPath: String?

  // MARK: - Errors

  private func failure(_ code: String, _ message: String) -> RuntimeError {
    return RuntimeError.error(withMessage: "[\(code)] \(message)")
  }

  private func failure(_ code: String, _ message: String, _ error: Error) -> RuntimeError {
    let nsError = error as NSError
    if nsError.domain == NSCocoaErrorDomain && nsError.code == NSFileWriteOutOfSpaceError {
      return failure("quotaExceeded", "\(message): \(nsError.localizedDescription)")
    }
    return failure(code, "\(message): \(nsError.localizedDescription)")
  }

  // MARK: - Container

  private func currentConfig() -> NativeConfig {
    lock.lock()
    defer { lock.unlock() }
    return config
  }

  /// Config first, then Info.plist. nil means the first container in the
  /// entitlement, which is what `url(forUbiquityContainerIdentifier: nil)` uses.
  private func requestedContainer() -> (String?, ContainerSource) {
    if let container = currentConfig().container, !container.isEmpty {
      return (container, .config)
    }
    if let container = Bundle.main.object(forInfoDictionaryKey: Self.infoPlistKey) as? String,
       !container.isEmpty {
      return (container, .infoplist)
    }
    return (nil, .entitlement)
  }

  /// Blocks. Call it off the main thread.
  private func resolveContainer() -> (url: URL?, usedFallback: Bool) {
    let (requested, _) = requestedContainer()
    guard let requested else {
      return (fileManager.url(forUbiquityContainerIdentifier: nil), false)
    }
    if let url = fileManager.url(forUbiquityContainerIdentifier: requested) {
      return (url, false)
    }
    // Keep the fallback of the original module: use the default container
    // when the requested id is not reachable.
    let fallback = fileManager.url(forUbiquityContainerIdentifier: nil)
    return (fallback, fallback != nil)
  }

  private func directoryURL() throws -> URL {
    guard fileManager.ubiquityIdentityToken != nil else {
      throw failure("notSignedIn", "No iCloud account is signed in")
    }
    guard let containerURL = resolveContainer().url else {
      throw failure("containerUnavailable", "The iCloud container is not reachable")
    }
    let directory = currentConfig().directory
    return directory.isEmpty ? containerURL : containerURL.appendingPathComponent(directory)
  }

  private func itemURL(_ name: String) throws -> URL {
    return try directoryURL().appendingPathComponent(name)
  }

  // MARK: - Placeholders

  // An item that is in iCloud but not on this device is a ".<name>.icloud"
  // placeholder. fileExists() is false for the real path in that case.
  private func placeholderURL(for url: URL) -> URL {
    return url.deletingLastPathComponent()
      .appendingPathComponent(".\(url.lastPathComponent).icloud")
  }

  private func placeholderTarget(_ fileName: String) -> String? {
    guard fileName.hasPrefix("."), fileName.hasSuffix(".icloud"), fileName.count > 8 else {
      return nil
    }
    return String(fileName.dropFirst().dropLast(".icloud".count))
  }

  private func existsLocallyOrInCloud(_ url: URL) -> Bool {
    return fileManager.fileExists(atPath: url.path)
      || fileManager.fileExists(atPath: placeholderURL(for: url).path)
  }

  private func isCurrent(_ url: URL) -> Bool {
    guard fileManager.fileExists(atPath: url.path) else {
      return false
    }
    guard let values = try? url.resourceValues(forKeys: [.ubiquitousItemDownloadingStatusKey]),
          let status = values.ubiquitousItemDownloadingStatus else {
      // Not an ubiquitous item.
      return true
    }
    return status == .current
  }

  /// Starts the download and waits up to `timeoutMs`. Best effort.
  private func downloadIfNeeded(_ url: URL, timeoutMs: Double) {
    guard !isCurrent(url) else {
      return
    }
    do {
      try fileManager.startDownloadingUbiquitousItem(at: url)
    } catch {
      return
    }
    let deadline = Date().addingTimeInterval(timeoutMs / 1000)
    while Date() < deadline {
      if isCurrent(url) {
        return
      }
      Thread.sleep(forTimeInterval: Self.pollInterval)
    }
  }

  /// The placeholder is a property list that holds the size of the real file.
  private func placeholderSize(_ url: URL) -> Double {
    guard let data = try? Data(contentsOf: url),
          let plist = try? PropertyListSerialization.propertyList(
            from: data, options: PropertyListSerialization.ReadOptions(), format: nil
          ),
          let values = plist as? [String: Any],
          let size = values["NSURLFileSizeKey"] as? NSNumber else {
      return 0
    }
    return size.doubleValue
  }

  private func makeStat(name: String, url: URL) -> RawStat? {
    let isPlaceholder = !fileManager.fileExists(atPath: url.path)
    let path = isPlaceholder ? placeholderURL(for: url).path : url.path
    guard let attributes = try? fileManager.attributesOfItem(atPath: path) else {
      return nil
    }
    let modifiedAt = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
    let isDirectory = (attributes[.type] as? FileAttributeType) == .typeDirectory
    let size = isPlaceholder
      ? placeholderSize(placeholderURL(for: url))
      : (attributes[.size] as? NSNumber)?.doubleValue ?? 0
    return RawStat(
      name: name,
      size: size,
      modifiedAt: (modifiedAt * 1000).rounded(.down),
      isDownloaded: !isPlaceholder && isCurrent(url),
      isDirectory: isDirectory
    )
  }

  // MARK: - Coordination

  private func coordinateRead<T>(_ url: URL, _ body: (URL) throws -> T) throws -> T {
    var coordinatorError: NSError?
    var result: Result<T, Error>?
    NSFileCoordinator(filePresenter: nil).coordinate(
      readingItemAt: url, options: [], error: &coordinatorError
    ) { coordinatedURL in
      result = Result { try body(coordinatedURL) }
    }
    if let coordinatorError {
      throw failure("coordinationFailed", "Could not coordinate a read", coordinatorError)
    }
    guard let result else {
      throw failure("coordinationFailed", "The coordinated read did not run")
    }
    return try result.get()
  }

  private func coordinateWrite(
    _ url: URL,
    _ options: NSFileCoordinator.WritingOptions,
    _ body: (URL) throws -> Void
  ) throws {
    var coordinatorError: NSError?
    var result: Result<Void, Error>?
    NSFileCoordinator(filePresenter: nil).coordinate(
      writingItemAt: url, options: options, error: &coordinatorError
    ) { coordinatedURL in
      result = Result { try body(coordinatedURL) }
    }
    if let coordinatorError {
      throw failure("coordinationFailed", "Could not coordinate a write", coordinatorError)
    }
    guard let result else {
      throw failure("coordinationFailed", "The coordinated write did not run")
    }
    try result.get()
  }

  private func createParentDirectory(of url: URL) {
    try? fileManager.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true,
      attributes: nil
    )
  }

  // MARK: - Setup

  func configure(config: NativeConfig) throws {
    lock.lock()
    self.config = config
    lock.unlock()
  }

  func containerInfo() throws -> Promise<ContainerInfo> {
    return Promise.parallel { [self] in
      let (requested, source) = requestedContainer()
      let isSignedIn = fileManager.ubiquityIdentityToken != nil
      let resolved = isSignedIn ? resolveContainer() : (url: nil, usedFallback: false)
      return ContainerInfo(
        requestedContainer: requested,
        containerSource: source,
        containerPath: resolved.url?.path,
        usedFallback: resolved.usedFallback,
        isSignedIn: isSignedIn
      )
    }
  }

  func isAvailable() throws -> Promise<Bool> {
    return Promise.parallel { [self] in
      return (try? directoryURL()) != nil
    }
  }

  // MARK: - Documents

  func read(name: String, timeoutMs: Double) throws -> Promise<String?> {
    return Promise.parallel { [self] in
      let url = try itemURL(name)
      guard existsLocallyOrInCloud(url) else {
        return nil
      }
      downloadIfNeeded(url, timeoutMs: timeoutMs)
      guard fileManager.fileExists(atPath: url.path) else {
        throw failure("downloadTimeout", "\(name) did not download in \(Int(timeoutMs))ms")
      }
      return try coordinateRead(url) { coordinatedURL in
        do {
          return try String(contentsOf: coordinatedURL, encoding: .utf8)
        } catch {
          throw failure("coordinationFailed", "Could not read \(name)", error)
        }
      }
    }
  }

  func write(name: String, data: String) throws -> Promise<Void> {
    return Promise.parallel { [self] in
      let url = try itemURL(name)
      // Use the parent of the item, so nested names such as "images/a.jpg" work.
      createParentDirectory(of: url)
      try coordinateWrite(url, .forReplacing) { coordinatedURL in
        do {
          try data.write(to: coordinatedURL, atomically: true, encoding: .utf8)
          // Consumers compare modification dates to find the newer copy.
          try fileManager.setAttributes(
            [.modificationDate: Date()], ofItemAtPath: coordinatedURL.path
          )
        } catch {
          throw failure("writeFailed", "Could not write \(name)", error)
        }
      }
    }
  }

  func stat(name: String, timeoutMs: Double) throws -> Promise<RawStat?> {
    return Promise.parallel { [self] in
      let url = try itemURL(name)
      guard existsLocallyOrInCloud(url) else {
        return nil
      }
      if timeoutMs > 0 {
        downloadIfNeeded(url, timeoutMs: timeoutMs)
      }
      return makeStat(name: name, url: url)
    }
  }

  func remove(name: String) throws -> Promise<Void> {
    return Promise.parallel { [self] in
      let url = try itemURL(name)
      guard existsLocallyOrInCloud(url) else {
        return
      }
      try coordinateWrite(url, .forDeleting) { coordinatedURL in
        do {
          if fileManager.fileExists(atPath: coordinatedURL.path) {
            try fileManager.removeItem(at: coordinatedURL)
          } else {
            try fileManager.removeItem(at: placeholderURL(for: coordinatedURL))
          }
        } catch {
          throw failure("writeFailed", "Could not delete \(name)", error)
        }
      }
    }
  }

  func list(directory: String) throws -> Promise<[RawStat]> {
    return Promise.parallel { [self] in
      let base = try directoryURL()
      let url = directory.isEmpty ? base : base.appendingPathComponent(directory)
      guard fileManager.fileExists(atPath: url.path) else {
        return []
      }
      let children: [String]
      do {
        children = try fileManager.contentsOfDirectory(atPath: url.path)
      } catch {
        throw failure("coordinationFailed", "Could not list \(directory)", error)
      }

      // A real file and its placeholder can both exist for a short time.
      var names = Set<String>()
      for child in children {
        names.insert(placeholderTarget(child) ?? child)
      }
      return names.sorted().compactMap { child in
        let name = directory.isEmpty ? child : "\(directory)/\(child)"
        return makeStat(name: name, url: url.appendingPathComponent(child))
      }
    }
  }

  func startDownload(name: String) throws -> Promise<Void> {
    return Promise.parallel { [self] in
      let url = try itemURL(name)
      guard existsLocallyOrInCloud(url) else {
        throw failure("notFound", "\(name) does not exist")
      }
      do {
        try fileManager.startDownloadingUbiquitousItem(at: url)
      } catch {
        throw failure("coordinationFailed", "Could not start the download of \(name)", error)
      }
    }
  }

  // MARK: - Binary files

  func copyIn(localPath: String, name: String) throws -> Promise<Void> {
    return Promise.parallel { [self] in
      let source = URL(fileURLWithPath: localPath)
      let destination = try itemURL(name)
      guard fileManager.fileExists(atPath: source.path) else {
        throw failure("notFound", "The source file does not exist: \(localPath)")
      }
      createParentDirectory(of: destination)
      try coordinateWrite(destination, .forReplacing) { coordinatedURL in
        do {
          if fileManager.fileExists(atPath: coordinatedURL.path) {
            try fileManager.removeItem(at: coordinatedURL)
          }
          try fileManager.copyItem(at: source, to: coordinatedURL)
        } catch {
          throw failure("writeFailed", "Could not upload \(name)", error)
        }
      }
    }
  }

  func copyOut(name: String, localPath: String, timeoutMs: Double) throws -> Promise<Bool> {
    return Promise.parallel { [self] in
      let source = try itemURL(name)
      let destination = URL(fileURLWithPath: localPath)
      guard existsLocallyOrInCloud(source) else {
        return false
      }
      downloadIfNeeded(source, timeoutMs: timeoutMs)
      guard fileManager.fileExists(atPath: source.path) else {
        throw failure("downloadTimeout", "\(name) did not download in \(Int(timeoutMs))ms")
      }
      createParentDirectory(of: destination)
      try coordinateRead(source) { coordinatedURL in
        do {
          if fileManager.fileExists(atPath: destination.path) {
            try fileManager.removeItem(at: destination)
          }
          try fileManager.copyItem(at: coordinatedURL, to: destination)
        } catch {
          throw failure("coordinationFailed", "Could not download \(name)", error)
        }
      }
      return true
    }
  }

  // MARK: - Key-value store

  func kvGet(key: String) throws -> String? {
    return kvStore.string(forKey: key)
  }

  func kvSet(key: String, value: String) throws {
    kvStore.set(value, forKey: key)
  }

  func kvRemove(key: String) throws {
    kvStore.removeObject(forKey: key)
  }

  func kvKeys() throws -> [String] {
    return Array(kvStore.dictionaryRepresentation.keys)
  }

  func kvSynchronize() throws -> Promise<Bool> {
    return Promise.parallel { [self] in
      return kvStore.synchronize()
    }
  }

  // MARK: - Events

  func addListener(listener: @escaping (RawEvent) -> Void) throws -> Double {
    lock.lock()
    let id = nextListenerId
    nextListenerId += 1
    listeners[id] = listener
    let isFirst = listeners.count == 1
    lock.unlock()

    if isFirst {
      startObservers()
    }
    return id
  }

  func removeListener(id: Double) throws {
    lock.lock()
    let wasPresent = listeners.removeValue(forKey: id) != nil
    let isEmpty = listeners.isEmpty
    lock.unlock()

    if wasPresent && isEmpty {
      stopObservers()
    }
  }

  private func emit(_ event: RawEvent) {
    lock.lock()
    let current = Array(listeners.values)
    lock.unlock()
    for listener in current {
      listener(event)
    }
  }

  private func standardizedPath(_ url: URL) -> String {
    return url.resolvingSymlinksInPath().standardizedFileURL.path
  }

  private func startObservers() {
    // Resolve the directory off the main thread. The query needs a run loop,
    // so it starts on the main thread.
    DispatchQueue.global().async { [self] in
      let directoryPath = (try? directoryURL()).map { standardizedPath($0) }
      DispatchQueue.main.async { [self] in
        guard query == nil else {
          return
        }
        lock.lock()
        let hasListeners = !listeners.isEmpty
        lock.unlock()
        guard hasListeners else {
          return
        }
        observedDirectoryPath = directoryPath
        startMetadataQuery()
        observeKeyValueStore()
        observeAccount()
      }
    }
  }

  private func stopObservers() {
    DispatchQueue.main.async { [self] in
      lock.lock()
      let hasListeners = !listeners.isEmpty
      lock.unlock()
      guard !hasListeners else {
        return
      }
      query?.stop()
      query = nil
      for token in observerTokens {
        NotificationCenter.default.removeObserver(token)
      }
      observerTokens = []
    }
  }

  private func startMetadataQuery() {
    let metadataQuery = NSMetadataQuery()
    metadataQuery.searchScopes = [
      NSMetadataQueryUbiquitousDocumentsScope,
      NSMetadataQueryUbiquitousDataScope,
    ]
    metadataQuery.predicate = NSPredicate(format: "%K LIKE '*'", NSMetadataItemFSNameKey)
    observerTokens.append(NotificationCenter.default.addObserver(
      forName: .NSMetadataQueryDidUpdate, object: metadataQuery, queue: .main
    ) { [weak self] notification in
      self?.handleQueryUpdate(notification)
    })
    query = metadataQuery
    metadataQuery.start()
  }

  private func handleQueryUpdate(_ notification: Notification) {
    guard let directoryPath = observedDirectoryPath, let query else {
      return
    }
    query.disableUpdates()
    defer { query.enableUpdates() }

    let keys = [
      NSMetadataQueryUpdateAddedItemsKey,
      NSMetadataQueryUpdateChangedItemsKey,
      NSMetadataQueryUpdateRemovedItemsKey,
    ]
    let prefix = directoryPath.hasSuffix("/") ? directoryPath : directoryPath + "/"
    var names = Set<String>()
    for key in keys {
      let items = notification.userInfo?[key] as? [NSMetadataItem] ?? []
      for item in items {
        guard let url = item.value(forAttribute: NSMetadataItemURLKey) as? URL else {
          continue
        }
        let path = standardizedPath(url)
        if path.hasPrefix(prefix) {
          names.insert(String(path.dropFirst(prefix.count)))
        }
      }
    }
    guard !names.isEmpty else {
      return
    }
    emit(RawEvent(
      type: .documentschanged, names: names.sorted(), keys: [], reason: nil, isAvailable: nil
    ))
  }

  private func observeKeyValueStore() {
    observerTokens.append(NotificationCenter.default.addObserver(
      forName: NSUbiquitousKeyValueStore.didChangeExternallyNotification,
      object: kvStore,
      queue: .main
    ) { [weak self] notification in
      self?.handleKeyValueChange(notification)
    })
    // The store sends change notifications only after the first synchronize.
    kvStore.synchronize()
  }

  private func handleKeyValueChange(_ notification: Notification) {
    let keys = notification.userInfo?[NSUbiquitousKeyValueStoreChangedKeysKey] as? [String] ?? []
    let reasonCode = notification.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int
    let reason: KeyValueChangeReason
    switch reasonCode {
    case NSUbiquitousKeyValueStoreServerChange: reason = .serverchange
    case NSUbiquitousKeyValueStoreInitialSyncChange: reason = .initialsyncchange
    case NSUbiquitousKeyValueStoreQuotaViolationChange: reason = .quotaviolationchange
    case NSUbiquitousKeyValueStoreAccountChange: reason = .accountchange
    default: reason = .unknown
    }
    emit(RawEvent(
      type: .keyvaluechanged, names: [], keys: keys, reason: reason, isAvailable: nil
    ))
  }

  private func observeAccount() {
    observerTokens.append(NotificationCenter.default.addObserver(
      forName: .NSUbiquityIdentityDidChange, object: nil, queue: .main
    ) { [weak self] _ in
      DispatchQueue.global().async {
        guard let self else {
          return
        }
        let isAvailable = (try? self.directoryURL()) != nil
        self.emit(RawEvent(
          type: .availabilitychanged, names: [], keys: [], reason: nil, isAvailable: isAvailable
        ))
      }
    })
  }
}
