import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";

test("CNI rotation preserves an open writer, archives on disk, and retains only four logs", { skip: process.platform !== "linux" }, async () => {
  const root = await mkdtemp(join(tmpdir(), "cni-log-rotation-"));
  try {
    const runtime = join(root, "runtime");
    const archive = join(root, "archive");
    await mkdir(runtime); await mkdir(archive);
    const active = join(runtime, "cilium-cni.log");
    const configuration = (await readFile(new URL("../deploy/node-runtime-logging/cilium-cni.logrotate", import.meta.url), "utf8"))
      .replace("/run/cilium/cilium-cni.log", active).replace("/var/log/opentriage-cilium-cni", archive);
    const configPath = join(root, "logrotate.conf");
    await writeFile(configPath, configuration);
    const rotate = () => {
      const result = spawnSync("/usr/sbin/logrotate", ["--state", join(root, "status"), configPath], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr || String(result.error));
    };
    rotate(); // Missing logs must not fail timer execution.
    await writeFile(active, "small log\n");
    rotate();
    assert.equal(await readFile(active, "utf8"), "small log\n");
    for (let round = 1; round <= 6; round++) {
      await writeFile(active, Buffer.alloc(9 * 1024 * 1024, String(round)));
      const writer = await open(active, "a");
      try {
        const inode = (await writer.stat()).ino;
        rotate();
        assert.equal((await stat(active)).ino, inode);
        assert.equal((await stat(active)).size, 0);
        await writer.write("writer survived\n");
        assert.equal(await readFile(active, "utf8"), "writer survived\n");
      } finally { await writer.close(); }
    }
    assert.deepEqual((await readdir(archive)).sort(), [1, 2, 3, 4].map((n) => `cilium-cni.log.${n}.gz`));
    for (let age = 1; age <= 4; age++) {
      const content = gunzipSync(await readFile(join(archive, `cilium-cni.log.${age}.gz`)));
      assert.equal(content.length, 9 * 1024 * 1024);
      assert.ok(content.every((byte) => byte === String(7 - age).charCodeAt(0)));
    }
    assert.deepEqual(await readdir(runtime), ["cilium-cni.log"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
