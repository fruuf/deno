import {
  connectable,
  distinctUntilChanged,
  Observable,
  of,
  ReplaySubject,
  startWith,
  Subject,
  switchMap,
  timer,
} from "npm:rxjs";
import { map, scan, take } from "npm:rxjs/operators";
import { Key, resolveKey } from "../cache.ts";
import { createAsyncObservable } from "./create-async-observable.ts";
import { watchStream } from "./helper.ts";

/**
 * Caches observables by args key with automatic cleanup after inactivity and replay buffer support.
 */
export function cacheObservable<Args extends unknown[], Result>(
  handler: (...args: Args) => Observable<Result>,
  getArgsKey: Key<Args>,
  keepAlive: number,
  bufferSize: number,
) {
  const resultMap = new Map<
    string,
    {
      key: string;
      stream: Observable<Result>;
      countSubject: Subject<number>;
    }
  >();

  function cleanupResult(key: string) {
    const result = resultMap.get(key);
    if (result) {
      resultMap.delete(key);
      result.countSubject.complete();
    }
  }

  const resolvedKey = resolveKey(getArgsKey);

  function getResult(...args: Args) {
    let isComplete = false;
    const key = resolvedKey(...args);
    const result = resultMap.get(key);
    if (result) {
      return result;
    }

    const handlerStream = handler(...args);

    const stream = connectable(handlerStream, {
      connector: () => new ReplaySubject(bufferSize),
      resetOnDisconnect: false,
    });

    const countSubject = new Subject<number>();

    watchStream(
      countSubject.pipe(
        scan((sum, update) => sum + update, 0),
        map((count) => count === 0),
        startWith(true),
        distinctUntilChanged(),
        switchMap((isComplete) =>
          isComplete ? timer(keepAlive).pipe(map(() => true)) : of(false)
        ),
        distinctUntilChanged(),
        switchMap((
          isComplete,
        ) => (isComplete
          ? of(null)
          : createAsyncObservable<null>((observer) => {
            const subscription = stream.subscribe({
              complete() {
                observer.next(null);
                observer.complete();
              },
              error(error) {
                observer.error(error);
              },
            });
            const connection = stream.connect();

            return () => {
              subscription.unsubscribe();
              connection.unsubscribe();
            };
          }))
        ),
        take(1),
      ),
    ).subscribe({
      complete() {
        isComplete = true;
        cleanupResult(key);
      },
      error() {
        isComplete = true;
        cleanupResult(key);
      },
    });

    const nextResult = { key, stream, countSubject };
    if (isComplete) {
      countSubject.complete();
    } else {
      resultMap.set(key, nextResult);
    }

    return nextResult;
  }

  function getStream(...args: Args): Observable<Result> {
    return watchStream(
      new Observable((observer) => {
        const result = getResult(...args);
        result.countSubject.next(1);
        const streamSubscription = result.stream.subscribe(observer);
        return () => {
          streamSubscription.unsubscribe();
          result.countSubject.next(-1);
        };
      }),
    );
  }

  return getStream;
}
