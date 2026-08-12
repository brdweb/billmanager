const NATIVE_DATABASE_EXECUTION_ERROR = "NativeDatabase.execAsync";
const NESTED_TRANSACTION_ERROR = "cannot start a transaction within a transaction";

const AUTOMATIC_RETRY_MESSAGE =
  "Local synchronization couldn't finish. BillManager will retry automatically.";

export function runtimeError(reason: unknown): string {
  if (!(reason instanceof Error)) return 'BillManager could not synchronize.';

  if (
    reason.message.includes(NATIVE_DATABASE_EXECUTION_ERROR)
    && reason.message.toLowerCase().includes(NESTED_TRANSACTION_ERROR)
  ) {
    return AUTOMATIC_RETRY_MESSAGE;
  }

  return reason.message;
}
