import { defer, merge, Observable } from "npm:rxjs";
import { Key } from "../cache.ts";
import { cacheObservable } from "./cache-observable.ts";
import { spreadObservable } from "./spread-observable.ts";

/**
 * Caches observables by args key and updates them when matching values are emitted from a shared stream.
 */
export function cacheObservableWithSpread<Args extends unknown[], Result>(
  initialValue: (...args: Args) => Promise<Result | undefined>,
  nextValues: Observable<Result>,
  getArgsKey: Key<Args>,
  getValueKey: Key<[Result]>,
  keepAlive = 10000,
) {
  const spreadObservableArgs = spreadObservable(
    nextValues,
    getArgsKey,
    getValueKey,
  );

  return cacheObservable(
    (...args: Args) =>
      merge(
        defer(() => initialValue(...args)),
        spreadObservableArgs(...args),
      ),
    getArgsKey,
    keepAlive,
    1,
  );
}
