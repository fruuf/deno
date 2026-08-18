import { exists } from "jsr:@std/fs";
import { join } from "jsr:@std/path";
import { cacheTimeout, stringKey } from "./cache.ts";
import { ParseQuery, ParseString } from "./parse.ts";
import { requestGet } from "./request.ts";
import { isValue } from "./util.ts";

/**
 * Gets the latest commit SHA for a GitHub repository.
 */
export const getLatestCommit = cacheTimeout(stringKey, (repo) =>
  requestGet(
    ParseQuery("sha", ParseString),
    `https://api.github.com/repos/${repo}/commits/main`,
  ), Infinity);

/**
 * Finds the root directory of the git repository.
 */
export const getRootDir = cacheTimeout(null, async () => {
  let dir = Deno.cwd();
  while (!(await exists(join(dir, ".git")))) {
    dir = join(dir, "..");
    if (dir === "/") {
      return Deno.cwd();
    }
  }
  return dir;
}, Infinity);

/**
 * Finds all directories containing deno.json files in the repository.
 */
export const getDenoDirs = cacheTimeout(null, async () => {
  const rootDir = await getRootDir();
  async function getDenoDirs(dir: string): Promise<string[]> {
    const denoDirs: string[] = [];
    for await (const file of Deno.readDir(dir)) {
      if (file.name === "node_modules") {
        continue;
      }
      if (file.name === "vendor") {
        continue;
      }
      if (file.name === "deno.json") {
        denoDirs.push(dir);
        continue;
      }
      if (file.isDirectory) {
        denoDirs.push(...await getDenoDirs(join(dir, file.name)));
        continue;
      }
    }
    return denoDirs;
  }
  return getDenoDirs(rootDir);
}, Infinity);

async function processDenoJson(file: string, repos: string[]) {
  type DenoJson = { imports: Record<string, string> };
  const content = await Deno.readTextFile(file);
  const data: DenoJson = JSON.parse(content);
  const nextImports = await Promise.all(
    Object.entries(data.imports).map(
      async ([name, source]): Promise<[string, string]> => {
        const [, repo, currentHash, file] = source.match(
          /raw\.githubusercontent\.com\/(\w+\/\w+)\/(\w+)\/(.+)$/,
        ) ?? [];
        if (!repos.includes(repo)) {
          return [name, source];
        }
        const nextHash = await getLatestCommit(repo);
        if (currentHash === nextHash) {
          return [name, source];
        }
        const nextSource =
          `https://raw.githubusercontent.com/${repo}/${nextHash}/${file}`;
        return [name, nextSource];
      },
    ),
  );
  const nextData = { ...data, imports: Object.fromEntries(nextImports) };

  await Deno.writeTextFile(file, JSON.stringify(nextData, null, 2));
}

async function processDenoLock(file: string, repos: string[]) {
  type DenoLock = { remote: Record<string, string> };
  const content = await Deno.readTextFile(file);
  const data: DenoLock = JSON.parse(content);
  const nextRemotes = await Promise.all(
    Object.entries(data.remote).map(
      async ([source, hash]): Promise<[string, string] | null> => {
        const [, repo, currentHash] = source.match(
          /raw\.githubusercontent\.com\/(\w+\/\w+)\/(\w+)\/.+$/,
        ) ?? [];
        if (!repos.includes(repo)) {
          return [source, hash];
        }
        const nextHash = await getLatestCommit(repo);
        if (currentHash === nextHash) {
          return [source, hash];
        }
        return null;
      },
    ),
  );
  const nextData = {
    ...data,
    remote: Object.fromEntries(nextRemotes.filter(isValue)),
  };

  await Deno.writeTextFile(file, JSON.stringify(nextData, null, 2));
}

/**
 * Updates GitHub raw URLs in deno.json and deno.lock to latest commits.
 */
export async function upgradeDenoGithub(
  repos = ["fruuf/deno"],
) {
  const denoDirs = await getDenoDirs();
  for (const denoDir of denoDirs) {
    await processDenoJson(join(denoDir, "deno.json"), repos);
    await processDenoLock(join(denoDir, "deno.lock"), repos);
  }
}
