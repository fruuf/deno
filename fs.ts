import { join } from "jsr:@std/path";
import { cacheTimeout, stringKey } from "./cache.ts";
import { asyncIteratorFrom, wrapAsyncIterator } from "./util.ts";

/**
 * Cached function to check if a path points to a file.
 */
export const isFile = cacheTimeout(stringKey, async (file: string) => {
  const stat = await Deno.lstat(file);
  return stat.isFile;
});

/**
 * Cached function to check if a path points to a directory.
 */
export const isDirectory = cacheTimeout(stringKey, async (dir: string) => {
  const stat = await Deno.lstat(dir);
  return stat.isDirectory;
});

/**
 * Recursively reads all files in a directory tree.
 */
export const readdirR = cacheTimeout(
  stringKey,
  async (dir: string): Promise<string[]> => {
    if (!(await isDirectory(dir))) return [];
    return wrapAsyncIterator(asyncIteratorFrom(Deno.readDir(dir)))
      .map((file) => {
        const next = join(dir, file.name);
        if (file.isDirectory) return readdirR(next);
        return [next];
      })
      .flatMap((files) => files)
      .toArray();
  },
);
