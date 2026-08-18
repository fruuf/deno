import { filter, map, Observable, share } from "npm:rxjs";
import { Key, resolveKey } from "../cache.ts";

/**
 * Distributes stream values to multiple observers based on matching argument keys.
 */
export function spreadObservable<Args extends unknown[], Result>(
  stream: Observable<Result>,
  getArgsKey: Key<Args>,
  getValueKey: Key<[Result]>,
) {
  const resolvedArgsKey = resolveKey(getArgsKey);
  const resolvedValueKey = resolveKey(getValueKey);

  const keyValueStream = stream.pipe(
    map((value) => ({ key: resolvedValueKey(value), value })),
    share(),
  );

  return (...args: Args) => {
    const argsKey = resolvedArgsKey(...args);

    return keyValueStream.pipe(
      filter(({ key }) => key === argsKey),
      map(({ value }) => value),
    );
  };
}
