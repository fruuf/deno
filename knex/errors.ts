import { SafeError } from "../error.ts";

/**
 * Error thrown when attempting to use a Knex instance that hasn't been set up
 */
export class KnexNotSetupError extends SafeError {
  constructor(name: string) {
    super("KnexNotSetupError", `setupKnex for "${name}" not called`);
  }
}

/**
 * Error thrown when getKnex is called without a valid name parameter
 */
export class KnexInvalidNameError extends SafeError {
  constructor() {
    super("KnexInvalidNameError", "getKnex() called without passing it a name");
  }
}

/**
 * Error thrown when a column reference is not found
 */
export class ColumnReferenceNotFoundError extends SafeError {
  constructor(table: string, key: string) {
    super(
      "ColumnReferenceNotFoundError",
      `reference not found for table "${table}" on key ${key}`,
    );
  }
}
