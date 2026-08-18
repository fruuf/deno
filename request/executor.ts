import { toCamelCase } from "jsr:@std/text";
import { parseString } from "npm:xml2js";
import { parse } from "npm:yaml";
import { logger } from "../log.ts";
import { SpanStatusCode, tracer } from "../metrics.ts";
import {
  isTestModeEnabled,
  TEST_HTTP_PORT,
  TEST_SERVICE_PORT,
} from "../service.ts";
import { Json } from "../util.ts";
import {
  Method,
  ParseFormat,
  RequestData,
  RequestFailedError,
} from "./types.ts";

/**
 * Preprocesses URL to handle localhost port replacement in test mode.
 */
function preprocessUrl(url: string): string {
  if (!isTestModeEnabled) return url;

  const urlObj = new URL(url);
  const isLocalhost = urlObj.hostname === "localhost" ||
    urlObj.hostname === "127.0.0.1";

  if (isLocalhost) {
    // Handle implicit port 80 for http:// URLs
    if (urlObj.port === "" && urlObj.protocol === "http:") {
      urlObj.port = String(TEST_HTTP_PORT);
    } else if (urlObj.port === "80") {
      urlObj.port = String(TEST_HTTP_PORT);
    } else if (urlObj.port === "8080") {
      urlObj.port = String(TEST_SERVICE_PORT);
    }
  }

  return urlObj.toString();
}

/**
 * Executes the HTTP request with timeout and error handling.
 */
export async function executeRequest(
  url: string,
  method: Method,
  body: RequestData,
  headers: Record<string, string>,
  timeout: number,
): Promise<string> {
  const processedUrl = preprocessUrl(url);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(processedUrl, {
      method: (method === "FORM" ? "POST" : method).toLowerCase(),
      body,
      headers,
      signal: controller.signal,
    });

    logger.debug("request", {
      method,
      url: processedUrl,
      status: response.status,
    });
    const text = await response.text();

    if (response.status >= 400) {
      logger.info("request_error", { error: text, headers });
    }

    return text;
  } catch {
    throw new RequestFailedError();
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Parses response text based on the specified format.
 */
export async function parseResponse(
  text: string,
  format: ParseFormat,
): Promise<Json> {
  try {
    switch (format) {
      case "json":
        return JSON.parse(text);
      case "yaml":
        return parse(text);
      case "xml":
        return await parseXmlResponse(text);
      default:
        return text;
    }
  } catch {
    // If parsing fails, return raw text
    return text;
  }
}

/**
 * Parses XML response with custom processors.
 */
function parseXmlResponse(text: string): Promise<Json> {
  return new Promise<Json>((resolve, reject) => {
    parseString(
      text,
      {
        attrkey: "__self",
        normalize: true,
        trim: true,
        // TODO: remove preprocessors
        attrNameProcessors: [toCamelCase],
        tagNameProcessors: [toCamelCase],
      },
      (err: Error | undefined, result: Json) => {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      },
    );
  });
}

/**
 * Creates and manages request span for metrics.
 */
export function createRequestSpan(method: Method, url: string) {
  return tracer.startSpan("request", {
    attributes: { method, url },
  });
}

/**
 * Sets span status based on result.
 */
export function setSpanStatus(
  span: ReturnType<typeof createRequestSpan>,
  success: boolean,
  message?: string,
) {
  if (success) {
    span.setStatus({ code: SpanStatusCode.OK });
  } else {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: message || "requestFailed",
    });
  }
  span.end();
}
