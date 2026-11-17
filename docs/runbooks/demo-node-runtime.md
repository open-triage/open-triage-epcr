# Demo node runtime storage

The demo deployment checks every worker's host runtime filesystem before Helm
starts migration hooks. `Demo node runtime health` repeats the same read-only
check at minutes 17 and 47 of every hour and supports manual dispatch.
Maintainers should enable GitHub Actions failure notifications for this workflow.
Scheduled Actions can be delayed; use an external monitoring service if a strict
alert-delivery guarantee is required.

Run the probe with the demo cluster selected in the current kubeconfig:

```sh
node scripts/check-node-runtime.mjs
```

It reads node/agent inventory and the `cilium-config` ConfigMap, checks the active
CNI configuration on every node, and runs `df` in existing Cilium agents against
their host-mounted runtime directory. It creates no pods and changes no node
files. The Kubernetes credentials need to read that ConfigMap, list nodes and
kube-system pods, and execute the read-only probe in Cilium's agent container.
Scheduled CI reuses the existing demo environment and its short-lived DOKS kubeconfig.

Run `npm run check:workflows` to validate GitHub expression/context availability
as well as workflow syntax. The pinned actionlint container runs in PR application
validation and the local CI preflight; `DOCKER_COMMAND=docker.exe` is supported
on WSL. This catches invalid contexts in scheduled workflows before merge, even
when those workflows do not run on pull requests.

The check fails when the saved CNI log path is outside `/var/log`, a worker's
installed CNI log path differs, either bytes or inodes reach 70% use, fewer than
32 MiB remain, a node is not Ready, or a worker cannot be inspected. Each
successful probe logs a JSON measurement containing the node, mount, available
bytes and byte/inode usage, plus the CNI log destination. Review consecutive
workflow logs to identify growth before the runtime becomes unable to start containers.

## Why ordinary disk and readiness checks missed the incident

On 2026-11-01 the demo worker's `/run` was a separate approximately 198 MiB tmpfs.
Cilium could not write endpoint state and containerd could not write bundle
configuration. The main disk still had tens of GiB free and Kubernetes reported
the node and network agent Ready. Neither signal established runtime headroom.
A worker power cycle restored `/run` to approximately 5 MiB used, and migration,
rollout and public HTTPS checks subsequently passed.

The reboot cleared the accumulated state, so the specific source of the original
growth is not established. The new checks provide warning headroom and block
deployments against an exhausted runtime; they do not impose a storage quota or
repair a provider/runtime leak automatically.

## CNI log placement

On 2026-11-17, inspection during a recurrence identified the files consuming the
197.4 MiB runtime filesystem: a 100 MiB rotated CNI log and an approximately
92 MiB active log in `/run/cilium`. Endpoint state and BPF templates occupied only
about 2 MiB. The CNI plugin's 100 MiB rotation size allows its logs to exhaust this
filesystem before the next rotation. Removing a preserved, checksum-verified
archive restored container execution and deployment without rebooting the node.

The demo now uses `/var/log/cilium-cni.log` on the worker's main disk. Both
`cilium-config.data.cni-log-file` and the Cilium plugin's `log-file` field in
`/etc/cni/net.d/05-cilium.conflist` must use this path. The saved ConfigMap supplies
subsequent agent starts; changing the active JSON atomically lets new CNI calls
use it immediately without restarting the agent or changing networking settings.
The plugin retains its built-in log rotation. The old inactive log was preserved
as `/var/log/cilium-cni-recovered-2026-11-17.log`; it is an incident archive, not an
active log destination.

[Cilium exposes the log destination as `cni.logFile`](https://docs.cilium.io/en/stable/helm-reference/).
[DigitalOcean manages Cilium and may revert custom settings](https://docs.digitalocean.com/products/kubernetes/details/managed/).
This is a targeted operator override, not a provider-guaranteed persistent
setting. The shared deployment and scheduled check detects a reset in either
the ConfigMap or the active node configuration before log growth fills `/run`.
Check it after provider maintenance, node replacement, or a cluster upgrade.
Inspect provider changes before reapplying the override; do not replace the
whole managed ConfigMap or install a loop that repeatedly overwrites it.

When correcting placement, back up the ConfigMap and active JSON first, verify
the host's `/var/log` filesystem has disk headroom, change only the log-path
fields, and preserve the active configuration's ownership and permissions.
Validate a fresh pod's networking and DNS and confirm new log writes on the main
disk. Only remove old runtime log files after preserving and verifying them and
checking that no process still has them open. Never remove endpoint state or
container runtime bundles as log cleanup.

If exec is unavailable, the node's kubelet API can still expose filesystem
metrics at `/api/v1/nodes/<node>/proxy/metrics/cadvisor`; inspect the root
`container_fs_usage_bytes` and `container_fs_limit_bytes` series for
`device="/run"`, plus inode counts. The `/proxy/logs/` endpoint can also expose
host journal files for local inspection with `journalctl --file`. These paths
need `nodes/proxy` authorization and do not require starting a container.

## Respond to a warning

1. Confirm the current cluster and affected node before doing maintenance.
2. Capture `df -Pk` and `df -Pi` for the host runtime mount. While the runtime
   still accepts containers, use a temporary host-network node diagnostic pod
   to inspect `du -x /host/run`: stay on the runtime filesystem so container
   rootfs mounts do not inflate the result. Preserve the largest directory/file
   measurements and relevant Cilium/containerd logs before rebooting.
3. Investigate the growing component with the managed Kubernetes provider.
   Fix its retention or runtime defect, or use the provider's supported runtime
   configuration/upgrade. Increasing the main disk does not enlarge a tmpfs;
   increasing a tmpfs cap also needs adequate memory headroom.
4. If container startup and exec are already unavailable, use an authorized
   provider account to gracefully reboot or replace the affected managed worker.
   A single-worker demo has downtime during this operation. Node management
   requires provider permissions beyond the deployment account's kubeconfig
   access.
5. Run the runtime probe again, then rerun the failed deployment job. Confirm
   migrations, rollout and public smoke checks pass.

Do not delete live Cilium state, containerd bundles or sockets from `/run`, or
install a periodic reboot/cleanup job to mask unexplained growth. Those actions
can disrupt running containers and remove evidence needed to fix the cause.
