import { meter } from "../metrics.ts";

/**
 * Gauge metric tracking the number of database connections currently in use
 */
export const knexConnectionsUsed = meter.createGauge("db_connections_used");

/**
 * Gauge metric tracking the number of free database connections in the pool
 */
export const knexConnectionsFree = meter.createGauge("db_connections_free");

/**
 * Gauge metric tracking the number of database connections pending creation
 */
export const knexConnectionsPendingCreation = meter.createGauge(
  "db_connections_pending_creation",
);

/**
 * Gauge metric tracking the number of requests waiting to acquire a connection
 */
export const knexConnectionsPendingAcquire = meter.createGauge(
  "db_connections_pending_acquire",
);

/**
 * Gauge metric tracking the total number of database connections destroyed
 */
export const knexConnectionsDestroyed = meter.createGauge(
  "db_connections_destroyed",
);
