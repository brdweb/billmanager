import { describe, expect, it } from 'vitest';

import { runtimeError } from './mobileRuntimeError';

describe('runtimeError', () => {
  it('turns the native nested-transaction scheduling error into an automatic-retry message', () => {
    const reason = new Error(
      "Call to function 'NativeDatabase.execAsync' has been rejected. "
      + 'Caused by: cannot start a transaction within a transaction',
    );

    expect(runtimeError(reason)).toBe(
      "Local synchronization couldn't finish. BillManager will retry automatically.",
    );
  });

  it('retains other server and user-facing error messages', () => {
    expect(runtimeError(new Error('Your session has expired.'))).toBe(
      'Your session has expired.',
    );
    expect(runtimeError(new Error('cannot start a transaction within a transaction'))).toBe(
      'cannot start a transaction within a transaction',
    );
  });

  it('uses the generic synchronization message for non-errors', () => {
    expect(runtimeError(null)).toBe('BillManager could not synchronize.');
  });
});
