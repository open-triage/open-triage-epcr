export function evaluateScaleThreshold(policy, profile, name, observed, comparator, evidence) {
  if (!Object.hasOwn(policy.profiles, profile)) throw new Error(`unknown scale-test profile: ${profile}`);
  const productionThreshold = policy.thresholds[name];
  const threshold = profile === "ci" ? policy.ciThresholds?.[name] ?? productionThreshold : productionThreshold;
  const passed = comparator === "max" ? observed <= threshold : observed >= threshold;
  return { name, status: passed ? "pass" : "fail", observed, comparator, threshold,
    productionThreshold, thresholdProfile: profile, evidence,
    followUp: passed ? null : `Investigate ${name}; the approved ${profile} target remains unchanged.` };
}
