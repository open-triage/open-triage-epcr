import assert from 'node:assert/strict';

/** Validate before fixture/API side effects; preserving an installed target is explicit. */
export function validateReportTargetPreparation(mode, prepareTarget) {
  assert(['clear', 'external'].includes(mode), 'Unknown report target preparation mode');
  if (mode === 'external') assert.equal(typeof prepareTarget, 'function', 'External target preparation requires an awaited fresh-state verifier');
  else assert.equal(prepareTarget, undefined, 'A target preparation hook requires explicit external mode');
}

export async function prepareReportJourneyTarget({ mode = 'clear', prepareTarget, ...context }) {
  validateReportTargetPreparation(mode, prepareTarget);
  if (mode === 'external') await prepareTarget(context);
  else await context.run(context.adb, ['-s', context.serial, 'shell', 'pm', 'clear', context.applicationId]);
}
