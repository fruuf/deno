import { delay } from "jsr:@std/async";
import { join } from "jsr:@std/path";
import { before } from "jsr:@std/testing/bdd";
import { filter, firstValueFrom } from "npm:rxjs";
import { isFile } from "../fs.ts";
import { iteratorFrom, wrapIterator } from "../util.ts";
import { isStartupCompleteStream } from "./lifecycle.ts";

/**
 * Sets up test dependencies by importing service modules and waiting for startup.
 */
export function testDependencies(services: string[] = []) {
  const { stack } = Error("stack");
  before(async () => {
    const stackIterator = wrapIterator(
      iteratorFrom(stack?.split("\n") ?? []),
    );

    const [root] = stackIterator
      .filter((line) => line.includes("file://"))
      .map((line) => line.split("file://")[1])
      .filter((line) => line.includes("/services/"))
      .map((line) => line.split("/services/")[0])
      .take(1).toArray();

    for (const service of services) {
      const serviceDir = join(root, "services", service);

      const mainEntry = join(serviceDir, "main.ts");
      const namedEntry = `${serviceDir}.ts`;

      const entry = (await isFile(mainEntry) && mainEntry) ||
        (await isFile(namedEntry) && namedEntry) ||
        "";

      if (!entry) {
        throw new Error(`invalid service "${service}" (${mainEntry})`);
      }

      await import(`file://${entry}`);
    }

    await delay(10);
    await firstValueFrom(isStartupCompleteStream.pipe(filter(Boolean)));
  });
}
