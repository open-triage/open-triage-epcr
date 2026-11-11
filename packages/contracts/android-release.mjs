import { isAndroidApiProtocolCompatible } from "./android-client-protocol.mjs";
const hex = (value, size) => typeof value === "string" && new RegExp(`^[a-f0-9]{${size}}$`).test(value);
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
function parseAndroidReleaseDescriptor(input) {
  const value = input;
  const compatibility = value?.compatibility;
  if (!value || value.schemaVersion !== 1 || value.applicationId !== "org.opentriage.android" || !integer(value.versionCode, 1, 21e8) || typeof value.versionName !== "string" || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value.versionName) || !hex(value.certificateSha256, 64) || !hex(value.apkSha256, 64) || !hex(value.uiSha256, 64) || !hex(value.sourceCommit, 40) || !integer(value.apkBytes, 1, 128 * 1024 * 1024) || !integer(value.minAndroidApi, 33, 100) || !integer(value.targetAndroidApi, value.minAndroidApi, 100) || value.artifact !== `opentriage-${value.versionName}-${value.versionCode}-${value.apkSha256}.apk` || compatibility?.pairingArtifact !== 1 || compatibility.protectedReportSchema !== 1 || compatibility.recoveryEnvelope !== 1 || !isAndroidApiProtocolCompatible(compatibility.api, compatibility.api?.minimum) || compatibility.requiredCapabilities !== void 0 && (!Array.isArray(compatibility.requiredCapabilities) || compatibility.requiredCapabilities.length > 32 || compatibility.requiredCapabilities.some((capability) => typeof capability !== "string" || !/^[a-z][a-z0-9-]{0,79}$/.test(capability)) || new Set(compatibility.requiredCapabilities).size !== compatibility.requiredCapabilities.length)) {
    throw new Error("Invalid Android release descriptor");
  }
  return {
    schemaVersion: 1,
    applicationId: value.applicationId,
    versionCode: value.versionCode,
    versionName: value.versionName,
    certificateSha256: value.certificateSha256,
    apkSha256: value.apkSha256,
    apkBytes: value.apkBytes,
    uiSha256: value.uiSha256,
    sourceCommit: value.sourceCommit,
    compatibility: {
      pairingArtifact: 1,
      protectedReportSchema: 1,
      recoveryEnvelope: 1,
      api: { minimum: compatibility.api.minimum, maximum: compatibility.api.maximum },
      ...compatibility.requiredCapabilities ? { requiredCapabilities: [...compatibility.requiredCapabilities] } : {}
    },
    minAndroidApi: value.minAndroidApi,
    targetAndroidApi: value.targetAndroidApi,
    artifact: value.artifact
  };
}
function isAndroidReleaseCompatible(descriptor, serverProtocol, serverCapabilities = []) {
  const compatibility = descriptor?.compatibility;
  const required = compatibility?.requiredCapabilities === void 0 ? [] : compatibility.requiredCapabilities;
  return compatibility?.pairingArtifact === 1 && compatibility.protectedReportSchema === 1 && compatibility.recoveryEnvelope === 1 && Array.isArray(required) && required.length <= 32 && required.every((capability) => typeof capability === "string" && /^[a-z][a-z0-9-]{0,79}$/.test(capability)) && new Set(required).size === required.length && Array.isArray(serverCapabilities) && serverCapabilities.every((capability) => typeof capability === "string") && isAndroidApiProtocolCompatible(compatibility.api, serverProtocol) && required.every((capability) => serverCapabilities.includes(capability));
}
function approvedAndroidReleaseUrl(tag, descriptor) {
  if (![`android-v${descriptor.versionCode}-${descriptor.versionName}`, `android-candidate-${descriptor.versionCode}-${descriptor.versionName}`].includes(tag)) {
    throw new Error("Android release tag does not match its descriptor");
  }
  return `https://github.com/open-triage/open-triage-epcr/releases/download/${tag}/${descriptor.artifact}`;
}
export {
  approvedAndroidReleaseUrl,
  isAndroidReleaseCompatible,
  parseAndroidReleaseDescriptor
};
