import { errorHandler, swallowError } from "../error.ts";
import { completeHandlerBeforeShutdown } from "../service.ts";
import { wait } from "../util.ts";
import type { Transaction } from "./transaction.ts";

/**
 * Registers a handler to execute after transaction commit
 */
export function onCommit(
  trx: Transaction,
  handler: () => void | Promise<void>,
) {
  const { commit } = trx;
  const nextCommit = async (...args: unknown[]) => {
    const result = await commit(...args);
    swallowError(
      completeHandlerBeforeShutdown(async () => {
        await wait(50); // lets make sure the read replica is in sync
        await handler();
      }),
    )();

    // deno-lint-ignore no-explicit-any
    return result as any;
  };
  // deno-lint-ignore no-explicit-any
  trx.commit = nextCommit as any;
}

/**
 * Registers a handler to execute after transaction rollback
 */
export function onRollback(
  trx: Transaction,
  handler: () => void | Promise<void>,
) {
  const { rollback } = trx;
  const nextRollback = async (...args: unknown[]) => {
    const result = await rollback(...args);
    swallowError(
      completeHandlerBeforeShutdown(async () => {
        await wait(50); // lets make sure the read replica is in sync
        await handler();
      }),
    )();

    // deno-lint-ignore no-explicit-any
    return result as any;
  };
  // deno-lint-ignore no-explicit-any
  trx.rollback = nextRollback as any;
}

/**
 * Registers a handler to execute before transaction commit
 */
export function onBeforeCommit(trx: Transaction, handler: () => Promise<void>) {
  const { commit } = trx;
  const nextCommit = async (...args: unknown[]) => {
    await handler().catch(errorHandler);
    return commit(...args);
  };

  // deno-lint-ignore no-explicit-any
  trx.commit = nextCommit as any;
}

/**
 * Registers a handler to execute before transaction rollback
 */
export function onBeforeRollback(
  trx: Transaction,
  handler: () => Promise<void>,
) {
  const { rollback } = trx;
  const nextRollback = async (...args: unknown[]) => {
    await handler().catch(errorHandler);
    return rollback(...args);
  };

  // deno-lint-ignore no-explicit-any
  trx.rollback = nextRollback as any;
}
