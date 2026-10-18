import { createMemoryICloudStore } from './index';

describe('createMemoryICloudStore', () => {
  it('reads seeded documents and resolves undefined for absent ones', async () => {
    const store = createMemoryICloudStore({
      documents: { 'a.json': '{"a":1}' },
    });

    await expect(store.doc('a.json').read()).resolves.toEqual({ a: 1 });
    await expect(store.doc('missing').read()).resolves.toBeUndefined();
  });

  it('rejects a placeholder read with downloadTimeout until it downloads', async () => {
    const store = createMemoryICloudStore({
      documents: { 'state.lumee': 'x' },
    });
    store.setDownloaded('state.lumee', false);

    await expect(store.doc('state.lumee').readRaw()).rejects.toMatchObject({
      code: 'downloadTimeout',
    });
    await expect(store.doc('state.lumee').stat()).resolves.toMatchObject({
      isDownloaded: false,
    });

    store.setDownloaded('state.lumee', true);

    await expect(store.doc('state.lumee').readRaw()).resolves.toBe('x');
  });

  it('lists top-level items with nested names as directories', async () => {
    const store = createMemoryICloudStore({
      documents: { 'state.lumee': 'x' },
      files: { 'images/a.jpg': 'aa', 'images/b.jpg': 'bb' },
    });

    const top = await store.list();
    const images = await store.list({ directory: 'images' });

    expect(top.map(item => [item.name, item.isDirectory])).toEqual([
      ['images', true],
      ['state.lumee', false],
    ]);
    expect(images.map(item => item.name)).toEqual([
      'images/a.jpg',
      'images/b.jpg',
    ]);
  });

  it('removes a directory with its content', async () => {
    const store = createMemoryICloudStore({ files: { 'images/a.jpg': 'aa' } });

    await store.doc('images').delete();

    await expect(store.list()).resolves.toEqual([]);
  });

  it('copies files between the device and the container', async () => {
    const store = createMemoryICloudStore({
      localFiles: { '/local/a.jpg': 'aa' },
    });

    await store.files.upload('/local/a.jpg', 'images/a.jpg');
    await expect(
      store.files.download('images/a.jpg', '/other/a.jpg'),
    ).resolves.toBe('/other/a.jpg');

    expect(store.readLocalFile('/other/a.jpg')).toBe('aa');
    await expect(
      store.files.upload('/local/missing.jpg', 'images/b.jpg'),
    ).rejects.toMatchObject({ code: 'notFound' });
  });

  it('rejects with notSignedIn while unavailable and emits the change', async () => {
    const store = createMemoryICloudStore();
    const listener = jest.fn();
    store.subscribe(listener);

    store.setAvailable(false);

    await expect(store.isAvailable()).resolves.toBe(false);
    await expect(store.doc('a').readRaw()).rejects.toMatchObject({
      code: 'notSignedIn',
    });
    expect(listener).toHaveBeenCalledWith({
      isAvailable: false,
      type: 'availabilityChanged',
    });
  });

  it('fails only the next call with failNext', async () => {
    const store = createMemoryICloudStore();
    store.failNext('quotaExceeded');

    await expect(store.doc('a').writeRaw('1')).rejects.toMatchObject({
      code: 'quotaExceeded',
    });
    await expect(store.doc('a').writeRaw('1')).resolves.toBeUndefined();
  });

  it('fails only the named operation with failNext', async () => {
    const store = createMemoryICloudStore({ documents: { a: '1' } });
    store.failNext('writeFailed', 'remove');

    await expect(store.doc('a').readRaw()).resolves.toBe('1');
    await expect(store.doc('a').delete()).rejects.toMatchObject({
      code: 'writeFailed',
    });
    await expect(store.doc('a').delete()).resolves.toBeUndefined();
  });

  it('emits documentsChanged for a remote write, with a newer date', async () => {
    const store = createMemoryICloudStore({
      documents: { 'state.lumee': 'old' },
    });
    const listener = jest.fn();
    store.subscribe(listener);
    const before = await store.doc('state.lumee').stat();

    store.remoteWrite('state.lumee', 'new');

    const after = await store.doc('state.lumee').stat();
    expect(listener).toHaveBeenCalledWith({
      names: ['state.lumee'],
      type: 'documentsChanged',
    });
    expect(after?.modifiedAt).toBeGreaterThan(before?.modifiedAt ?? 0);
    expect(store.peek('state.lumee')).toBe('new');
  });

  it('removes every item and key with deleteAll', async () => {
    const store = createMemoryICloudStore({
      documents: { 'state.lumee': 'x' },
      files: { 'images/a.jpg': 'aa' },
      kv: { key: 'value' },
    });

    await store.deleteAll();

    await expect(store.list()).resolves.toEqual([]);
    expect(store.kv.keys()).toEqual([]);
  });
});
