import { join } from "jsr:@std/path";
import { cacheHandler, stringKey } from "./cache.ts";
import { logger } from "./log.ts";

type Config = {
  type: "secret" | "environment" | "default";
  value: string;
};

const BOOLEAN_ENABLED = new Set(["true", "on", "1", "yes"]);
const SECRET_PATHS = ["/etc/secrets", "/run/secrets"];

function readConfigSync(name: string): Config {
  for (const SECRET_PATH of SECRET_PATHS) {
    try {
      const file = join(SECRET_PATH, name.toLowerCase());
      const content = Deno.readTextFileSync(file);
      return { type: "secret", value: content.trim() };
    } catch {
      // lets just keep trying the next method
    }
  }

  const env = Deno.env.get(name.toUpperCase());
  if (typeof env === "string") {
    return { type: "environment", value: env.trim() };
  }

  return { type: "default", value: "" };
}

const readSecret = cacheHandler(stringKey, (_, name) => {
  const { value, type } = readConfigSync(name);
  logger.info("config_parameter", { name, source: type });
  return value;
});

const normalName = (name: string) =>
  name.toLowerCase().split(/[\W+]/).join("_");

/**
 * Reads a configuration value as string from secrets or environment.
 */
export function configString(name: string, defaultValue = "") {
  const secret = readSecret(normalName(name));
  return secret.length > 0 ? secret : defaultValue;
}

/**
 * Reads a configuration value as number from secrets or environment.
 */
export function configNumber(name: string, defaultValue = 0) {
  const secret = readSecret(normalName(name));
  return secret.length > 0 ? Number(secret) : defaultValue;
}

/**
 * Reads a configuration value as boolean from secrets or environment.
 */
export function configBoolean(name: string, defaultValue = false) {
  const secret = readSecret(normalName(name));
  return secret.length > 0
    ? BOOLEAN_ENABLED.has(secret.toLowerCase())
    : defaultValue;
}

/**
 * Gets the site secret for cryptographic operations.
 */
export function getSiteSecret() {
  const siteSecret = configString("SITE_SECRET", "Or1KSITOYyT1c4VsaiSZ");
  return siteSecret;
}
