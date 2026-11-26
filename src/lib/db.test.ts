import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("failed eager DB startup stays request-scoped and allows another attempt", () => {
  const env = { ...process.env };
  delete env.DATABASE_URL;
  const sourceUrl = new URL("./db.ts", import.meta.url).href;
  const script = `
    import assert from "node:assert/strict";

    function failInstance(error) {
      const promise = Promise.reject(error);
      // The fake instance is installed before importing the module under test.
      // Its own rejection is handled; the eager bootstrap must handle its copy.
      promise.catch(() => undefined);
      globalThis.__pgliteInstance__ = promise;
    }

    const startupError = new Error("injected PGlite startup failure");
    failInstance(startupError);
    const { getSql } = await import(${JSON.stringify(sourceUrl)});
    await assert.rejects(getSql(), (error) => error === startupError);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(globalThis.__pgBootstrapPromise__, undefined);

    const retryError = new Error("injected PGlite retry failure");
    failInstance(retryError);
    await assert.rejects(getSql(), (error) => error === retryError);
    await new Promise((resolve) => setImmediate(resolve));
    console.log("request errors preserved; process alive; retry attempted");
  `;
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script],
    {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /request errors preserved; process alive; retry attempted/);
  assert.match(result.stderr, /PGLite bootstrap failed/);
});
