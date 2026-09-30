import type { ICloudNativeBackend } from './native/types';
import { ICloudError, toICloudError } from './errors';
import type { RawEvent, RawStat } from './ReactNativeIcloud.nitro';
import type {
  Codec,
  DocumentInfo,
  ICloudChangeEvent,
  ICloudConfig,
  ICloudDocument,
  ICloudStore,
  StatOptions,
} from './types';

const DEFAULT_DIRECTORY = 'Documents';
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15000;
const DEFAULT_IDLE_TIMEOUT_MS = 60000;

const jsonCodec: Codec<unknown> = {
  decode: raw => JSON.parse(raw) as unknown,
  encode: value => JSON.stringify(value),
};

const noop = (): void => undefined;

const toInfo = (raw: RawStat): DocumentInfo => ({
  isDirectory: raw.isDirectory,
  isDownloaded: raw.isDownloaded,
  modifiedAt: raw.modifiedAt,
  name: raw.name,
  size: raw.size,
});

const toEvent = (raw: RawEvent): ICloudChangeEvent => {
  switch (raw.type) {
    case 'documentsChanged':
      return { names: raw.names, type: 'documentsChanged' };
    case 'keyValueChanged':
      return {
        keys: raw.keys,
        reason: raw.reason ?? 'unknown',
        type: 'keyValueChanged',
      };
    case 'availabilityChanged':
      return {
        isAvailable: raw.isAvailable ?? false,
        type: 'availabilityChanged',
      };
  }
};

/**
 * Build a store over a backend. `undefined` means the platform has no
 * backend: `isSupported()` is false and every other call rejects with
 * `unsupportedPlatform`.
 */
export function createStoreWithBackend(
  backend: ICloudNativeBackend | undefined,
  config: ICloudConfig = {},
): ICloudStore {
  const directory = config.directory ?? DEFAULT_DIRECTORY;
  const downloadTimeoutMs =
    config.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const onError = config.onError ?? noop;

  backend?.configure({ container: config.container, directory });

  const inFlightWrites = new Set<Promise<void>>();
  const writeQueues = new Map<string, Promise<void>>();

  const fail = (error: unknown): ICloudError => {
    const iCloudError = toICloudError(error);
    onError(iCloudError);
    return iCloudError;
  };

  const requireBackend = (): ICloudNativeBackend => {
    if (!backend) {
      throw fail(
        new ICloudError(
          'unsupportedPlatform',
          'iCloud is not supported on this platform',
        ),
      );
    }
    return backend;
  };

  const call = async <T>(
    operation: (native: ICloudNativeBackend) => Promise<T>,
  ): Promise<T> => {
    const native = requireBackend();
    try {
      return await operation(native);
    } catch (error) {
      throw fail(error);
    }
  };

  const callSync = <T>(operation: (native: ICloudNativeBackend) => T): T => {
    const native = requireBackend();
    try {
      return operation(native);
    } catch (error) {
      throw fail(error);
    }
  };

  /** Runs after the previous write to the same name settles. */
  const trackWrite = <T>(
    name: string,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const previous = writeQueues.get(name) ?? Promise.resolve();
    // Release before the caller resumes, so isIdle() is true after `await`.
    const release = (): void => {
      inFlightWrites.delete(settled);
      if (writeQueues.get(name) === settled) {
        writeQueues.delete(name);
      }
    };
    const run = previous.then(async () => {
      try {
        return await operation();
      } finally {
        release();
      }
    });
    const settled = run.then(noop, noop);

    inFlightWrites.add(settled);
    writeQueues.set(name, settled);
    return run;
  };

  const remove = (name: string): Promise<void> =>
    trackWrite(name, () => call(native => native.remove(name)));

  const stat = async (
    name: string,
    options: StatOptions = {},
  ): Promise<DocumentInfo | undefined> => {
    const raw = await call(native =>
      native.stat(name, options.downloadTimeoutMs ?? 0),
    );
    return raw ? toInfo(raw) : undefined;
  };

  const list = async (
    options: { directory?: string } = {},
  ): Promise<DocumentInfo[]> => {
    const raws = await call(native => native.list(options.directory ?? ''));
    return raws.map(toInfo);
  };

  const doc = <T = unknown>(
    name: string,
    codec: Codec<T> = jsonCodec as Codec<T>,
  ): ICloudDocument<T> => {
    const readRaw = (): Promise<string | undefined> =>
      call(native => native.read(name, downloadTimeoutMs));
    const writeRaw = (data: string): Promise<void> =>
      trackWrite(name, () => call(native => native.write(name, data)));

    return {
      delete: () => remove(name),
      exists: async () => (await stat(name)) !== undefined,
      name,
      read: async () => {
        const raw = await readRaw();
        return raw === undefined ? undefined : codec.decode(raw);
      },
      readRaw,
      stat: options => stat(name, options),
      write: value => writeRaw(codec.encode(value)),
      writeRaw,
    };
  };

  const waitUntilIdle = async (
    timeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
  ): Promise<boolean> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let isTimedOut = false;
    const timeout = new Promise<void>(resolve => {
      timer = setTimeout(() => {
        isTimedOut = true;
        resolve();
      }, timeoutMs);
    });
    try {
      while (inFlightWrites.size > 0 && !isTimedOut) {
        await Promise.race([Promise.all(inFlightWrites), timeout]);
      }
      return inFlightWrites.size === 0;
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    deleteAll: async () => {
      const items = await list();
      let firstError: unknown;
      for (const item of items) {
        try {
          await remove(item.name);
        } catch (error) {
          firstError ??= error;
        }
      }
      const kvKeys = callSync(native => native.kvKeys());
      for (const key of kvKeys) {
        callSync(native => native.kvRemove(key));
      }
      if (kvKeys.length > 0) {
        await call(native => native.kvSynchronize());
      }
      if (firstError !== undefined) {
        throw firstError;
      }
    },
    doc,
    files: {
      delete: remove,
      download: async (name, localPath) => {
        const isCopied = await call(native =>
          native.copyOut(name, localPath, downloadTimeoutMs),
        );
        return isCopied ? localPath : undefined;
      },
      exists: async name => (await stat(name)) !== undefined,
      list,
      upload: (localPath, name) =>
        trackWrite(name, () => call(native => native.copyIn(localPath, name))),
    },
    getContainerPath: async () =>
      (await call(native => native.containerInfo())).containerPath,
    isAvailable: () => call(native => native.isAvailable()),
    isIdle: () => inFlightWrites.size === 0,
    isSupported: () => backend !== undefined,
    kv: {
      get: key => callSync(native => native.kvGet(key)),
      keys: () => callSync(native => native.kvKeys()),
      remove: key => callSync(native => native.kvRemove(key)),
      set: (key, value) => callSync(native => native.kvSet(key, value)),
      synchronize: async () => {
        const isSynchronized = await call(native => native.kvSynchronize());
        if (!isSynchronized) {
          throw fail(
            new ICloudError(
              'writeFailed',
              'The key-value store did not synchronize',
            ),
          );
        }
      },
    },
    list,
    subscribe: listener => {
      if (!backend) {
        return noop;
      }
      const id = callSync(native =>
        native.addListener(raw => listener(toEvent(raw))),
      );
      return () => callSync(native => native.removeListener(id));
    },
    waitUntilIdle,
  };
}
