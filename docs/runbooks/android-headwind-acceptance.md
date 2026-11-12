# Headwind managed configuration acceptance

The owner authorized a real Headwind MDM Community lab as the substitute for
unavailable Intune and combined Headwind/MDMesh environments on 2026-11-12
([scope and ticket](https://github.com/open-triage/open-triage-epcr/issues/816)).
The lab uses the ordinary signed `org.opentriage.android` APK and the
[standard managed configuration contract](android-managed-configuration.md).
OpenTriage remains an ordinary application. Only the separate Headwind agent
becomes device owner. This lab does not establish Intune, combined MDMesh,
physical-device, production-rollout or human-observed acceptance.

## Inspected implementation

The local console responds at `http://127.0.0.1:18080`; MQTT is bound to loopback
port 31000. The prepared server has the following recorded identities:

| Component | Identity |
| --- | --- |
| Official server image | `headwindmdm/hmdm:0.1.9@sha256:3550b48408407fca8ce692017e8e1be7bbf3442629d33de4072eb73b6188325e` |
| Deployed WAR | `5.40.1`, SHA-256 `c1b00198773cbd888d668448e39826fee778cceb40b4e87db89ea453a9f18bdf` |
| Removable lab agent | Upstream `75eff13e7e3faf2fbe0c4d22f42d24da2a139f69`, `com.hmdm.launcher` 6.40 / 15400 |
| Lab agent APK | SHA-256 `4a5e6d618a21b1e0b7c7edccb0ee8948ebcbb7ccc8f693491ad72d237106d3a8` |

The agent was built from official upstream source with a debug `testOnly=true`
manifest, local primary/secondary server URLs and an isolated fixture shared
secret. These are test-build changes, not changes to the clinical APK. The
bundled production agent 6.37 is not used because its removal was not established.

Read-only inspection of the running server's
`app/components/main/controller/configurations.controller.js`,
`app/components/main/view/modal/applicationSetting.html` and
`app/components/main/service/main.service.js` confirmed its actual setting shape:
configuration `applicationSettings` entries use `applicationId`,
`applicationName`, `applicationPkg`, `name`, `type: "STRING"`, `value`,
`readonly` and `variable`. The server-side string type is distinct from the
integer inside the managed JSON value.

In the pinned agent,
[`GetServerConfigTask`](https://github.com/h-mdm/hmdm-android/blob/75eff13e7e3faf2fbe0c4d22f42d24da2a139f69/app/src/main/java/com/hmdm/launcher/task/GetServerConfigTask.java)
calls
[`AppRestrictionUpdater`](https://github.com/h-mdm/hmdm-android/blob/75eff13e7e3faf2fbe0c4d22f42d24da2a139f69/app/src/main/java/com/hmdm/launcher/util/AppRestrictionUpdater.java)
after
processing server settings only when the agent is device owner.
`AppRestrictionUpdater` parses the special `managedConfig` JSON value into a
Bundle and invokes Android `DevicePolicyManager.setApplicationRestrictions` for
its target package. JSON integer and string types survive this path. This is
source and console inspection; it does not prove device delivery.

## Configure the approved application

Obtain the Admin-approved APK, digest, version code, signing certificate and
source/preflight identity from the release operator. Follow the deployment
ticket's artifact verification and targeting procedure before applying policy.
Never regenerate signing identity or reuse a consumed version code. Record the
actual imported application ID rather than assuming a lab database ID.

Store a complete standard contract in a local JSON file, for example:

```json
{
  "configurationVersion": 1,
  "serverOrigin": "https://ems.example.invalid",
  "publicCaPem": ""
}
```

For the internal-CA journey, use the fixture's real HTTPS origin and public CA
PEM in place of this example. Empty PEM explicitly selects system trust and
does not establish internal-CA acceptance. No private key, pairing token,
clinician credentials or server session belongs in this file.

Convert the contract to a Headwind application-setting template:

```sh
node scripts/android/headwind-policy.mjs /path/to/managed-configuration.json
```

This converter guards the operator format and accidental secret fields; it does
not certify the CA chain. The existing Android policy/TLS validators still check
CA parsing, validity, trust and agreement with the pairing artifact.

In the real configuration editor, select the imported `org.opentriage.android`
application, add exactly one `managedConfig` setting, and paste the output's
`value` string content as the value. Leave variable expansion off. Save the
configuration and synchronize the targeted agent. For an API-based lab runner,
bind `applicationId` and `applicationName` from the imported application and
preserve unrelated configuration fields and settings when saving. Do not send
the agent-side `packageId`/numeric-type schema to the console API.

The running server exposes configuration read/update at
`GET rest/private/configurations/:id` / `PUT rest/private/configurations`.
Device override settings have separate
`GET/POST rest/private/devices/:id/applicationSettings` and
`POST rest/private/devices/:id/applicationSettings/notify` routes. Inspect and
record both configuration and device overrides so a higher-priority override
does not make a configuration test appear to pass. Keep administrative session
cookies and shared secrets in protected local files; publish only sanitized
identifiers, hashes, policy outcomes and evidence paths.

## Device acceptance sequence

Obtain the shared-device lease and approved signed artifacts before executing
these steps. Record the actual Android release, model, serial alias, agent owner,
application version/certificate, targeting IDs and artifact hashes. Preserve the
original Home selection, reverses, radio/font state and clinical data. Do not
install another policy controller or issue a shell/manual restrictions command.
The actual Headwind agent must perform every policy delivery.

The matching signed instrumentation APK includes
`ManagedPolicyObservationTest#actualAgentDeliveredExactStandardRestrictions`.
It reads the clinical app's own `RestrictionsManager` Bundle and checks exact
keys, Android types and values, while proving that the specified external agent
owns the device and the clinical package does not. It never sets policy. Supply
`expectedOwnerPackage=com.hmdm.launcher` and `expectedConfigurationBase64` with
the base64-encoded expected contract JSON (or `{}` for the explicit-empty case)
to the normal Android instrumentation runner for
`org.opentriage.android.test/androidx.test.runner.AndroidJUnitRunner`.
Use the matching signed test APK without rebuilding or replacing the approved
clinical artifact. After a deletion test, observe against the old contract to
detect retained restrictions; observing the old Bundle is an external limitation,
not a successful removal. Pairing and clinical behavior still require real UI
and API observations below.

| Scenario | Required observation |
| --- | --- |
| Initial delivery | Real agent receives all three keys; app shows the locked intended origin. A conflicting pairing origin or CA is rejected; the matching Admin artifact reaches vehicle confirmation, then ordinary clinician sign-in. |
| Reconnect | Disconnect network, retain pending work, reconnect, synchronize agent and resume authorized application use without a reauthentication prompt. Neither transport reconnect nor agent refresh extends recovery deadlines. |
| Matching update | Save and synchronize the same effective origin/CA, including reordered CA bundle if applicable; enrollment and valid login remain usable. |
| Conflicting update | Deliver a different origin or CA through the server. Native requests and readable clinical work are blocked; encrypted enrollment and eligible pending work survive. Restore the exact original policy and verify normal authorized recovery. |
| Invalid/partial settings | Use deliberate test settings with wrong version type or a missing required key; the app blocks instead of using a manual fallback. Restore valid policy afterward. |
| Explicit empty policy | Retain the `managedConfig` package setting but replace its value with `{}`. Verify an actual empty Android Bundle and the previously managed app's blocked state, including restart. Restore valid policy. |
| Delete setting | Delete the server-side setting, synchronize the actual agent and independently observe the Android/app state. Record whether old restrictions remain; do not infer removal from an empty server response. |
| Signed in-place upgrade | Use the deployment ticket's approved increasing-version APK through Headwind, preserving UID/signing identity, enrollment, original deadlines and recoverable pending work. Recheck policy and media after upgrading. |
| Server revocation | Revoke authorization at the installation and verify the server rejects subsequent requests even if agent policy is cached. Management refresh is not a substitute for server authorization. |

The adapter intentionally accepts only the complete valid contract or `{}`.
Malformed-policy scenarios must be explicitly labeled negative fixtures; do not
weaken the production contract validator to generate them. Unit conversion tests
run in the early repository workflow via `tests/android-headwind-policy.test.mjs`:

```sh
node --test tests/android-headwind-policy.test.mjs
```

Run the documented native build/emulator checks and `npm run check:ci` before
publication, under the root coordinator's resource lease. Unit conversion tests
do not replace the real server/agent/device acceptance sequence.

## Clearing policy and external blockers

The inspected agent invokes `setApplicationRestrictions` only for packages that
remain present in its processed settings map. Removing the last setting for a
package can therefore leave the previous Android restrictions unchanged. This
was observed in the completed lab: after the received agent configuration lost
its last row, three subsequent OS observations retained the old Bundle. This is
a bounded observation, not a claim about every later refresh or a permanent
vendor defect. Explicit `managedConfig: {}` delivery produced an empty Bundle
and blocked the app; restoring valid policy restored its current login. Deletion
and explicit empty policy are separate scenarios.

If either required operation cannot be performed by the actual server/agent,
record exact versions, targeting state, server response, refresh time and device
outcome as an external Headwind agent/server blocker. Link separate project work
when available. Do not patch OpenTriage to guess deleted external policy, make it
device owner, or use a different controller to claim successful provisioning.

## Evidence and cleanup

The owner-delegated substitute lab completed on an Android 13 emulator with the
server and pinned agent identities above, dedicated configuration 4/device 3.
[Deployment acceptance](https://github.com/open-triage/open-triage-epcr/pull/833)
and [policy acceptance](https://github.com/open-triage/open-triage-epcr/pull/836)
record the sanitized results and exact-source validation. The actual Admin-selected
candidate 5 and anonymous public download matched the approved bytes. Headwind's
real agent installed candidate 4 and upgraded to 5; independently pulled APK hashes,
permanent signer and fresh inventory matched the immutable descriptors, with UID
10175 unchanged. No clinical ADB install or app-data clear supplied this proof.

Matching private-CA pairing, foreground reconnect, real process termination,
different-user denial and original-author online recovery passed with exact
pending ciphertext, pinned versions and original recovery deadline preserved.
Actual origin/CA conflicts, invalid typed policy and explicit empty policy blocked
the app and retained sealed credentials; valid policy restoration continued the
existing login without another prompt.

Administrative removal of the verified removable test owner delivered an empty
Bundle and blocked managed UI. This was device-side withdrawal, not a server
remote wipe. Installation revocation left the current personal session valid
(200), denied a fresh new-work request (403), and preserved the unopened assignment
and original server report pins/envelope receipt/deadline. Revocation observations
cover sealed connection and server metadata; native ciphertext preservation was
established by the preceding upgrade journey.

The completed lab's configuration/overrides, Home, radios/display and reverses
were restored; the removable agent was uninstalled and clinical version 5/data/UID
preserved. Earlier failed operator attempts remain failures. These results establish
the delegated Headwind emulator scope only. Intune, unavailable combined MDMesh,
[physical phone/tablet acceptance](android-physical-acceptance.md) and human
production-rollout signoff remain separate.

For each executed row record UTC times, artifact/agent identities, configuration
and device IDs, exact policy hash and sanitized observed pass/fail. Distinguish
automated observations from human signoff. Retain original recovery deadlines
and before/after enrollment/work fingerprints without publishing clinical text,
credentials or ciphertext keys. Do not silently turn an external limitation into
a pass.

After the leased sequence restore the original configuration/overrides, Home,
ADB reverses, radio and display state. Remove the removable test-only agent owner
with its supported Android test-admin removal path, then uninstall that agent.
Verify ordinary OpenTriage identity/data were preserved; keep existing protected
clinical state unless the root coordinator explicitly allocated disposable
state. Record any incomplete cleanup before releasing the device lease.
