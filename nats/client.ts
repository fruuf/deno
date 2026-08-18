import { RequestError, TimeoutError } from "npm:@nats-io/transport-node";
import { SpanKind, SpanStatusCode } from "npm:@opentelemetry/api";
import { errorHandler, SafeError, timeoutHandler } from "../error.ts";
import { logger } from "../log.ts";
import { meter, tracer } from "../metrics.ts";
import { isTestModeEnabled, withTestIdentifier } from "../service.ts";
import {
  ApiMethod,
  ServerMethod,
  ServerMethodArgs,
  ServerMethodResult,
  ServerResponse,
} from "./helper.ts";
import { decode, encode, getClient } from "./nats.ts";

const durationMonitor = meter.createCounter("client_duration", {
  //   help: "client_duration",
  //   labelNames: ["methodHost", "methodName", "result"],
});

const countMonitor = meter.createCounter("client_count", {
  //   help: "client_count",
  //   labelNames: ["methodHost", "methodName", "result"],
});

/** Sends a request to NATS and waits for response with timeout handling */
export async function natsRequest(
  channel: string,
  message: Uint8Array,
  timeout: number,
) {
  const client = await getClient();

  const response = await timeoutHandler(
    client.request.bind(client),
    timeout + 100,
  )(
    channel,
    message,
    { timeout },
  );

  logger.debug("nats_request", { channel });
  return response?.data;
}

/** Error thrown when a NATS service method call fails */
export class ServiceError extends SafeError {
  method: string;
  host: string;
  plugin?: string;
  constructor(method: string, host: string, plugin?: string) {
    super(`method ${method} on host ${host} failed`, "serviceError");
    this.method = method;
    this.host = host;
    this.plugin = plugin;
  }
}

/** Error thrown when a NATS service is disabled or has no responders */
export class ServiceDisabledError extends SafeError {
  method: string;
  host: string;
  plugin?: string;
  constructor(method: string, host: string, plugin?: string) {
    super(`method ${method} on host ${host} disabled`, "serviceDisabled");
    this.method = method;
    this.host = host;
    this.plugin = plugin;
  }
}

/** Error thrown when a NATS service method call times out */
export class ServiceTimeoutError extends SafeError {
  timeout: number;
  method: string;
  host: string;
  plugin?: string;
  constructor(timeout: number, method: string, host: string, plugin?: string) {
    super(
      `method ${method} on host ${host} timeout (${timeout})`,
      "serviceTimeout",
    );
    this.timeout = timeout;
    this.method = method;
    this.host = host;
    this.plugin = plugin;
  }
}

/** Creates a typed client method for calling NATS RPC endpoints with plugin support and stubbing */
// deno-lint-ignore no-explicit-any
export function createApiMethod<Method extends ServerMethod<any, any>>(
  host: string,
  name: string,
  timeout = 10000,
): ApiMethod<ServerMethodArgs<Method>, ServerMethodResult<Method>> {
  let stubHandler:
    | ServerMethod<
      ServerMethodArgs<Method>,
      ServerMethodResult<Method>
    >
    | null = null;

  const method = async (args: ServerMethodArgs<Method>, plugin?: string) => {
    if (stubHandler) return stubHandler(...args);
    const start = Date.now();
    const rpcName = plugin ? `${host}/${name}(${plugin})` : `${host}/${name}`;
    const span = tracer.startSpan(
      name,
      { kind: SpanKind.CLIENT, attributes: { host, name } },
    );
    const { spanId, traceId, traceFlags, traceState } = span.spanContext();
    const reqBody = { args, spanId, traceId, traceFlags, traceState };
    span.addEvent("sending request");
    let message: Uint8Array;
    try {
      message = await natsRequest(
        withTestIdentifier(`rpc/${rpcName}`),
        encode(reqBody),
        timeout,
      );
    } catch (e) {
      const duration = Math.max(Date.now() - start, 0);

      span.setStatus({ code: SpanStatusCode.ERROR, message: "client_failed" });
      span.end();

      durationMonitor.add(duration, { methodName: name, methodHost: host });

      countMonitor.add(1, { methodName: name, methodHost: host });

      if (e instanceof RequestError && e.isNoResponders()) {
        throw new ServiceDisabledError(name, host, plugin);
      }

      if (e instanceof TimeoutError) {
        throw new ServiceTimeoutError(timeout, name, host, plugin);
      }

      logger.warn("client_failed", {
        methodName: name,
        methodHost: host,
        plugin,
        duration,
      });

      errorHandler(e);

      throw new ServiceError(name, host, plugin);
    }

    span.addEvent("request complete");
    const duration = Math.max(Date.now() - start, 0);
    span.setAttribute("nats.request.duration", duration);

    const response: ServerResponse<ServerMethodResult<Method>> = decode(
      message,
    );

    span.setAttribute("nats.response.type", response.type);
    if (response.type === "result") {
      logger.debug("client_success", {
        methodName: name,
        methodHost: host,
        plugin,
        duration,
      });

      durationMonitor.add(
        duration,
        { methodName: name, methodHost: host, result: "success" },
      );

      countMonitor.add(
        1,
        { methodName: name, methodHost: host, result: "success" },
      );

      span.end();
      return response.data;
    }
    logger.info("client_error", {
      methodName: name,
      methodHost: host,
      plugin,
      duration,
      errorType: response.error.errorType,
    });

    durationMonitor.add(
      duration,
      { methodName: name, methodHost: host, result: "server_error" },
    );

    countMonitor.add(
      1,
      { methodName: name, methodHost: host, result: "server_error" },
    );

    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: response.error.message,
    });
    span.end();
    throw new SafeError(
      response.error.errorType,
      response.error.message,
    );
  };

  return Object.assign((...args: ServerMethodArgs<Method>) => method(args), {
    plugin: (plugin: string, ...args: ServerMethodArgs<Method>) =>
      method(args, plugin),
    methodName: name,
    methodHost: host,
    timeout,
    stub(
      handler: ServerMethod<
        ServerMethodArgs<Method>,
        ServerMethodResult<Method>
      >,
    ) {
      if (!isTestModeEnabled) throw Error("stub requires test mode");
      stubHandler = handler;
    },
    unstub() {
      if (!isTestModeEnabled) throw Error("stub requires test mode");
      stubHandler = null;
    },
  });
}
