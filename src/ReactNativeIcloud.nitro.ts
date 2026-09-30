import type { HybridObject } from 'react-native-nitro-modules';

/** Where the native module found the container id. */
export type ContainerSource = 'config' | 'infoPlist' | 'entitlement';

export interface NativeConfig {
  /** Ubiquity container id. Omit to use Info.plist, then the entitlement. */
  container?: string;
  /** Subdirectory in the container that holds all names. */
  directory: string;
}

export interface ContainerInfo {
  /** The container id to use, or undefined for the first entitlement. */
  requestedContainer?: string;
  containerSource: ContainerSource;
  /** Undefined when the user is not signed in or no container is reachable. */
  containerPath?: string;
  /** True when the requested id failed and the first entitlement was used. */
  usedFallback: boolean;
  isSignedIn: boolean;
}

export interface RawStat {
  /** Relative to the configured directory. Placeholder names are resolved. */
  name: string;
  size: number;
  /** Epoch milliseconds. */
  modifiedAt: number;
  /** False while the item is an undownloaded `.icloud` placeholder. */
  isDownloaded: boolean;
  isDirectory: boolean;
}

export type RawEventType =
  | 'documentsChanged'
  | 'keyValueChanged'
  | 'availabilityChanged';

export type KeyValueChangeReason =
  | 'serverChange'
  | 'initialSyncChange'
  | 'quotaViolationChange'
  | 'accountChange'
  | 'unknown';

export interface RawEvent {
  type: RawEventType;
  /** Changed names for `documentsChanged`. Empty for other types. */
  names: string[];
  /** Changed keys for `keyValueChanged`. Empty for other types. */
  keys: string[];
  reason?: KeyValueChangeReason;
  isAvailable?: boolean;
}

/**
 * The native iCloud backend. Failures reject with a message that starts
 * with `[<ICloudErrorCode>]`. The JS store maps them to `ICloudError`.
 */
export interface ReactNativeIcloud
  extends HybridObject<{ ios: 'swift' }> {
  /** Set the container and directory. Call before any other method. */
  configure(config: NativeConfig): void;
  containerInfo(): Promise<ContainerInfo>;

  /** Signed in and the container is reachable. */
  isAvailable(): Promise<boolean>;

  /**
   * Read a UTF-8 file. Starts the download of a placeholder and waits up to
   * `timeoutMs`. Resolves undefined when the item does not exist.
   */
  read(name: string, timeoutMs: number): Promise<string | undefined>;
  /** Coordinated, atomic write. Creates the parent directories. */
  write(name: string, data: string): Promise<void>;
  /**
   * Resolves undefined when the item does not exist. With `timeoutMs` > 0,
   * starts the download of a placeholder and waits up to `timeoutMs`.
   */
  stat(name: string, timeoutMs: number): Promise<RawStat | undefined>;
  /** Coordinated delete. Resolves when the item does not exist. */
  remove(name: string): Promise<void>;
  /** The direct children of `directory`, relative to the configured one. */
  list(directory: string): Promise<RawStat[]>;
  startDownload(name: string): Promise<void>;

  /** Copy a local file into the container. */
  copyIn(localPath: string, name: string): Promise<void>;
  /**
   * Copy an item out of the container. Waits up to `timeoutMs` for a
   * placeholder. Resolves false when the item does not exist.
   */
  copyOut(name: string, localPath: string, timeoutMs: number): Promise<boolean>;

  kvGet(key: string): string | undefined;
  kvSet(key: string, value: string): void;
  kvRemove(key: string): void;
  kvKeys(): string[];
  /** Resolves false when the store cannot synchronize. */
  kvSynchronize(): Promise<boolean>;

  /** Starts the observers with the first listener. Returns a listener id. */
  addListener(listener: (event: RawEvent) => void): number;
  /** Stops the observers after the last listener is removed. */
  removeListener(id: number): void;
}
