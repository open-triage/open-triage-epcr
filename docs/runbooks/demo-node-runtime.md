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

It reads node/agent inventory and runs `df` in existing Cilium agents against
their host-mounted runtime directory. It creates no pods and changes no node
files. The Kubernetes credentials need to list nodes and kube-system pods and
execute the read-only probe in Cilium's agent container. Scheduled CI reuses the
existing demo environment and its short-lived DOKS kubeconfig.

The check fails when either bytes or inodes reach 70% use, fewer than 32 MiB
remain, a node is not Ready, or a worker cannot be inspected. Each successful
probe logs a JSON measurement containing the node, mount, available bytes and
byte/inode usage. Review consecutive workflow logs to identify growth before
the runtime becomes unable to start containers.

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
