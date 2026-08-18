import { Context, Env, Handler, Hono, Next } from "jsr:@hono/hono";
import { getConnInfo } from "jsr:@hono/hono/deno";
import { delay, take } from "npm:rxjs/operators";
import { errorHandler, SafeError } from "./error.ts";
import { SchemaType, validateSchema } from "./schema.ts";
import {
  addShutdownCleanupHandler,
  completeHandlerBeforeShutdown,
  isTestModeEnabled,
  shutdownStream,
  subscribeUntilComplete,
  TEST_HTTP_PORT,
} from "./service.ts";

export { getCookie, setCookie } from "jsr:@hono/hono/cookie";
export type { FC, PropsWithChildren } from "jsr:@hono/hono/jsx";
export type { Context, Env, Handler, Next };

const middleware = completeHandlerBeforeShutdown((_c, next: Next) => next());

export function getHono<E extends Env>() {
  const app = new Hono<E>();

  app.use(middleware);

  app.onError((err, c) => {
    const { message } = errorHandler(err);
    const code = err instanceof SafeError ? 400 : 500;
    return c.text(message, code);
  });

  const port = isTestModeEnabled ? TEST_HTTP_PORT : 80;
  const server = Deno.serve({ port: port }, app.fetch);
  addShutdownCleanupHandler(() => server.shutdown());

  // lets wait a bit before we allow any sort of shutdown
  subscribeUntilComplete(shutdownStream.pipe(take(1), delay(20_000)));

  return app;
}

export async function requestSchema<Schema extends SchemaType>(
  schema: Schema,
  context: Context,
  data: Record<string, unknown> = {},
) {
  const params = context.req.param();
  const query = context.req.query();
  const [post, json] = await Promise.all([
    context.req.parseBody().catch(() => ({})),
    Promise.resolve(context.req.json()).catch(() => ({})),
  ]);
  return validateSchema(schema, {
    ...post,
    ...json,
    ...query,
    ...params,
    ...data,
  });
}

export async function bodySchema<Schema extends SchemaType>(
  schema: Schema,
  context: Context,
) {
  const [post, json] = await Promise.all([
    context.req.parseBody().catch(() => null),
    Promise.resolve(context.req.json()).catch(() => null),
  ]);

  if (json) {
    return validateSchema(schema, json);
  }
  if (post) {
    return validateSchema(schema, post);
  }
  throw new SafeError("invalidRequest", "Expected a body");
}

export function getContextIp(context: Context, proxies = 0) {
  if (proxies > 0) {
    const forwardedIp = (context.req.header("x-forwarded-for") ?? "")
      .split(",")
      .map((ip) => ip.trim())
      .reverse()
      .at(proxies - 1);

    if (forwardedIp) {
      return forwardedIp;
    }
  }

  const info = getConnInfo(context);
  if (info.remote.address) {
    return info.remote.address.trim();
  }

  return "0.0.0.0";
}
