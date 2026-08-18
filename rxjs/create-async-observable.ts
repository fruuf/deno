import { Observable, Subscriber } from "npm:rxjs";

type CleanupHandler = void | (() => void | Promise<void>);
type AsyncObserver<T> = (
  observer: Subscriber<T>,
  cleanup: (handler: CleanupHandler) => void,
) => Promise<CleanupHandler> | CleanupHandler;

/**
 * Creates an observable from an async handler with automatic cleanup management on completion or error.
 */
export function createAsyncObservable<T>(
  handler: AsyncObserver<T>,
): Observable<T> {
  return new Observable((observer) => {
    const cleanupHandlers: CleanupHandler[] = [];

    let isComplete = false;
    let isCleaning = false;

    async function cleanupObserver() {
      if (isCleaning) {
        return;
      }
      isCleaning = true;
      isComplete = true;
      while (cleanupHandlers.length > 0) {
        try {
          const cleanupHandler = cleanupHandlers.pop();
          if (cleanupHandler) {
            await cleanupHandler();
          }
        } catch (e) {
          observer.error(e);
        }
      }
      isCleaning = false;
    }

    function addCleanupHandler(cleanupHandler: CleanupHandler) {
      cleanupHandlers.push(cleanupHandler);
      if (isComplete) {
        cleanupObserver();
        throw new Error("observer already completed");
      }
    }

    // deno-lint-ignore require-await
    (async () => {
      return handler(observer, addCleanupHandler);
    })()
      .then(addCleanupHandler)
      .catch((error) => observer.error(error));

    return cleanupObserver;
  });
}
