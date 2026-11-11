# Android managed connection configuration

The generic development package is `org.opentriage.development`. Production
package/signing ownership is selected in ticket 013. The clinical APK is an
ordinary managed application and never becomes the device owner.

Android's `APP_RESTRICTIONS` schema is declared in `res/xml/app_restrictions.xml`.
`RestrictionsManager` supplies settings on startup, resume, policy broadcasts
and before native credential-bearing requests. Management supplies the approved
connection. Vehicle pairing still requires the existing confirmed, five-minute,
single-use authorization, followed by separate clinician sign-in.

## Version 1 contract

Supply all three keys with their actual Android types. XML defaults do not
guarantee that the management agent delivers a key.

| Key | Android type | Value |
| --- | --- | --- |
| `configurationVersion` | Integer | `1` |
| `serverOrigin` | String | HTTPS origin, without path, credentials, query or fragment. |
| `publicCaPem` | String | Public CA PEM bundle, or explicit empty string for Android system trust. |

Public-CA example:

```json
{
  "configurationVersion": 1,
  "serverOrigin": "https://ems.example.org",
  "publicCaPem": ""
}
```

For internal-CA deployments, put complete public CA PEM text, including delimiters
and newlines, in `publicCaPem`; escape newlines as `\n` in JSON. At most 48,000
characters and 16 CA certificates are accepted. Leaf certificates, expired roots,
invalid PEM and private keys are rejected. The Admin pairing artifact must carry
the same origin and CA set. Certificate ordering and surrounding whitespace do
not change trust identity.

Empty PEM selects the platform's system trust anchors. A CA installed into a user
certificate store by an MDM is not automatically a system trust anchor for this
app. Use application-specific public PEM for the supported private-CA path;
validate any alternative OS trust arrangement in its deployment. App trust does
not configure Android Settings, external browsers or identity providers.

## Effective state

| Delivered state | Behavior |
| --- | --- |
| No settings, never managed | Manual scan/import pairing remains available. |
| Complete valid settings | Setup displays the locked managed server; matching pairing reaches confirmation. |
| Pairing origin or CA differs | Rejected before enrollment or credential transfer. |
| Partial, wrong-type, invalid or unsupported-version policy | Setup and native requests blocked; IT must correct policy. |
| Standard `UserManager.KEY_RESTRICTIONS_PENDING` is true | Blocked while management delivers settings. |
| Previously managed, settings absent | Remains managed and blocked across restart; no manual fallback. |
| Active enrollment, same server and CA set | Existing enrollment and ordinary server authorization continue. |
| Active enrollment, changed server or CA set | Readable work is locked and native requests blocked; encrypted enrollment and eligible drafts retained. |
| Original matching policy restored | Original connection resumes within normal expiry, revocation and recovery rules. |

Only the fact that management was observed is persisted separately. Connection
and cookies stay in the Keystore-encrypted vault. Policy read/storage errors fail
closed. On Android 14+, each contributing administrator must supply a complete
valid configuration with the same effective server/trust context; partial or
conflicting authorities are rejected.

Every credential-bearing request samples policy before transmission and checks
again before returning a response or saving cookies. In-flight requests are never
redirected to a new server. Managed configuration does not grant clinical access.

Adding, removing or replacing a CA changes trust even at the same origin. An
already enrolled app blocks that transition; this slice does not move credentials
onto replacement trust. Restore the original policy to resume. Ticket 012 adds
CA rotation, and ticket 005 owns changed-server reassignment. Do not clear app
data to bypass policy errors when unsynchronized work might be retained.

## Intune

For the agreed fully managed/dedicated scope, target the directly deployed APK
with a **Managed devices** app configuration policy. Enter the version as Integer
and both connection fields as String. Use the APK's schema or the tenant's JSON
template, preserving exact keys/types. Certificate-alias substitution is not PEM.

Assign all keys before launch. Issue a matching pairing artifact through Admin,
verify the locked origin and rejection of a conflicting artifact, then confirm
the unit and complete ordinary sign-in. Microsoft's current direct-LOB guidance
requires a new app configuration policy for an updated APK version. Include that
assignment in upgrade rollout; missing policy must leave the app managed and
blocked. Actual tenant/certificate-profile/upgrade acceptance is ticket 017.

## Combined Headwind/MDMesh

The management agent must turn the generic values above into Android Bundle
values for `org.opentriage.development`, using standard
`DevicePolicyManager.setApplicationRestrictions`. Keep version as an integer,
public CA as one PEM string, and private server keys outside configuration.

Inspect the actual combined server/agent before claiming that its configuration
feature reaches standard app restrictions. If it does not, record that separate
MDM project's blocker. An app-private file or manual workaround does not establish
managed provisioning. The clinical app has no vendor SDK or device-owner role.
Actual deployment acceptance belongs to ticket 018.

## Standard controller validation

Run `npm run android:build`, build the API, then
`npm run android:test -- --skip-build` on a fresh Android 13+ emulator with no
Android accounts. The harness owns disposable real PostgreSQL/API fixtures. It
installs the ordinary clinical APK and a separate explicitly `testOnly` APK from
`android/management-test-controller`, using `adb install -t` for the controller.

The runner makes only the controller the emulator's device owner with
`adb shell dpm set-device-owner org.opentriage.managementtest/.AdminReceiver`.
Real `DevicePolicyManager` delivery exercises locked settings, matching pairing
without clinician privileges, override rejection, pending/malformed/removed
policies, server/CA changes, retained encrypted enrollment and actual process
termination/relaunch as well as activity restart.
The owner is removed afterward. The controller is never packaged into or
distributed with the clinical APK or installed on ordinary devices by the app.

The Android PR workflow runs the same command with hardware acceleration. JVM
tests cover typed policy and trust selection; browser tests cover localized
compact states. This proves the application contract; real vendor environments
and physical phone/tablet acceptance remain tickets 017–019.

References: [Android managed configurations](https://developer.android.com/work/managed-configurations),
[DevicePolicyManager](https://developer.android.com/reference/android/app/admin/DevicePolicyManager),
[Intune managed-device configuration](https://learn.microsoft.com/en-us/intune/app-management/configuration/configure-managed-android).
