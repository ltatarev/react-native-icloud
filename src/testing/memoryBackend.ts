import type { ICloudErrorCode } from '../errors';
import type { ICloudNativeBackend } from '../native/types';
import type {
  NativeConfig,
  RawEvent,
  RawStat,
} from '../ReactNativeIcloud.nitro';

type Item = {
  data: string;
  modifiedAt: number;
  isDownloaded: boolean;
};

export type MemorySeed = {
  /** Container items by name. Nested names such as `images/a.jpg` work. */
  documents?: Record<string, string>;
  /** Binary container files. Same as documents; kept for readability. */
  files?: Record<string, string>;
  kv?: Record<string, string>;
  /** Device files that `copyIn` can read, by local path. */
  localFiles?: Record<string, string>;
};

export type MemoryControls = {
  /** Simulate a second device writing. Emits `documentsChanged`. */
  remoteWrite(name: string, data: string, modifiedAt?: number): void;
  /**
   * Mark an item as an undownloaded placeholder, or as downloaded. Reads of
   * a placeholder reject with `downloadTimeout` until it is downloaded.
   */
  setDownloaded(name: string, isDownloaded: boolean): void;
  /** Simulate an account change. Emits `availabilityChanged`. */
  setAvailable(isAvailable: boolean): void;
  /** Force the next backend call to reject with this code. */
  failNext(code: ICloudErrorCode): void;
  /** The content of a container item, without the placeholder check. */
  peek(name: string): string | undefined;
  readLocalFile(localPath: string): string | undefined;
  writeLocalFile(localPath: string, data: string): void;
};

const reject = (code: ICloudErrorCode, message: string): Promise<never> =>
  Promise.reject(new Error(`[${code}] ${message}`));

/**
 * An in-memory backend with the semantics of the native one: placeholders,
 * missing items, availability and failures. No native code, so it runs in
 * node.
 */
export function createMemoryBackend(
  seed: MemorySeed = {},
): ICloudNativeBackend & MemoryControls {
  const items = new Map<string, Item>();
  const kv = new Map<string, string>(Object.entries(seed.kv ?? {}));
  const localFiles = new Map<string, string>(
    Object.entries(seed.localFiles ?? {}),
  );
  const listeners = new Map<number, (event: RawEvent) => void>();
  let nextListenerId = 1;
  let isAvailable = true;
  let pendingFailure: ICloudErrorCode | undefined;
  let config: NativeConfig = { directory: 'Documents' };
  let lastModifiedAt = 0;

  const now = (): number => {
    lastModifiedAt = Math.max(Date.now(), lastModifiedAt + 1);
    return lastModifiedAt;
  };

  for (const [name, data] of Object.entries({
    ...seed.documents,
    ...seed.files,
  })) {
    items.set(name, { data, isDownloaded: true, modifiedAt: now() });
  }

  const emit = (event: RawEvent): void => {
    for (const listener of listeners.values()) {
      listener(event);
    }
  };

  /** Rejects when a failure is queued or the account is signed out. */
  const guard = (): Promise<void> | undefined => {
    if (pendingFailure) {
      const code = pendingFailure;
      pendingFailure = undefined;
      return reject(code, 'Forced failure');
    }
    if (!isAvailable) {
      return reject('notSignedIn', 'No iCloud account is signed in');
    }
    return undefined;
  };

  const run = async <T>(operation: () => T | Promise<T>): Promise<T> => {
    await (guard() ?? Promise.resolve());
    return operation();
  };

  const isInside = (name: string, directory: string): boolean =>
    directory === '' || name.startsWith(`${directory}/`);

  const statOf = (name: string): RawStat | undefined => {
    const item = items.get(name);
    if (item) {
      return {
        isDirectory: false,
        isDownloaded: item.isDownloaded,
        modifiedAt: item.modifiedAt,
        name,
        size: item.data.length,
      };
    }
    const children = [...items.keys()].filter(key => isInside(key, name));
    if (name === '' || children.length === 0) {
      return undefined;
    }
    return {
      isDirectory: true,
      isDownloaded: true,
      modifiedAt: Math.max(
        ...children.map(key => items.get(key)?.modifiedAt ?? 0),
      ),
      name,
      size: 0,
    };
  };

  const readItem = (name: string): string | undefined => {
    const item = items.get(name);
    if (!item) {
      return undefined;
    }
    if (!item.isDownloaded) {
      throw new Error(`[downloadTimeout] ${name} did not download`);
    }
    return item.data;
  };

  return {
    addListener: listener => {
      const id = nextListenerId;
      nextListenerId += 1;
      listeners.set(id, listener);
      return id;
    },
    configure: nextConfig => {
      config = nextConfig;
    },
    containerInfo: async () => ({
      containerPath: isAvailable ? '/memory' : undefined,
      containerSource: config.container ? 'config' : 'entitlement',
      isSignedIn: isAvailable,
      requestedContainer: config.container,
      usedFallback: false,
    }),
    copyIn: (localPath, name) =>
      run(() => {
        const data = localFiles.get(localPath);
        if (data === undefined) {
          throw new Error(`[notFound] The source file does not exist: ${localPath}`);
        }
        items.set(name, { data, isDownloaded: true, modifiedAt: now() });
      }),
    copyOut: (name, localPath) =>
      run(() => {
        const data = readItem(name);
        if (data === undefined) {
          return false;
        }
        localFiles.set(localPath, data);
        return true;
      }),
    failNext: code => {
      pendingFailure = code;
    },
    isAvailable: async () => {
      const failure = pendingFailure;
      if (failure) {
        pendingFailure = undefined;
        return reject(failure, 'Forced failure');
      }
      return isAvailable;
    },
    kvGet: key => kv.get(key),
    kvKeys: () => [...kv.keys()],
    kvRemove: key => {
      kv.delete(key);
    },
    kvSet: (key, value) => {
      kv.set(key, value);
    },
    kvSynchronize: () => run(() => true),
    list: directory =>
      run(() => {
        const names = new Set<string>();
        for (const key of items.keys()) {
          if (!isInside(key, directory)) {
            continue;
          }
          const rest = directory === '' ? key : key.slice(directory.length + 1);
          const child = rest.split('/')[0];
          names.add(directory === '' ? child : `${directory}/${child}`);
        }
        return [...names]
          .sort()
          .map(name => statOf(name))
          .filter((stat): stat is RawStat => stat !== undefined);
      }),
    peek: name => items.get(name)?.data,
    read: name => run(() => readItem(name)),
    readLocalFile: localPath => localFiles.get(localPath),
    remoteWrite: (name, data, modifiedAt) => {
      items.set(name, {
        data,
        isDownloaded: true,
        modifiedAt: modifiedAt ?? now(),
      });
      emit({ keys: [], names: [name], type: 'documentsChanged' });
    },
    remove: name =>
      run(() => {
        for (const key of [...items.keys()]) {
          if (key === name || isInside(key, name)) {
            items.delete(key);
          }
        }
      }),
    removeListener: id => {
      listeners.delete(id);
    },
    setAvailable: nextIsAvailable => {
      isAvailable = nextIsAvailable;
      emit({
        isAvailable: nextIsAvailable,
        keys: [],
        names: [],
        type: 'availabilityChanged',
      });
    },
    setDownloaded: (name, isDownloaded) => {
      const item = items.get(name);
      if (item) {
        item.isDownloaded = isDownloaded;
      }
    },
    startDownload: name =>
      run(() => {
        if (!statOf(name)) {
          throw new Error(`[notFound] ${name} does not exist`);
        }
      }),
    stat: name => run(() => statOf(name)),
    write: (name, data) =>
      run(() => {
        items.set(name, { data, isDownloaded: true, modifiedAt: now() });
      }),
    writeLocalFile: (localPath, data) => {
      localFiles.set(localPath, data);
    },
  };
}
