/** Attempt every cleanup even when the device is offline; preserve the journey failure. */
export async function cleanupAndroidJourney(steps, primaryError) {
  const failures = [];
  for (const step of steps) {
    try { await step(); } catch (error) { failures.push(error); }
  }
  if (failures.length && !primaryError) throw new AggregateError(failures, 'Android journey cleanup failed');
  if (failures.length) console.error(`Android journey cleanup: ${failures.length} secondary failure(s); preserving the original failure`);
}
