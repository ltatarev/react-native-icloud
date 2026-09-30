import { NitroModules } from 'react-native-nitro-modules';
import type { ReactNativeIcloud } from './ReactNativeIcloud.nitro';

const ReactNativeIcloudHybridObject =
  NitroModules.createHybridObject<ReactNativeIcloud>('ReactNativeIcloud');

export function multiply(a: number, b: number): number {
  return ReactNativeIcloudHybridObject.multiply(a, b);
}
