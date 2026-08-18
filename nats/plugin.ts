import { errorHandler, SafeError, timeoutHandler } from "../error.ts";
import { bindSpan, spanEvent, tracer } from "../metrics.ts";
import { isValue } from "../util.ts";

type PluginResult<Result> = { plugin: string; result: Result };

/** Error thrown when no plugins are available or all plugin handlers fail */
export class NoPluginsError extends SafeError {
  plugins: string[];
  constructor(plugins: string[]) {
    super("noPlugins", "noPlugins");
    this.plugins = plugins;
  }
}

/** Executes handler on plugins concurrently and returns first successful result */
export function pluginsFirst<Result>(
  plugins: string[],
  handler: (plugin: string) => Promise<Result>,
) {
  let error: Error | null = null;
  let resolved = false;
  const span = tracer.startSpan("pluginsFirst");
  const nextHandler = bindSpan(handler, span);
  return new Promise<PluginResult<Result>>((resolve, reject) => {
    Promise.all(
      plugins.map(async (plugin) => {
        try {
          const result = await nextHandler(plugin);
          if (!resolved) {
            resolved = true;
            spanEvent("pluginsFirst", { plugin });
            resolve({ plugin, result });
          }
        } catch (e) {
          const handledError = errorHandler(e);
          if (!error) error = handledError;
        }
      }),
    ).then(() => {
      span.end();
      if (!resolved) reject(error ?? new NoPluginsError(plugins));
    });
  });
}

/** Executes handler on all plugins and returns the highest scoring result */
export async function pluginsBest<Result>(
  plugins: string[],
  handler: (plugin: string) => Promise<Result>,
  score: (result: Result) => number,
  timeout = 5_000,
) {
  const span = tracer.startSpan("pluginsBest");
  const nextHandler = bindSpan(timeoutHandler(handler, timeout), span);
  let error: Error | null = null;
  const results = await Promise.all(
    plugins.map(async (plugin): Promise<PluginResult<Result> | null> => {
      try {
        const result = await nextHandler(plugin);
        return {
          plugin,
          result,
        };
      } catch (e) {
        const handledError = errorHandler(e);
        if (!error) error = handledError;
        return null;
      }
    }),
  );

  const [result] = results
    .filter(isValue)
    .sort(({ result: a }, { result: b }) => score(b) - score(a));

  spanEvent("pluginsBest", {
    plugin: result?.plugin,
    score: result ? score(result.result) : 0,
  });
  span.end();

  if (!result) throw error ?? new NoPluginsError(plugins);
  return result;
}

/** Executes handler on all plugins in parallel, returns all successful results */
export async function pluginsAll<Result>(
  plugins: string[],
  handler: (plugin: string) => Promise<Result>,
  timeout = 5_000,
) {
  const span = tracer.startSpan("pluginsAll");
  const nextHandler = bindSpan(timeoutHandler(handler, timeout), span);
  let error: Error | null = null;
  const results = await Promise.all(
    plugins.map(async (plugin): Promise<PluginResult<Result> | null> => {
      try {
        return {
          plugin,
          result: await nextHandler(plugin),
        };
      } catch (e) {
        const handledError = errorHandler(e);
        if (!error) error = handledError;
      }
      return null;
    }),
  );

  const nextResults = results.filter(isValue);
  spanEvent("pluginsAll", { plugins: nextResults.map(({ plugin }) => plugin) });
  span.end();
  if (nextResults.length === 0) throw error ?? new NoPluginsError(plugins);
  return nextResults;
}
