import { connectable, Observable, ReplaySubject } from "npm:rxjs";
import { cacheHandler } from "../cache.ts";
import { isTestModeEnabled } from "../service.ts";

/**
 * Creates a connectable stream that replays the last N items to new subscribers.
 */
export function replayStream<Item>(stream: Observable<Item>, count = 1) {
  return connectable(stream, {
    connector: () => new ReplaySubject(count),
    resetOnDisconnect: false,
  });
}

/**
 * Records all events from a stream and returns them with completion status and any errors.
 */
export function recordStream<Item>(stream: Observable<Item>) {
  let events: Item[] = [];
  let complete = false;
  let error: Error | null = null;

  const subscription = stream.subscribe({
    next(nextEvent) {
      events = [...events, nextEvent];
    },
    complete() {
      complete = true;
    },
    error(nextError) {
      complete = true;
      error = nextError;
    },
  });

  return cacheHandler(null, () => {
    subscription.unsubscribe();
    return { events, complete, error };
  });
}

const streamWatcher = {
  activeCount: 0,
  concurrentMax: 0,
  subscribedCount: 0,
  unubscribedCount: 0,
  eventCount: 0,
  completeCount: 0,
  errorCount: 0,
  position: "",
};

type StreamWatcher = typeof streamWatcher;

const streamWatchers: StreamWatcher[] = [];

/**
 * Returns currently active watched streams for debugging and testing purposes.
 */
export function activeWatchedStreams() {
  if (!isTestModeEnabled) throw Error("test mode only");
  return streamWatchers.filter(({ activeCount }) => activeCount > 0);
}

/**
 * Wraps a stream with monitoring capabilities to track subscriptions, events, and lifecycle.
 */
export function watchStream<Item>(
  stream: Observable<Item>,
): Observable<Item> & StreamWatcher {
  if (!isTestModeEnabled) return Object.assign(stream, streamWatcher);

  const watcher = Object.assign(
    new Observable<Item>((observer) => {
      watcher.activeCount += 1;
      watcher.subscribedCount += 1;

      if (watcher.concurrentMax < watcher.activeCount) {
        watcher.concurrentMax = watcher.activeCount;
      }

      const subsciption = stream.subscribe({
        next(e) {
          watcher.eventCount += 1;

          // @ts-ignore-next-line
          watcher.lastEvent = e;
          observer.next(e);
        },
        complete() {
          watcher.completeCount += 1;
          observer.complete();
        },
        error(e) {
          watcher.errorCount += 1;
          observer.error(e);
        },
      });

      return () => {
        watcher.activeCount -= 1;
        watcher.unubscribedCount += 1;
        subsciption.unsubscribe();
      };
    }),
    streamWatcher,
  );
  streamWatchers.push(watcher);
  return watcher;
}

/**
 * Logs stream lifecycle events (open, next, complete, error, close) to console for debugging.
 */
export function logLifecycle<Item>(
  stream: Observable<Item>,
  name = "",
): Observable<Item> {
  return new Observable((observer) => {
    console.log("open", name);

    const subsciption = stream.subscribe({
      next(e) {
        console.log("next", name);
        observer.next(e);
      },
      complete() {
        console.log("complete", name);
        observer.complete();
      },
      error(e) {
        console.log("error", name);
        observer.error(e);
      },
    });

    return () => {
      console.log("close", name);
      subsciption.unsubscribe();
    };
  });
}
