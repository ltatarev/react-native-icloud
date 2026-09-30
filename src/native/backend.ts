import { Platform } from 'react-native';
import type { NitroModules as NitroModulesType } from 'react-native-nitro-modules';
import type { ReactNativeIcloud } from '../ReactNativeIcloud.nitro';
import type { ICloudNativeBackend } from './types';

/**
 * Returns undefined off iOS and when the native module is not linked.
 * Nitro loads here, not at import, so non-iOS code never loads it.
 */
export function createNativeBackend(): ICloudNativeBackend | undefined {
  if (Platform.OS !== 'ios') {
    return undefined;
  }
  try {
    const { NitroModules } = require('react-native-nitro-modules') as {
      NitroModules: typeof NitroModulesType;
    };
    return NitroModules.createHybridObject<ReactNativeIcloud>(
      'ReactNativeIcloud',
    );
  } catch {
    return undefined;
  }
}
