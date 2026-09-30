import { createNativeBackend } from './native/backend';
import { createStoreWithBackend } from './ICloudStore';
import type { ICloudConfig, ICloudStore } from './types';

export function createICloudStore(config?: ICloudConfig): ICloudStore {
  return createStoreWithBackend(createNativeBackend(), config);
}
