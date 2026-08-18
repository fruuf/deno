import {
  Attributes,
  AttributeValue,
  context,
  Exception,
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
} from "npm:@opentelemetry/api";
export type { Exception, Span } from "npm:@opentelemetry/api";

export { context, SpanKind, SpanStatusCode, trace };

/**
 * Global meter instance for creating and managing metrics.
 */
export const meter = metrics.getMeter("backend");
/**
 * Global tracer instance for creating and managing spans.
 */
export const tracer = trace.getTracer("backend");

/**
 * Wraps an async function with OpenTelemetry span tracing.
 */
export function withSpan<Args extends unknown[], Result>(
  spanName: string,
  fn: (...args: Args) => Promise<Result>,
  root = false,
) {
  return async (...args: Args): Promise<Result> => {
    const span = tracer.startSpan(spanName, { root });
    try {
      return await context.with(
        trace.setSpan(context.active(), span),
        () => fn(...args),
      );
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(error as Exception);
      throw error;
    } finally {
      span.end();
    }
  };
}

/**
 * Wraps a synchronous function with OpenTelemetry span tracing.
 */
export function withSpanSync<Args extends unknown[], Result>(
  spanName: string,
  fn: (...args: Args) => Result,
  root = false,
) {
  return (...args: Args): Result => {
    const span = tracer.startSpan(spanName, { root });
    try {
      return context.with(
        trace.setSpan(context.active(), span),
        () => fn(...args),
      );
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      span.recordException(error as Exception);
      throw error;
    } finally {
      span.end();
    }
  };
}

/**
 * Adds an event to the current active span.
 */
export function spanEvent(name: string, data: Attributes) {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }
  span.addEvent(name, data);
}

/**
 * Records an exception on the current active span.
 */
export function spanException(exception: Error) {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }
  span.recordException(exception as Exception);
}

/**
 * Sets an attribute on the current active span.
 */
export function spanAttribute(name: string, attribute: AttributeValue) {
  const span = trace.getActiveSpan();
  if (!span) {
    return;
  }
  span.setAttribute(name, attribute);
}

/**
 * Gets the currently active span.
 */
export function activeSpan() {
  const span = trace.getActiveSpan();
  return span;
}

/**
 * Binds a function to execute within a specific span context.
 */
export function bindSpan<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
  span = activeSpan(),
) {
  return (...args: Args) =>
    span
      ? context.with(
        trace.setSpan(context.active(), span),
        () => fn(...args),
      )
      : fn(...args);
}
