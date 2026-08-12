import { describe, expect, it, vi } from 'vitest';

import {
  withSerializedMobileTransaction,
  withSerializedMobileWrite,
} from './databaseWriteQueue';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createDatabase(events: string[] = []) {
  let transactionActive = false;
  return {
    runAsync: vi.fn(async (label: string) => {
      events.push(`write:${label}`);
    }),
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => {
      if (transactionActive) throw new Error('cannot start a transaction within a transaction');
      transactionActive = true;
      events.push('begin');
      try {
        await task();
        events.push('commit');
      } catch (error) {
        events.push('rollback');
        throw error;
      } finally {
        transactionActive = false;
      }
    }),
  };
}

describe('mobile database write serialization', () => {
  it('runs overlapping transactions in FIFO order without nesting them', async () => {
    const events: string[] = [];
    const database = createDatabase(events);
    const firstEntered = deferred();
    const releaseFirst = deferred();

    const first = withSerializedMobileTransaction(database as never, async () => {
      events.push('first:start');
      firstEntered.resolve();
      await releaseFirst.promise;
      events.push('first:end');
      return 'first result';
    });
    await firstEntered.promise;

    const second = withSerializedMobileTransaction(database as never, async () => {
      events.push('second');
      return 'second result';
    });
    await Promise.resolve();

    expect(events).toEqual(['begin', 'first:start']);
    releaseFirst.resolve();

    await expect(first).resolves.toBe('first result');
    await expect(second).resolves.toBe('second result');
    expect(events).toEqual([
      'begin',
      'first:start',
      'first:end',
      'commit',
      'begin',
      'second',
      'commit',
    ]);
  });

  it('holds a standalone write until the active transaction has committed', async () => {
    const events: string[] = [];
    const database = createDatabase(events);
    const transactionEntered = deferred();
    const releaseTransaction = deferred();

    const transaction = withSerializedMobileTransaction(database as never, async () => {
      events.push('transaction:work');
      transactionEntered.resolve();
      await releaseTransaction.promise;
    });
    await transactionEntered.promise;

    const write = withSerializedMobileWrite(database as never, async () => {
      await database.runAsync('outside');
    });
    await Promise.resolve();

    expect(database.runAsync).not.toHaveBeenCalled();
    releaseTransaction.resolve();
    await Promise.all([transaction, write]);
    expect(events).toEqual([
      'begin',
      'transaction:work',
      'commit',
      'write:outside',
    ]);
  });

  it('releases the FIFO lane after a transaction fails', async () => {
    const events: string[] = [];
    const database = createDatabase(events);
    const transactionEntered = deferred();
    const releaseTransaction = deferred();

    const failed = withSerializedMobileTransaction(database as never, async () => {
      events.push('failing:start');
      transactionEntered.resolve();
      await releaseTransaction.promise;
      throw new Error('write failed');
    });
    await transactionEntered.promise;

    const recovery = withSerializedMobileWrite(database as never, async () => {
      await database.runAsync('recovery');
      return 42;
    });
    releaseTransaction.resolve();

    await expect(failed).rejects.toThrow('write failed');
    await expect(recovery).resolves.toBe(42);
    expect(events).toEqual([
      'begin',
      'failing:start',
      'rollback',
      'write:recovery',
    ]);
  });

  it('does not make separate database connections wait on each other', async () => {
    const firstDatabase = createDatabase();
    const secondDatabase = createDatabase();
    const firstEntered = deferred();
    const releaseFirst = deferred();
    let secondRan = false;

    const first = withSerializedMobileWrite(firstDatabase as never, async () => {
      firstEntered.resolve();
      await releaseFirst.promise;
    });
    await firstEntered.promise;

    await withSerializedMobileWrite(secondDatabase as never, async () => {
      secondRan = true;
    });
    expect(secondRan).toBe(true);

    releaseFirst.resolve();
    await first;
  });
});
