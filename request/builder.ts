import FormData from "npm:form-data";
import qs from "npm:qs";
import { Builder } from "npm:xml2js";
import { Json } from "../util.ts";
import {
  EncodingFormat,
  Method,
  RequestData,
  RequestOptions,
} from "./types.ts";

/**
 * Encodes request body based on the specified encoding format.
 */
export function encodeRequestBody(
  data: Json | null,
  encoding: EncodingFormat,
): { body: RequestData; contentType: string } | null {
  if (data === null) return null;

  switch (encoding) {
    case "json":
      return {
        body: JSON.stringify(data),
        contentType: "application/json",
      };
    case "form":
      return {
        body: qs.stringify(data),
        contentType: "application/x-www-form-urlencoded",
      };
    case "xml": {
      const xmlBuilder = new Builder({ attrkey: "__self" });
      return {
        body: xmlBuilder.buildObject(data),
        contentType: "application/xml",
      };
    }
  }
}

/**
 * Prepares form data for request.
 */
export function prepareFormData(form: FormData): {
  body: RequestData;
  headers: Record<string, string>;
} {
  const buffer = form.getBuffer();
  return {
    body: new Uint8Array(buffer),
    headers: form.getHeaders(),
  };
}

/**
 * Builds headers for the request, including dynamic header handlers.
 */
export function buildHeaders(
  method: Method,
  body: RequestData,
  baseHeaders: Record<string, string>,
  options: RequestOptions,
): Record<string, string> {
  const headerMap = new Map(
    Object.entries(baseHeaders)
      .map(([key, value]) => [key.toLowerCase().trim(), value.trim()]),
  );

  // Apply header handlers and static headers from options
  if (options.headers) {
    for (const [key, value] of Object.entries(options.headers)) {
      if (typeof value === "string") {
        headerMap.set(key.toLowerCase(), value.trim());
      } else if (typeof value === "function") {
        const result = value({
          method,
          body,
          headers: Object.fromEntries(headerMap.entries()),
        });
        if (typeof result === "string") {
          headerMap.set(key.toLowerCase(), result);
        }
      }
    }
  }

  return Object.fromEntries(headerMap.entries());
}

/**
 * Gets the Accept header based on parse format.
 */
export function getAcceptHeader(parse: RequestOptions["parse"]): string {
  switch (parse) {
    case "json":
      return "application/json";
    case "yaml":
      return "text/yaml";
    case "xml":
      return "application/xml";
    default:
      return "text/plain";
  }
}
