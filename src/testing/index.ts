import { createStoreWithBackend } from '../ICloudStore';
import type { ICloudConfig, ICloudStore } from '../types';
import {
  createMemoryBackend,
  type MemoryControls,
  type MemoryOperation,
  type MemorySeed,
} from './memoryBackend';

export type MemoryICloudStore = ICloudStore & MemoryControls;

/**
 * A store over the in-memory backend, with controls to simulate a second
 * device, placeholders, account changes and failures. For tests.
 */
export function createMemoryICloudStore(
  seed?: MemorySeed,
  config?: ICloudConfig,
): MemoryICloudStore {
  const backend = createMemoryBackend(seed);
  const store = createStoreWithBackend(backend, config);
  return {
    ...store,
    failNext: backend.failNext,
    peek: backend.peek,
    readLocalFile: backend.readLocalFile,
    remoteWrite: backend.remoteWrite,
    setAvailable: backend.setAvailable,
    setDownloaded: backend.setDownloaded,
    writeLocalFile: backend.writeLocalFile,
  };
}

export type { MemoryControls, MemoryOperation, MemorySeed };
export { createMemoryBackend };
