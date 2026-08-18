import { Cluster, ClusterOptions, Redis, RedisOptions } from "npm:ioredis";
import { configBoolean, configString } from "../config.ts";
import { errorHandler, NotFoundError } from "../error.ts";
import { logger } from "../log.ts";
import {
  addShutdownCleanupHandler,
  isTestModeEnabled,
  withTestIdentifier,
} from "../service.ts";

type RedisClient = {
  name: string;
  prefix: string;
  cluster: boolean;
  client: Redis | Cluster;
};

type OnClientHandler = (redis: Redis | Cluster) => Promise<void> | void;

const redisMap = new Map<string, RedisClient>();
const onClientHandlersMap = new Map<string, OnClientHandler[]>();

/**
 * Sets up Redis client with configuration and connection handling.
 */
export async function setupRedis(clientName: string) {
  const client = redisMap.get(clientName);
  if (client) return client.client;

  const REDIS_HOST = configString(`${clientName}_redis_host`, "redis");
  const REDIS_CLUSTER = configBoolean(`${clientName}_redis_cluster`, false);
  const REDIS_TLS = configBoolean(`${clientName}_redis_tls`, false);
  const REDIS_PREFIX = configString(
    `${clientName}_redis_prefix`,
    isTestModeEnabled ? withTestIdentifier(clientName) : "",
  );

  logger.info("redis", {
    clientName,
    host: REDIS_HOST,
    prefix: REDIS_PREFIX,
    cluster: REDIS_CLUSTER,
    tls: REDIS_TLS,
  });

  const redisOptions: RedisOptions = {
    enableAutoPipelining: true,
    ...(REDIS_TLS ? { tls: {} } : {}),
  };

  if (!REDIS_CLUSTER) {
    const nextClient = new Redis({ host: REDIS_HOST, ...redisOptions });
    const status = await nextClient.ping();
    if (!status) {
      throw new Error("redis unavailable");
    }

    const redis = {
      name: clientName,
      prefix: REDIS_PREFIX,
      cluster: REDIS_CLUSTER,
      client: nextClient,
    };

    redisMap.set(clientName, redis);
    const onClientHandlers = onClientHandlersMap.get(clientName) ?? [];
    for (const onClientHandler of onClientHandlers) {
      onClientHandler(redis.client);
    }
    addShutdownCleanupHandler(() => {
      nextClient.disconnect();
    });
    return nextClient;
  }

  const clusterOptions: ClusterOptions = {
    enableAutoPipelining: redisOptions.enableAutoPipelining,
    redisOptions,
  };

  const nextClient = new Redis.Cluster([{ host: REDIS_HOST }], clusterOptions);

  nextClient.on("error", (error) => {
    const handledError = errorHandler(error);
    logger.warn("redis_error", {
      clientName,
      error: handledError.message,
      REDIS_HOST,
      REDIS_CLUSTER,
      REDIS_TLS,
    });
  });

  nextClient.on("node error", (error) => {
    const handledError = errorHandler(error);
    logger.warn("redis_node_error", {
      clientName,
      error: handledError.message,
      REDIS_HOST,
      REDIS_CLUSTER,
      REDIS_TLS,
    });
  });

  const status = await nextClient.ping();
  if (!status) {
    throw new Error("redis unavailable");
  }

  const redis = {
    name: clientName,
    prefix: REDIS_PREFIX,
    cluster: REDIS_CLUSTER,
    client: nextClient,
  };

  redisMap.set(clientName, redis);
  const onClientHandlers = onClientHandlersMap.get(clientName) ?? [];
  for (const onClientHandler of onClientHandlers) {
    onClientHandler(redis.client);
  }
  addShutdownCleanupHandler(() => {
    nextClient.disconnect();
  });
  return nextClient;
}

/**
 * Gets Redis client object with metadata by name.
 */
export function getRedisClient(clientName: string) {
  const redis = redisMap.get(clientName);
  if (!redis) throw new NotFoundError("redis client");
  return redis;
}

/**
 * Gets Redis connection instance by client name.
 */
export function getRedis(clientName: string) {
  return getRedisClient(clientName).client;
}

/**
 * Executes handler when Redis client becomes available.
 */
export function onClient(
  clientName: string,
  handler: (redis: Redis | Cluster) => Promise<void> | void,
) {
  const redis = redisMap.get(clientName);
  if (redis) {
    handler(redis.client);
  } else {
    const onClientHandlers = onClientHandlersMap.get(clientName) ?? [];
    onClientHandlersMap.set(clientName, [...onClientHandlers, handler]);
  }
}
