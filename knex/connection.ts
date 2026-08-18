import knexFactory, { Knex } from "npm:knex";
// @ts-types="npm:@types/pg"
import pg from "npm:pg";
import { configBoolean, configNumber, configString } from "../config.ts";
import { logger } from "../log.ts";
import { isProductionModeEnabled, withTestIdentifier } from "../service.ts";
import { CLIENT } from "./helper.ts";

// Configure PostgreSQL type parsers
// bigint
pg.types.setTypeParser(20, Number);

// numeric, strip decimals
pg.types.setTypeParser(
  1700,
  (result: string) => BigInt(result.replace(/\.\d+$/, "")),
);

// sums of bigInt in postgres seem to return a numeric as well, so lets make sure we can send it via json
// deno-lint-ignore no-explicit-any
(BigInt as any).prototype.toJSON = function toJSON() {
  return Number(this);
};

const ageSymbol = Symbol("age");

type Connection = {
  [ageSymbol]: number;
  processID: number;
};

/**
 * Knex instances for writer and reader connections
 */
export type KnexInstances = {
  // deno-lint-ignore no-explicit-any
  writer: Knex<any, any[]>;
  // deno-lint-ignore no-explicit-any
  reader: Knex<any, any[]>;
};

/**
 * Default post-process response handler for knex
 */
// deno-lint-ignore no-explicit-any
export function defaultPostProcessResponse(response: any) {
  if (Array.isArray(response?.rows)) {
    return response.rows;
  }
  return response;
}

/**
 * Creates a configured knex instance for the given host
 */
export function makeKnex(
  host: string,
  user: string,
  password: string,
  database: string,
  migrations: { directory?: string },
  postProcessResponse: typeof defaultPostProcessResponse,
  proxy: boolean,
  connections: number,
): Knex {
  const knex = knexFactory({
    client: CLIENT,
    connection: {
      host,
      user,
      password,
      database,
      charset: "utf8",
      keepAlive: true,
      keepAliveInitialDelayMillis: 5_000,
    },
    pool: {
      min: 0,
      max: proxy ? 500 : connections,
      idleTimeoutMillis: proxy ? 1000 : 30_000,
      // lets store a timestamp on the connection
      afterCreate(connection: Connection, done: () => void) {
        connection[ageSymbol] = Date.now();
        done();
      },
    },
    acquireConnectionTimeout: 5_000,
    asyncStackTraces: !isProductionModeEnabled,
    migrations,
    debug: false,
    postProcessResponse,
  });

  const originalValidateConnection = knex.client.validateConnection;
  knex.client.validateConnection = (connection: Connection) => {
    const age = Date.now() - connection[ageSymbol];
    if (age > 1000 * 60 * 10) {
      logger.info("knex_retire_connection", {
        age,
        processID: connection.processID,
      });
      return false;
    }
    return originalValidateConnection(connection);
  };

  return knex;
}

/**
 * Gets database connection configuration from environment
 */
export function getConnectionConfig(name: string) {
  const host = configString(`${name}_postgres_host`, "postgres");
  const hostReader = configString(`${name}_postgres_host_reader`, host);
  const user = configString(`${name}_postgres_user`, "postgres");
  const password = configString(`${name}_postgres_password`, "password");
  const database = configString(
    `${name}_postgres_db`,
    withTestIdentifier(name),
  );
  const proxy = configBoolean(`${name}_postgres_proxy`, false);
  const defaultConnections = isProductionModeEnabled ? 20 : 1;
  const connections = configNumber(
    `${name}_postgres_pool_max`,
    defaultConnections,
  );

  return {
    host,
    hostReader,
    user,
    password,
    database,
    proxy,
    connections,
  };
}

/**
 * Creates database if it doesn't exist
 */
export async function ensureDatabase(
  host: string,
  user: string,
  password: string,
  database: string,
) {
  const tempKnex = knexFactory({
    client: CLIENT,
    connection: { host, user, password, database: "postgres" },
  });
  await tempKnex.raw(`CREATE DATABASE "${database}"`);
  await tempKnex.raw(
    `GRANT ALL PRIVILEGES ON DATABASE "${database}" TO "${user}"`,
  );
  await tempKnex.destroy();
}
