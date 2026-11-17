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
their host-mounted runtime directory. For runtime log paths it also verifies the
operator's log policy and timer through the existing DOKS telemetry helper's
host mount. It creates no pods and changes no node files. Credentials must read
that ConfigMap, list nodes and kube-system pods, and execute these read-only
probes. Scheduled CI reuses the demo environment and short-lived DOKS kubeconfig.

Run `npm run check:workflows` to validate GitHub expression/context availability
as well as workflow syntax. The pinned actionlint container runs in PR application
validation and the local CI preflight; `DOCKER_COMMAND=docker.exe` is supported
on WSL. This catches invalid contexts in scheduled workflows before merge, even
when those workflows do not run on pull requests.

The check fails when CNI logs lack a disk destination or a verified bounded
rotation policy, a worker's installed CNI log path differs from its saved path,
either bytes or inodes reach 70% use, fewer than 32 MiB remain, a node is not Ready,
or a worker cannot be inspected. Each
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

## Bounded CNI log rotation

On 2026-11-17, inspection during a recurrence identified the files consuming the
197.4 MiB runtime filesystem: a 100 MiB rotated CNI log and an approximately
92 MiB active log in `/run/cilium`. Endpoint state and BPF templates occupied only
about 2 MiB. The CNI plugin's 100 MiB rotation size allows its logs to exhaust this
filesystem before the next rotation. Removing a preserved, checksum-verified
archive restored container execution and deployment without rebooting the node.

[DigitalOcean manages Cilium and may revert custom settings](https://docs.digitalocean.com/products/kubernetes/details/managed/).
The reconciler restored the demo's `cni-log-file` setting within minutes of an
override. The final configuration therefore keeps the managed
`/var/run/cilium/cilium-cni.log` path and installs a separate, operator-owned
logrotate policy, approved for the demo worker on 2026-11-17.

The files in `deploy/node-runtime-logging/` configure an 8 MiB size threshold,
four compressed archives under `/var/log/opentriage-cilium-cni`, and a systemd
check every five minutes. `copytruncate` keeps existing writers on the same
inode while placing archives on the main disk. Size is checked periodically,
so 8 MiB is a rotation threshold rather than a hard quota. Like ordinary
copytruncate rotation, writes concurrent with copying/truncation have a small
log-loss window; application data is unaffected.

The service uses its own state directory and permits writes only to its runtime
log directory and systemd-managed archive/state directories. The timer is
enabled for reboot persistence. This corrects known log retention; it does not
delete runtime bundles, endpoint state, or sockets. The old inactive log remains
preserved as `/var/log/cilium-cni-recovered-2026-11-17.log` for incident review.

Provision replacement workers with Debian's `logrotate` package and these files:

| Repository file | Host destination |
| --- | --- |
| `deploy/node-runtime-logging/cilium-cni.logrotate` | `/etc/opentriage/cilium-cni.logrotate` |
| `deploy/node-runtime-logging/opentriage-cilium-logrotate.service` | `/etc/systemd/system/opentriage-cilium-logrotate.service` |
| `deploy/node-runtime-logging/opentriage-cilium-logrotate.timer` | `/etc/systemd/system/opentriage-cilium-logrotate.timer` |

Install files as root, mode 0644, then run on the authorized host:

```sh
systemd-analyze verify /etc/systemd/system/opentriage-cilium-logrotate.{service,timer}
systemctl daemon-reload
systemctl enable --now opentriage-cilium-logrotate.timer
systemctl start opentriage-cilium-logrotate.service
```

The shared check verifies the three installed files against their repository
hashes, that the timer is active and enabled, and that the service has completed
successfully. It fails if a worker is missing the policy, including after node
replacement or provider maintenance. The check only reports drift; it never
installs packages or overwrites managed configuration. Local Linux regression
tests exercise real logrotate size thresholds, archive retention, and open
writers; non-Linux development skips this host-specific test.

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
