import { checkIsValue } from "./error.ts";
import { isProductionModeEnabled } from "./service.ts";
import { Json, UnwrapArray } from "./util.ts";

const LOG_LEVELS = [
  "debug" as const,
  "info" as const,
  "warn" as const,
  "error" as const,
];

type LevelEnum = UnwrapArray<typeof LOG_LEVELS>;

const LOG_LEVEL = Deno.env.get("LOG_LEVEL") ?? "info";

const logLevelMap = Object.fromEntries(
  LOG_LEVELS.map((level, index) => [level, index]),
);

const logLevel = logLevelMap[LOG_LEVEL];
checkIsValue(logLevel, "logLevel");

/**
 * Logs a message at the specified level with optional data.
 */
export function log(
  level: LevelEnum,
  message: string,
  data: Record<string, Json | undefined> = {},
) {
  const messageLevel = logLevelMap[level];
  checkIsValue(messageLevel, "messageLevel");
  if (messageLevel < logLevel) return;

  const content = isProductionModeEnabled
    ? [JSON.stringify({ level, message, data })]
    : [
      level,
      message,
      Deno.inspect(data, {
        depth: 4,
        colors: true,
        breakLength: Infinity,
        escapeSequences: false,
      }),
    ];

  if (level === "error") {
    console.error(...content);
    return;
  }

  if (level === "warn") {
    console.warn(...content);
    return;
  }

  if (level === "info") {
    console.info(...content);
    return;
  }

  console.debug(...content);
}

/**
 * Logger object with methods for each log level.
 */
export const logger: Record<
  LevelEnum,
  ((message: string, data?: Record<string, Json | undefined>) => void)
> = {
  debug: (message, data) => log("debug", message, data),
  info: (message, data) => log("info", message, data),
  warn: (message, data) => log("warn", message, data),
  error: (message, data) => log("error", message, data),
};
