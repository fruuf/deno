import FormData from "npm:form-data";
import { logger } from "../log.ts";
import { ParseError, ParserType, parseSchema, StaticParse } from "../parse.ts";
import { Json } from "../util.ts";
import {
  buildHeaders,
  encodeRequestBody,
  getAcceptHeader,
  prepareFormData,
} from "./builder.ts";
import {
  createRequestSpan,
  executeRequest,
  parseResponse,
  setSpanStatus,
} from "./executor.ts";
import { Method, RequestOptions, RequestParseError } from "./types.ts";

// Overloaded signatures for different HTTP methods
export async function request<Schema extends ParserType>(
  method: "GET",
  schema: Schema,
  url: string,
  options?: RequestOptions,
): Promise<StaticParse<Schema>>;

export async function request<Schema extends ParserType>(
  method: "PATCH",
  schema: Schema,
  url: string,
  data: Json | null,
  options?: RequestOptions,
): Promise<StaticParse<Schema>>;

export async function request<Schema extends ParserType>(
  method: "POST",
  schema: Schema,
  url: string,
  data: Json | null,
  options?: RequestOptions,
): Promise<StaticParse<Schema>>;

export async function request<Schema extends ParserType>(
  method: "FORM",
  schema: Schema,
  url: string,
  data: FormData,
  options?: RequestOptions,
): Promise<StaticParse<Schema>>;

export async function request<Schema extends ParserType>(
  method: "PUT",
  schema: Schema,
  url: string,
  data: Json | null,
  options?: RequestOptions,
): Promise<StaticParse<Schema>>;

export async function request<Schema extends ParserType>(
  method: "DELETE",
  schema: Schema,
  url: string,
  options?: RequestOptions,
): Promise<StaticParse<Schema>>;

/**
 * Makes HTTP requests with schema validation and automatic retries.
 */
export async function request<Schema extends ParserType>(
  method: Method,
  schema: Schema,
  url: string,
  ...rest: unknown[]
) {
  const span = createRequestSpan(method, url);

  try {
    // Parse arguments based on method
    let options: RequestOptions = {};
    let requestData: Uint8Array<ArrayBuffer> | string | undefined;
    let headers: Record<string, string> = {};

    if (method === "POST" || method === "PATCH" || method === "PUT") {
      const [data, nextOptions = {}] = rest as [Json | null, RequestOptions];
      options = nextOptions;
      const encoding = options?.encoding ?? "json";
      const encoded = encodeRequestBody(data, encoding);
      if (encoded) {
        requestData = encoded.body;
        headers["Content-Type"] = encoded.contentType;
      }
    } else if (method === "FORM") {
      const [form, nextOptions = {}] = rest as [FormData, RequestOptions];
      options = nextOptions;
      const prepared = prepareFormData(form);
      requestData = prepared.body;
      headers = { ...headers, ...prepared.headers };
    } else {
      [options = {}] = rest as [RequestOptions];
    }

    // Set Accept header based on parse format
    const parseFormat = options?.parse || "json";
    headers.Accept = getAcceptHeader(parseFormat);

    // Build final headers with handlers
    const finalHeaders = buildHeaders(method, requestData, headers, options);

    // Execute request
    const text = await executeRequest(
      url,
      method,
      requestData,
      finalHeaders,
      options.timeout ?? 10000,
    );

    // Parse response
    const responseData = await parseResponse(text, parseFormat);

    // Validate response against schema
    try {
      const result = parseSchema(schema, responseData);
      setSpanStatus(span, true);
      return result;
    } catch (e) {
      if (e instanceof ParseError) {
        logger.info("invalid_schema", {
          url,
          method,
          parseError: e.parseError,
          data: responseData,
        });
        setSpanStatus(span, false, "requestInvalidSchema");
        throw new RequestParseError(e.parseError);
      }
      throw e;
    }
  } catch (error) {
    if (!(error instanceof RequestParseError)) {
      setSpanStatus(span, false, "requestFailed");
    }
    throw error;
  }
}

/**
 * Convenience function for GET requests with schema validation.
 */
export function requestGet<Schema extends ParserType>(
  schema: Schema,
  url: string,
  options?: RequestOptions,
) {
  return request("GET", schema, url, options);
}

/**
 * Convenience function for POST requests with schema validation.
 */
export function requestPost<Schema extends ParserType>(
  schema: Schema,
  url: string,
  data: Json | null,
  options?: RequestOptions,
) {
  return request("POST", schema, url, data, options);
}

/**
 * Convenience function for PATCH requests with schema validation.
 */
export function requestPatch<Schema extends ParserType>(
  schema: Schema,
  url: string,
  data: Json | null,
  options?: RequestOptions,
) {
  return request("PATCH", schema, url, data, options);
}

/**
 * Convenience function for DELETE requests with schema validation.
 */
export function requestDelete<Schema extends ParserType>(
  schema: Schema,
  url: string,
  options?: RequestOptions,
) {
  return request("DELETE", schema, url, options);
}
