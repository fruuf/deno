import {
  createMultiBatch,
  createMultiGroupBatch,
  createSingleBatch,
  createSingleGroupBatch,
} from "../batch.ts";
import { cacheTimeout, numberKey, stringKey } from "../cache.ts";
import { logger } from "../log.ts";
import { isTestModeEnabled } from "../service.ts";
import { uuid } from "../util.ts";
import { iterateQuery, Now } from "./helper.ts";
import { knexTransaction, remoteKnex } from "./knex.ts";
import { uuidPKey } from "./migration/helpers.ts";
import { mirrorFields } from "./migration/mirror-fields.ts";
import { partitionTable } from "./migration/partition.ts";
import { createTable } from "./table.ts";

// Re-export functions from subdirectory
export { uuidPKey } from "./migration/helpers.ts";
export { mirrorFields } from "./migration/mirror-fields.ts";
export { partitionTable } from "./migration/partition.ts";

/**
 * Returns a collection of helper functions for database migrations
 */
export function migrationHelpers() {
  return {
    cacheTimeout,
    createMultiBatch,
    createMultiGroupBatch,
    createSingleBatch,
    createSingleGroupBatch,
    createTable,
    isTestModeEnabled,
    iterateQuery,
    knexTransaction,
    logger,
    mirrorFields,
    Now,
    numberKey,
    partitionTable,
    remoteKnex,
    stringKey,
    uuid,
    uuidPKey,
  };
}
