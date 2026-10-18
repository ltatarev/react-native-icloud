import type { ICloudNativeBackend } from './native/types';
import { ICloudError } from './errors';
import { createStoreWithBackend } from './ICloudStore';
import type { RawEvent, RawStat } from './ReactNativeIcloud.nitro';

type MockBackend = { [K in keyof ICloudNativeBackend]: jest.Mock };

const createMockBackend = (): MockBackend => ({
  addListener: jest.fn().mockReturnValue(7),
  configure: jest.fn(),
  containerInfo: jest.fn(),
  copyIn: jest.fn().mockResolvedValue(undefined),
  copyOut: jest.fn().mockResolvedValue(true),
  isAvailable: jest.fn().mockResolvedValue(true),
  kvGet: jest.fn(),
  kvKeys: jest.fn().mockReturnValue([]),
  kvRemove: jest.fn(),
  kvSet: jest.fn(),
  kvSynchronize: jest.fn().mockResolvedValue(true),
  list: jest.fn().mockResolvedValue([]),
  read: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
  removeListener: jest.fn(),
  startDownload: jest.fn().mockResolvedValue(undefined),
  stat: jest.fn().mockResolvedValue(undefined),
  write: jest.fn().mockResolvedValue(undefined),
});

const rawStat = (name: string, overrides: Partial<RawStat> = {}): RawStat => ({
  isDirectory: false,
  isDownloaded: true,
  modifiedAt: 1000,
  name,
  size: 10,
  ...overrides,
});

const deferred = (): {
  promise: Promise<void>;
  reject: (error: unknown) => void;
  resolve: () => void;
} => {
  let resolve: () => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<void>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

const flush = (): Promise<void> =>
  new Promise<void>(resolve => setImmediate(resolve));

describe('createStoreWithBackend', () => {
  it('configures the backend with the defaults', () => {
    const backend = createMockBackend();

    createStoreWithBackend(backend);

    expect(backend.configure).toHaveBeenCalledWith({
      container: undefined,
      directory: 'Documents',
    });
  });

  it('passes the configured container and directory', () => {
    const backend = createMockBackend();

    createStoreWithBackend(backend, {
      container: 'iCloud.com.example',
      directory: 'Data',
    });

    expect(backend.configure).toHaveBeenCalledWith({
      container: 'iCloud.com.example',
      directory: 'Data',
    });
  });
});

describe('without a backend', () => {
  it('is not supported and rejects with unsupportedPlatform', async () => {
    const onError = jest.fn();
    const store = createStoreWithBackend(undefined, { onError });

    expect(store.isSupported()).toBe(false);
    await expect(store.isAvailable()).rejects.toMatchObject({
      code: 'unsupportedPlatform',
    });
    expect(onError).toHaveBeenCalledWith(expect.any(ICloudError));
    expect(store.subscribe(jest.fn())).toEqual(expect.any(Function));
  });
});

describe('documents', () => {
  it('reads with the download timeout and decodes JSON', async () => {
    const backend = createMockBackend();
    backend.read.mockResolvedValue('{"a":1}');
    const store = createStoreWithBackend(backend, { downloadTimeoutMs: 5000 });

    await expect(store.doc('state.json').read()).resolves.toEqual({ a: 1 });
    expect(backend.read).toHaveBeenCalledWith('state.json', 5000);
  });

  it('resolves undefined for an absent document', async () => {
    const store = createStoreWithBackend(createMockBackend());

    await expect(store.doc('missing').read()).resolves.toBeUndefined();
    await expect(store.doc('missing').exists()).resolves.toBe(false);
  });

  it('uses a custom codec', async () => {
    const backend = createMockBackend();
    const store = createStoreWithBackend(backend);
    const codec = { decode: (raw: string) => raw, encode: (v: string) => v };

    await store.doc('state.lumee', codec).write('{"raw":true}');

    expect(backend.write).toHaveBeenCalledWith('state.lumee', '{"raw":true}');
  });

  it('maps a native rejection to ICloudError and reports it', async () => {
    const backend = createMockBackend();
    backend.read.mockRejectedValue(new Error('[downloadTimeout] slow'));
    const onError = jest.fn();
    const store = createStoreWithBackend(backend, { onError });

    const error = await store
      .doc('state.lumee')
      .readRaw()
      .catch(e => e);

    expect(error).toBeInstanceOf(ICloudError);
    expect(error).toMatchObject({ code: 'downloadTimeout', message: 'slow' });
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('passes the stat download timeout and maps the result', async () => {
    const backend = createMockBackend();
    backend.stat.mockResolvedValue(rawStat('state.lumee'));
    const store = createStoreWithBackend(backend);

    await expect(
      store.doc('state.lumee').stat({ downloadTimeoutMs: 3000 }),
    ).resolves.toEqual({
      isDirectory: false,
      isDownloaded: true,
      modifiedAt: 1000,
      name: 'state.lumee',
      size: 10,
    });
    expect(backend.stat).toHaveBeenCalledWith('state.lumee', 3000);
  });
});

describe('write serialization and idle tracking', () => {
  it('runs writes to the same name one after the other', async () => {
    const backend = createMockBackend();
    const first = deferred();
    backend.write.mockReturnValueOnce(first.promise);
    const store = createStoreWithBackend(backend);

    const writeA = store.doc('a').writeRaw('1');
    const writeB = store.doc('a').writeRaw('2');
    await flush();

    expect(backend.write).toHaveBeenCalledTimes(1);

    first.resolve();
    await Promise.all([writeA, writeB]);

    expect(backend.write).toHaveBeenLastCalledWith('a', '2');
  });

  it('runs the next write after a failed write', async () => {
    const backend = createMockBackend();
    backend.write.mockRejectedValueOnce(new Error('[writeFailed] disk'));
    const store = createStoreWithBackend(backend);

    const failed = store.doc('a').writeRaw('1');
    const next = store.doc('a').writeRaw('2');

    await expect(failed).rejects.toMatchObject({ code: 'writeFailed' });
    await expect(next).resolves.toBeUndefined();
  });

  it('does not serialize writes to different names', async () => {
    const backend = createMockBackend();
    backend.write.mockReturnValueOnce(deferred().promise);
    const store = createStoreWithBackend(backend);

    void store.doc('a').writeRaw('1');
    void store.doc('b').writeRaw('2');
    await flush();

    expect(backend.write).toHaveBeenCalledTimes(2);
  });

  it('reports idle only after every write settles', async () => {
    const backend = createMockBackend();
    const write = deferred();
    backend.write.mockReturnValueOnce(write.promise);
    const store = createStoreWithBackend(backend);

    expect(store.isIdle()).toBe(true);
    const pending = store.doc('a').writeRaw('1');
    const idle = store.waitUntilIdle();
    await flush();

    expect(store.isIdle()).toBe(false);

    write.resolve();
    await pending;

    await expect(idle).resolves.toBe(true);
    expect(store.isIdle()).toBe(true);
  });

  it('resolves false when writes do not drain in time', async () => {
    const backend = createMockBackend();
    const write = deferred();
    backend.write.mockReturnValueOnce(write.promise);
    const store = createStoreWithBackend(backend);

    const pending = store.doc('a').writeRaw('1');

    await expect(store.waitUntilIdle(10)).resolves.toBe(false);

    write.resolve();
    await pending;
  });
});

describe('files', () => {
  it('resolves the local path, or undefined when the file is absent', async () => {
    const backend = createMockBackend();
    backend.copyOut.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const store = createStoreWithBackend(backend, { downloadTimeoutMs: 5000 });

    await expect(
      store.files.download('images/a.jpg', '/local/a.jpg'),
    ).resolves.toBe('/local/a.jpg');
    await expect(
      store.files.download('images/b.jpg', '/local/b.jpg'),
    ).resolves.toBeUndefined();
    expect(backend.copyOut).toHaveBeenCalledWith(
      'images/a.jpg',
      '/local/a.jpg',
      5000,
    );
  });

  it('uploads through copyIn and tracks the write', async () => {
    const backend = createMockBackend();
    const store = createStoreWithBackend(backend);

    await store.files.upload('/local/a.jpg', 'images/a.jpg');

    expect(backend.copyIn).toHaveBeenCalledWith('/local/a.jpg', 'images/a.jpg');
    expect(store.isIdle()).toBe(true);
  });
});

describe('deleteAll', () => {
  it('removes every item and key, then rejects with the first failure', async () => {
    const backend = createMockBackend();
    backend.list.mockResolvedValue([rawStat('a'), rawStat('b'), rawStat('c')]);
    backend.remove.mockImplementation(async (name: string) => {
      if (name === 'b') {
        throw new Error('[writeFailed] locked');
      }
    });
    backend.kvKeys.mockReturnValue(['k']);
    const store = createStoreWithBackend(backend);

    await expect(store.deleteAll()).rejects.toMatchObject({
      code: 'writeFailed',
    });

    expect(backend.remove).toHaveBeenCalledTimes(3);
    expect(backend.kvRemove).toHaveBeenCalledWith('k');
    expect(backend.kvSynchronize).toHaveBeenCalled();
  });
});

describe('key-value store', () => {
  it('rejects synchronize with writeFailed when the store does not sync', async () => {
    const backend = createMockBackend();
    backend.kvSynchronize.mockResolvedValue(false);
    const store = createStoreWithBackend(backend);

    await expect(store.kv.synchronize()).rejects.toMatchObject({
      code: 'writeFailed',
    });
  });
});

describe('subscribe', () => {
  it('maps native events and removes the listener', () => {
    const backend = createMockBackend();
    const store = createStoreWithBackend(backend);
    const listener = jest.fn();

    const unsubscribe = store.subscribe(listener);
    const nativeListener = backend.addListener.mock.calls[0][0] as (
      event: RawEvent,
    ) => void;
    nativeListener({
      keys: [],
      names: ['state.lumee'],
      type: 'documentsChanged',
    });
    nativeListener({ keys: ['k'], names: [], type: 'keyValueChanged' });
    unsubscribe();

    expect(listener).toHaveBeenNthCalledWith(1, {
      names: ['state.lumee'],
      type: 'documentsChanged',
    });
    expect(listener).toHaveBeenNthCalledWith(2, {
      keys: ['k'],
      reason: 'unknown',
      type: 'keyValueChanged',
    });
    expect(backend.removeListener).toHaveBeenCalledWith(7);
  });
});

describe('onLog', () => {
  it('logs the operation, name, outcome and a short result', async () => {
    const backend = createMockBackend();
    backend.read.mockResolvedValue('12345');
    const onLog = jest.fn();
    const store = createStoreWithBackend(backend, { onLog });

    await store.doc('state.lumee').readRaw();

    expect(onLog).toHaveBeenCalledWith({
      durationMs: expect.any(Number),
      name: 'state.lumee',
      operation: 'read',
      outcome: 'ok',
      result: '5 chars',
    });
  });

  it('logs the error code and message of a failure', async () => {
    const backend = createMockBackend();
    backend.copyIn.mockRejectedValue(new Error('[notFound] no source'));
    const onLog = jest.fn();
    const store = createStoreWithBackend(backend, { onLog });

    await expect(store.files.upload('/a', 'images/a.jpg')).rejects.toThrow();

    expect(onLog).toHaveBeenCalledWith({
      code: 'notFound',
      durationMs: expect.any(Number),
      message: 'no source',
      name: 'images/a.jpg',
      operation: 'copyIn',
      outcome: 'error',
    });
  });
});

describe('diagnose', () => {
  const containerInfo = {
    containerPath: '/container',
    containerSource: 'infoPlist',
    isSignedIn: true,
    requestedContainer: 'iCloud.com.example',
    usedFallback: false,
  };

  it('reports no problems for a working setup', async () => {
    const backend = createMockBackend();
    backend.containerInfo.mockResolvedValue(containerInfo);
    backend.list.mockResolvedValue([rawStat('a'), rawStat('b')]);
    const store = createStoreWithBackend(backend);

    await expect(store.diagnose()).resolves.toEqual({
      containerPath: '/container',
      containerSource: 'infoPlist',
      directory: 'Documents',
      documentCount: 2,
      isAvailable: true,
      isSignedIn: true,
      isSupported: true,
      problems: [],
      requestedContainer: 'iCloud.com.example',
      usedFallback: false,
    });
  });

  it('names the missing native module', async () => {
    const result = await createStoreWithBackend(undefined).diagnose();

    expect(result.isSupported).toBe(false);
    expect(result.containerSource).toBe('unresolved');
    expect(result.problems[0]).toContain('pod install');
  });

  it('names a signed-out account', async () => {
    const backend = createMockBackend();
    backend.containerInfo.mockResolvedValue({
      ...containerInfo,
      containerPath: undefined,
      isSignedIn: false,
    });

    const result = await createStoreWithBackend(backend).diagnose();

    expect(result.problems).toEqual([
      'No iCloud account is signed in on this device.',
    ]);
  });

  it('names the fallback to the default container', async () => {
    const backend = createMockBackend();
    backend.containerInfo.mockResolvedValue({
      ...containerInfo,
      usedFallback: true,
    });

    const result = await createStoreWithBackend(backend).diagnose();

    expect(result.problems[0]).toContain('iCloud.com.example is not reachable');
  });

  it('names an unreachable container and a failed list, and never throws', async () => {
    const backend = createMockBackend();
    backend.containerInfo.mockResolvedValue({
      ...containerInfo,
      containerPath: undefined,
    });

    const unreachable = await createStoreWithBackend(backend).diagnose();
    expect(unreachable.problems[0]).toContain('No container is reachable');

    backend.containerInfo.mockResolvedValue(containerInfo);
    backend.list.mockRejectedValue(new Error('[coordinationFailed] busy'));

    const listFailed = await createStoreWithBackend(backend).diagnose();
    expect(listFailed.problems).toEqual([
      'list failed: [coordinationFailed] busy',
    ]);
  });
});
