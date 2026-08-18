import {
  context,
  Exception,
  Span,
  SpanContext,
  SpanKind,
  SpanStatusCode,
  trace,
} from "npm:@opentelemetry/api";
import { Subject } from "npm:rxjs";
import { errorHandler, timeoutHandler } from "../error.ts";
import { logger } from "../log.ts";
import { meter, tracer } from "../metrics.ts";
import {
  shutdownStream,
  subscribeUntilComplete,
  withTestIdentifier,
} from "../service.ts";
import { wait } from "../util.ts";
import {
  ApiMethod,
  ServerMethod,
  ServerResponseError,
  ServerResponseResult,
} from "./helper.ts";
import { decode, encode, getClient } from "./nats.ts";

const durationMonitor = meter.createCounter("server_duration", {
  //   help: "server_duration",
  //   labelNames: ["method"],
});

const countMonitor = meter.createCounter("server_count", {
  //   help: "server_count",
  //   labelNames: ["method"],
});

const readCount = meter.createCounter("server_read_count", {
  //   help: "server_read_count",
  //   labelNames: ["method"],
});

const writeCount = meter.createCounter("server_write_count", {
  //   help: "server_write_count",
  //   labelNames: ["method"],
});

const channelNameSet = new Set<string>();

type Request = {
  args: Uint8Array;
  replyTo: string;
};

/** Implements a server-side RPC handler that responds to NATS API method calls with tracing */
export async function implementServerApi<Args extends unknown[], Result>(
  method: ApiMethod<Args, Result>,
  handler: ServerMethod<Args, Result>,
  plugin?: string,
) {
  const client = await getClient();
  const { methodName, methodHost, timeout } = method;
  const channel = withTestIdentifier(
    plugin
      ? `rpc/${methodHost}/${methodName}(${plugin})`
      : `rpc/${methodHost}/${methodName}`,
  );

  if (channelNameSet.has(channel)) {
    throw new Error(
      `subject "${methodName}" on host "${methodHost}" already exists`,
    );
  }
  channelNameSet.add(channel);

  const globalSubject = new Subject<Request>();

  const subscription = client.subscribe(channel, {
    queue: "rpc",
  });

  (async () => {
    for await (const message of subscription) {
      if (message.reply) {
        globalSubject.next({
          args: message.data,
          replyTo: message.reply,
        });
      }
    }
  })();

  shutdownStream.subscribe(async () => {
    try {
      await subscription.drain();
    } catch (e) {
      errorHandler(e);
    }
    await wait(1000);
    globalSubject.complete();
  });

  subscribeUntilComplete(globalSubject, async ({ args, replyTo }) => {
    const start = Date.now();
    readCount.add(args.byteLength, { method: methodName });
    let span: Span | undefined;

    try {
      const decodedArgs: { args: Args } & SpanContext = decode(args);

      const nextContext = trace.setSpanContext(context.active(), decodedArgs);

      span = tracer.startSpan(
        methodName,
        { attributes: { methodHost, timeout }, kind: SpanKind.SERVER },
        nextContext,
      );
      const start = Date.now();

      const data = await context.with(
        trace.setSpan(context.active(), span),
        timeoutHandler(() => handler(...decodedArgs.args), method.timeout),
      );

      // deno-lint-ignore no-explicit-any
      const response: ServerResponseResult<any> = { type: "result", data };
      const message = encode(response);
      const duration = Math.max(Date.now() - start, 0);

      durationMonitor.add(duration, { method: methodName });
      countMonitor.add(1, { method: methodName });
      writeCount.add(message.byteLength, { method: methodName });

      if (duration < timeout) {
        logger.debug("server_success", {
          methodName,
          methodHost,
          plugin,
          duration,
          size: message.length,
        });
      } else {
        logger.warn("server_timeout", {
          methodName,
          methodHost,
          plugin,
          duration,
          timeout,
          size: message.length,
        });
      }

      logger.debug("nats_response", { channel, replyTo });

      span.addEvent("server_response", {
        methodName,
        methodHost,
        plugin,
        duration,
        timeout,
        size: message.length,
        channel,
        replyTo,
      });

      client.publish(replyTo, message);

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    } catch (e) {
      const { message, errorType } = errorHandler(e);

      const response: ServerResponseError = {
        type: "error",
        error: { message, errorType },
      };

      const responseMessage = encode(response);

      const duration = Math.max(Date.now() - start, 0);

      durationMonitor.add(duration, { method: methodName });
      countMonitor.add(1, { method: methodName });

      logger.info("server_error", {
        methodName,
        methodHost,
        plugin,
        duration: Date.now() - start,
        errorMessage: message,
        errorType,
      });
      if (span) {
        span.addEvent("server_error", {
          methodName,
          methodHost,
          plugin,
          duration,
          timeout,
          size: responseMessage.length,
          channel,
          replyTo,
        });
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorType });
        span.recordException(e as Exception);
        span.end();
      }
      client.publish(replyTo, responseMessage);
    }
  });
}
