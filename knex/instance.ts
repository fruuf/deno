import { join } from "jsr:@std/path";
import { Knex } from "npm:knex";
import { checkIsError } from "../error.ts";
import { logger } from "../log.ts";
import { addShutdownCleanupHandler, isTestModeEnabled } from "../service.ts";
import { wait } from "../util.ts";
import {
  defaultPostProcessResponse,
  ensureDatabase,
  getConnectionConfig,
  KnexInstances,
  makeKnex,
} from "./connection.ts";
import { KnexInvalidNameError, KnexNotSetupError } from "./errors.ts";
import { migrationHelpers } from "./migration.ts";
import { writeTypes } from "./write-types.ts";

const knexMap = new Map<string, KnexInstances>();

/**
 * Creates knex instances for database reader and writer connections
 */
export async function createKnex(
  name: string,
  migrationDirectory = "",
  postProcessResponse = defaultPostProcessResponse,
): Promise<KnexInstances> {
  const migrations = migrationDirectory
    ? { directory: migrationDirectory }
    : {};

  const config = getConnectionConfig(name);

  logger.info("knex_connection", {
    host: config.host,
    database: config.database,
    connections: config.connections,
    proxy: config.proxy,
    reader: config.host !== config.hostReader,
  });

  const writer = makeKnex(
    config.host,
    config.user,
    config.password,
    config.database,
    migrations,
    postProcessResponse,
    config.proxy,
    config.connections,
  );

  try {
    await writer.raw("select 1 as alive");
  } catch (e) {
    checkIsError(e);
    if (!e.message.includes(`database "${config.database}" does not exist`)) {
      throw e;
    }
    await ensureDatabase(
      config.host,
      config.user,
      config.password,
      config.database,
    );
  }

  if (migrationDirectory) {
    await writer.migrate.latest();
  }

  const reader = makeKnex(
    config.hostReader,
    config.user,
    config.password,
    config.database,
    migrations,
    postProcessResponse,
    config.proxy,
    config.connections,
  );

  try {
    await reader.raw("select 1 as alive");
  } catch {
    await reader.destroy();

    logger.warn("reader_not_available", {
      name,
      host: config.host,
      hostReader: config.hostReader,
    });

    addShutdownCleanupHandler(() => writer.destroy());
    return { writer, reader: writer };
  }

  addShutdownCleanupHandler(async () => {
    await Promise.all([
      writer.destroy(),
      reader.destroy(),
    ]);
  });

  return { writer, reader };
}

/**
 * Sets up and returns a knex writer instance, creating if needed
 */
export async function setupKnex(
  name: string,
  migrationDirectory?: string,
): Promise<Knex> {
  // deno-lint-ignore no-explicit-any
  const globalAny = globalThis as any;
  globalAny.KnexMigration = migrationHelpers();

  const knex = knexMap.get(name);
  if (!knex) {
    const nextKnex = await createKnex(name, migrationDirectory);
    knexMap.set(name, nextKnex);
    if (isTestModeEnabled && migrationDirectory) {
      await writeTypes(nextKnex.writer, join(migrationDirectory, ".."));
    }
    return nextKnex.writer;
  }
  return knex.writer;
}

/**
 * Gets an existing knex writer instance by name
 */
export function getKnex(name: string): Knex {
  if (typeof name !== "string" || !name) {
    throw new KnexInvalidNameError();
  }

  const knex = knexMap.get(name);
  if (!knex) {
    throw new KnexNotSetupError(name);
  }
  return knex.writer;
}

/**
 * Gets an existing knex reader instance by name
 */
export function getKnexReader(name: string): Knex {
  if (typeof name !== "string" || !name) {
    throw new KnexInvalidNameError();
  }

  const knex = knexMap.get(name);
  if (!knex) {
    throw new KnexNotSetupError(name);
  }
  return knex.reader;
}

/**
 * Gets knex instance, waiting for remote connection in test mode
 */
export async function remoteKnex(name: string): Promise<Knex> {
  if (!isTestModeEnabled) return setupKnex(name);
  const knex = knexMap.get(name);
  if (knex) return knex.writer;
  logger.info("wait_on_remote_knex", { name });
  await wait(1000);
  return remoteKnex(name);
}
