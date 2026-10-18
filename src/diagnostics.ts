import type { ICloudNativeBackend } from './native/types';
import { toICloudError } from './errors';
import type { DocumentInfo, ICloudDiagnostics } from './types';

type DiagnosticsInput = {
  backend: ICloudNativeBackend | undefined;
  directory: string;
  list: () => Promise<DocumentInfo[]>;
};

const errorText = (error: unknown): string => {
  const iCloudError = toICloudError(error);
  return `[${iCloudError.code}] ${iCloudError.message}`;
};

/**
 * Check the setup step by step. Never throws. Each problem names the step
 * to fix.
 */
export async function runDiagnostics({
  backend,
  directory,
  list,
}: DiagnosticsInput): Promise<ICloudDiagnostics> {
  const result: ICloudDiagnostics = {
    containerPath: undefined,
    containerSource: 'unresolved',
    directory,
    documentCount: undefined,
    isAvailable: false,
    isSignedIn: false,
    isSupported: backend !== undefined,
    problems: [],
    requestedContainer: undefined,
    usedFallback: false,
  };

  if (!backend) {
    result.problems.push(
      'The native module is not linked. Run pod install and rebuild the app.',
    );
    return result;
  }

  try {
    const info = await backend.containerInfo();
    result.containerPath = info.containerPath;
    result.containerSource = info.containerSource;
    result.isSignedIn = info.isSignedIn;
    result.requestedContainer = info.requestedContainer;
    result.usedFallback = info.usedFallback;
  } catch (error) {
    result.problems.push(`containerInfo failed: ${errorText(error)}`);
    return result;
  }

  const requested =
    result.requestedContainer ?? 'the first entitlement container';
  if (!result.isSignedIn) {
    result.problems.push('No iCloud account is signed in on this device.');
    return result;
  }
  if (result.usedFallback) {
    result.problems.push(
      `${requested} is not reachable, so the default container is used. ` +
        'Add it to com.apple.developer.icloud-container-identifiers and ' +
        'com.apple.developer.ubiquity-container-identifiers.',
    );
  }
  if (!result.containerPath) {
    result.problems.push(
      `No container is reachable for ${requested}. Check the iCloud ` +
        'capability, the container entitlements and the App ID in the ' +
        'developer portal.',
    );
    return result;
  }

  try {
    result.isAvailable = await backend.isAvailable();
  } catch (error) {
    result.problems.push(`isAvailable failed: ${errorText(error)}`);
  }

  try {
    result.documentCount = (await list()).length;
  } catch (error) {
    result.problems.push(`list failed: ${errorText(error)}`);
  }

  return result;
}
