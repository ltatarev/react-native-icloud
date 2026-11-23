import { ICloudError, toICloudError } from '../errors';

describe('toICloudError', () => {
  it('reads the code from a native message', () => {
    const native = new Error('[downloadTimeout] state.lumee did not download');

    const error = toICloudError(native);

    expect(error).toBeInstanceOf(ICloudError);
    expect(error.code).toBe('downloadTimeout');
    expect(error.message).toBe('state.lumee did not download');
    expect(error.cause).toBe(native);
  });

  it('keeps a multi-line native message', () => {
    const error = toICloudError(new Error('[writeFailed] line one\nline two'));

    expect(error.code).toBe('writeFailed');
    expect(error.message).toBe('line one\nline two');
  });

  it('uses coordinationFailed for an unknown code', () => {
    const error = toICloudError(new Error('[somethingElse] failed'));

    expect(error.code).toBe('coordinationFailed');
    expect(error.message).toBe('[somethingElse] failed');
  });

  it('uses coordinationFailed for a value that is not an Error', () => {
    expect(toICloudError('boom').code).toBe('coordinationFailed');
    expect(toICloudError(undefined).message).toBe('Unknown error');
  });

  it('returns an ICloudError without a change', () => {
    const original = new ICloudError('notFound', 'missing');

    expect(toICloudError(original)).toBe(original);
  });
});
