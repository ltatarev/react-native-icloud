import type { ReactNativeIcloud } from '../ReactNativeIcloud.nitro';

/**
 * The only surface the store uses. The Nitro hybrid object implements it,
 * and the in-memory test backend implements it without native code.
 */
export type ICloudNativeBackend = Pick<
  ReactNativeIcloud,
  | 'addListener'
  | 'configure'
  | 'containerInfo'
  | 'copyIn'
  | 'copyOut'
  | 'isAvailable'
  | 'kvGet'
  | 'kvKeys'
  | 'kvRemove'
  | 'kvSet'
  | 'kvSynchronize'
  | 'list'
  | 'read'
  | 'remove'
  | 'removeListener'
  | 'startDownload'
  | 'stat'
  | 'write'
>;
