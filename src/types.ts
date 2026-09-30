import type { ICloudError, ICloudErrorCode } from './errors';
import type {
  ContainerSource,
  KeyValueChangeReason,
} from './ReactNativeIcloud.nitro';

export type ICloudConfig = {
  /** Ubiquity container id. Omit to use Info.plist, then the entitlement. */
  container?: string;
  /** Subdirectory in the container. Defaults to 'Documents'. */
  directory?: string;
  /** Max wait for a placeholder to download. Default 15000. */
  downloadTimeoutMs?: number;
  /** Called on every native failure. Default: no-op. */
  onError?: (error: ICloudError) => void;
  /** Called after every native operation. Default: no-op. */
  onLog?: (entry: ICloudLogEntry) => void;
};

export type ICloudLogEntry = {
  /** The native operation, such as `read` or `copyIn`. */
  operation: string;
  /** The document, file or directory name, when the operation has one. */
  name?: string;
  durationMs: number;
  outcome: 'ok' | 'error';
  /** A short summary, such as `12 chars` or `3 items`. No file content. */
  result?: string;
  code?: ICloudErrorCode;
  message?: string;
};

export type ICloudDiagnostics = {
  isSupported: boolean;
  /** The configured or Info.plist id. Undefined for the first entitlement. */
  requestedContainer: string | undefined;
  containerSource: ContainerSource | 'unresolved';
  /** True when the requested id failed and the default container is used. */
  usedFallback: boolean;
  isSignedIn: boolean;
  isAvailable: boolean;
  containerPath: string | undefined;
  directory: string;
  documentCount: number | undefined;
  /** Readable problems. Each one names the setup step to fix. */
  problems: string[];
};

export type DocumentInfo = {
  name: string;
  size: number;
  /** Epoch milliseconds. */
  modifiedAt: number;
  /** False while the item is an undownloaded `.icloud` placeholder. */
  isDownloaded: boolean;
  isDirectory: boolean;
};

export type Codec<T> = {
  encode(value: T): string;
  decode(raw: string): T;
};

export type StatOptions = {
  /** Download a placeholder first and wait up to this time. Default 0. */
  downloadTimeoutMs?: number;
};

export type ICloudDocument<T> = {
  readonly name: string;
  /** Downloads a placeholder first. Resolves undefined when absent. */
  read(): Promise<T | undefined>;
  /** Coordinated write. Serialized against other writes to the same name. */
  write(value: T): Promise<void>;
  readRaw(): Promise<string | undefined>;
  writeRaw(data: string): Promise<void>;
  stat(options?: StatOptions): Promise<DocumentInfo | undefined>;
  exists(): Promise<boolean>;
  /** Resolves when the document does not exist. */
  delete(): Promise<void>;
};

export type ICloudFiles = {
  upload(localPath: string, name: string): Promise<void>;
  /** Resolves the local path, or undefined when the file is absent. */
  download(name: string, localPath: string): Promise<string | undefined>;
  list(): Promise<DocumentInfo[]>;
  exists(name: string): Promise<boolean>;
  delete(name: string): Promise<void>;
};

/** NSUbiquitousKeyValueStore. 1MB total, 1024 keys. */
export type ICloudKeyValue = {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
  /** Rejects with `writeFailed` when the store cannot synchronize. */
  synchronize(): Promise<void>;
};

export type { KeyValueChangeReason };

export type ICloudChangeEvent =
  | { type: 'documentsChanged'; names: string[] }
  | { type: 'keyValueChanged'; keys: string[]; reason: KeyValueChangeReason }
  | { type: 'availabilityChanged'; isAvailable: boolean };

export type ICloudStore = {
  /** False off iOS, or when the native module is not linked. Never throws. */
  isSupported(): boolean;
  /** Signed in and the container is reachable. Not cached. */
  isAvailable(): Promise<boolean>;
  getContainerPath(): Promise<string | undefined>;

  /** Typed handle to one document. Cheap to create. */
  doc<T = unknown>(name: string, codec?: Codec<T>): ICloudDocument<T>;
  list(options?: { directory?: string }): Promise<DocumentInfo[]>;
  /** Removes every item in the directory and every key-value entry. */
  deleteAll(): Promise<void>;

  files: ICloudFiles;
  kv: ICloudKeyValue;

  subscribe(listener: (event: ICloudChangeEvent) => void): () => void;

  /** True when no write is in flight. */
  isIdle(): boolean;
  /** Resolves true when writes drain, false on timeout. Default 60000. */
  waitUntilIdle(timeoutMs?: number): Promise<boolean>;

  /** Checks the setup step by step. Never throws. */
  diagnose(): Promise<ICloudDiagnostics>;
};
