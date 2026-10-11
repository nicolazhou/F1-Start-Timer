import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";

// Check the HTTP surface of the local server rather than only reviewing it.
test("local dev server binds to loopback, serves game files and denies private files", async () => {
  const child = spawn(process.execPath, ["scripts/serve.mjs"], {
    cwd: process.cwd(), env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let errors = "";
  child.stderr.on("data", (chunk) => { errors += chunk.toString(); });
  try {
    const url = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Dev server not ready: " + errors)), 6000);
      child.stdout.on("data", (chunk) => {
        const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+\//);
        if (match) { clearTimeout(timeout); resolve(match[0]); }
      });
      child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Server exited ${code}: ${errors}`)); });
    });
    for (const [path, expected] of [["", 200], ["src/main.js", 200], ["public/favicon.ico", 200],
      ["README.md", 200], ["THIRD_PARTY_NOTICES.md", 404], [".env", 404], ["package.json", 404],
      [".git/config", 404], ["scripts/build.mjs", 404], ["tests/storage.test.js", 404],
      ["%2eenv", 404], ["src/%2e%2e/package.json", 404]]) {
      const response = await fetch(url + path);
      assert.equal(response.status, expected, `${path}: wrong response status`);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    }
    const head = await fetch(url + "index.html", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal((await head.text()).length, 0);
    const post = await fetch(url + "index.html", { method: "POST" });
    assert.equal(post.status, 405);
  } finally {
    child.kill("SIGTERM");
  }
});
