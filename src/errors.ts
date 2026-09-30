export const ICLOUD_ERROR_CODES = [
  'unsupportedPlatform',
  'notSignedIn',
  'containerUnavailable',
  'notFound',
  'downloadTimeout',
  'coordinationFailed',
  'quotaExceeded',
  'writeFailed',
] as const;

export type ICloudErrorCode = (typeof ICLOUD_ERROR_CODES)[number];

export class ICloudError extends Error {
  readonly code: ICloudErrorCode;

  constructor(code: ICloudErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'ICloudError';
    this.code = code;
  }
}

const isErrorCode = (value: string): value is ICloudErrorCode =>
  (ICLOUD_ERROR_CODES as readonly string[]).includes(value);

// The native module rejects with "[<code>] <message>".
const NATIVE_MESSAGE = /^\[(\w+)\]\s*([\s\S]*)$/;

/**
 * Convert a native rejection to an ICloudError. A message without a known
 * code becomes `coordinationFailed`.
 */
export function toICloudError(error: unknown): ICloudError {
  if (error instanceof ICloudError) {
    return error;
  }
  const message =
    error instanceof Error ? error.message : String(error ?? 'Unknown error');
  const match = NATIVE_MESSAGE.exec(message);
  if (match && isErrorCode(match[1])) {
    return new ICloudError(match[1], match[2], error);
  }
  return new ICloudError('coordinationFailed', message, error);
}
