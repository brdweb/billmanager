import type { SQLiteDatabase } from 'expo-sqlite';

type WriteTask<T> = () => Promise<T>;

// Expo SQLite's ordinary async transactions share their connection with every
// other query issued against the database. Keep all writes on that connection
// in one process-wide FIFO lane so another repository cannot accidentally begin
// a transaction (or issue a write) inside an active transaction.
const writeQueueTails = new WeakMap<SQLiteDatabase, Promise<void>>();

export function withSerializedMobileWrite<T>(
  database: SQLiteDatabase,
  task: WriteTask<T>,
): Promise<T> {
  const previous = writeQueueTails.get(database) ?? Promise.resolve();
  const result = previous.then(task);

  // Store a non-rejecting tail. The caller still receives the original failure,
  // while later writes remain able to enter the lane after it settles.
  writeQueueTails.set(database, result.then(
    () => undefined,
    () => undefined,
  ));

  return result;
}

export function withSerializedMobileTransaction<T>(
  database: SQLiteDatabase,
  task: WriteTask<T>,
): Promise<T> {
  return withSerializedMobileWrite(database, async () => {
    let result!: T;
    await database.withTransactionAsync(async () => {
      result = await task();
    });
    return result;
  });
}
