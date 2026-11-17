import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const runtimeLoggingFiles = [
  ["cilium-cni.logrotate", "/etc/opentriage/cilium-cni.logrotate"],
  ["opentriage-cilium-logrotate.service", "/etc/systemd/system/opentriage-cilium-logrotate.service"],
  ["opentriage-cilium-logrotate.timer", "/etc/systemd/system/opentriage-cilium-logrotate.timer"],
].map(([name, path]) => {
  const content = readFileSync(new URL(`../deploy/node-runtime-logging/${name}`, import.meta.url), "utf8");
  return { path, content, sha256: createHash("sha256").update(content).digest("hex") };
});

export const runtimeLoggingProbe = `set -eu
sha256sum ${runtimeLoggingFiles.map(({ path }) => path).join(" ")}
systemctl is-active opentriage-cilium-logrotate.timer
systemctl is-enabled opentriage-cilium-logrotate.timer
systemctl show opentriage-cilium-logrotate.service --property=Result --value
systemctl show opentriage-cilium-logrotate.service --property=ExecMainExitTimestampMonotonic --value
`;

export function verifyRuntimeLoggingPolicy(output) {
  const lines = output.trim().split(/\r?\n/);
  if (lines.length !== 7 || lines[3] !== "active" || lines[4] !== "enabled" || lines[5] !== "success" ||
      !/^[1-9]\d*$/.test(lines[6] ?? "") ||
      runtimeLoggingFiles.some(({ path, sha256 }, index) => lines[index] !== `${sha256}  ${path}`)) {
    throw new Error("CNI log rotation policy is missing, changed, disabled, inactive, or failing");
  }
}
