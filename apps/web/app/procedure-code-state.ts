/** Stable NEMSIS codes mapped to application states; display labels may be translated. */
const successCodes = { "9923001": "no", "9923003": "yes" } as const;
const outcomeCodes = { "9916001": "improved", "9916003": "unchanged", "9916005": "worse" } as const;

export const procedureNoneCode = "3907033";

export function procedureSuccessState(code: string): "no" | "yes" {
  const state = successCodes[code as keyof typeof successCodes];
  if (!state) throw new Error(`Unknown procedure success code: ${code}`);
  return state;
}

export function procedureOutcomeState(code: string): "improved" | "unchanged" | "worse" {
  const state = outcomeCodes[code as keyof typeof outcomeCodes];
  if (!state) throw new Error(`Unknown procedure outcome code: ${code}`);
  return state;
}
