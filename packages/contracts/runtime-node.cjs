"use strict";
const message = "OpenTriage requires Node.js 22.12.0 or newer with CommonJS require(esm) support enabled. Remove --no-experimental-require-module from Node options.";

function validateNodeRuntime({ version, requireModule, execArgv = [], nodeOptions = "" }) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const major = Number(match?.[1]), minor = Number(match?.[2]);
  const supported = !!match && (major > 22 || (major === 22 && minor >= 12));
  const disabled = execArgv.some(value => /^--no-experimental-require[-_]module(?:=|$)/.test(value)) ||
    /(?:^|\s|["'])--no-experimental-require[-_]module(?:\s|=|$|["'])/.test(nodeOptions);
  if (!supported || requireModule === false || disabled) throw new Error(message);
}
function assertSupportedNode() {
  validateNodeRuntime({ version: process.versions.node, requireModule: process.features.require_module,
    execArgv: process.execArgv, nodeOptions: process.env.NODE_OPTIONS });
}
exports.validateNodeRuntime = validateNodeRuntime;
exports.assertSupportedNode = assertSupportedNode;
