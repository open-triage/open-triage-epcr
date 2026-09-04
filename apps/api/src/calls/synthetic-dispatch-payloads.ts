import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixturePaths = Array.from({ length: 10 }, (_, index) => resolve(
  __dirname,
  `../../../../packages/contracts/examples/dispatch/synthetic-assignment-${String(index + 1).padStart(2, "0")}.json`,
));

const fixtures = fixturePaths.map((path) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);

export const SYNTHETIC_DISPATCH_PAYLOAD_COUNT = fixtures.length;

/** Selects an independent copy so assignment-specific identities never mutate the fixture. */
export function randomSyntheticDispatchPayload(random: () => number = Math.random): Record<string, unknown> {
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError("Synthetic dispatch random source must return a value from 0 up to, but not including, 1");
  }
  return structuredClone(fixtures[Math.floor(sample * fixtures.length)]!);
}

export function syntheticDispatchPayloads(): ReadonlyArray<Record<string, unknown>> {
  return fixtures.map((fixture) => structuredClone(fixture));
}
