import { Observable } from "npm:rxjs";
import { checkIsError } from "./error.ts";

/**
 * Expects an async function to throw an error matching the given pattern.
 */
export const expectAsyncError = async (
  handler: () => Promise<unknown>,
  regexp: RegExp | string | undefined,
) => {
  try {
    await handler();
  } catch (e) {
    checkIsError(e);
    if (regexp && !new RegExp(regexp).test(e.message)) {
      throw new Error(`expected "${regexp}" but found "${e.message}"`);
    }
    return null;
  }
  throw new Error(`expected error "${regexp}"`);
};

/**
 * Collects all values emitted by an Observable for testing purposes.
 */
export function collectObservable<K>(stream: Observable<K>) {
  const results: K[] = [];
  const subscription = stream.subscribe((result: K) => {
    results.push(result);
  });

  return (close = true) => {
    if (close) {
      subscription.unsubscribe();
    }
    return results;
  };
}
