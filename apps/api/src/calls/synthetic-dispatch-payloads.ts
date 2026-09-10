import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const fixturePaths = Array.from({ length: 10 }, (_, index) => resolve(
  __dirname,
  `../../../../packages/contracts/examples/dispatch/synthetic-assignment-${String(index + 1).padStart(2, "0")}.json`,
));

export const SYNTHETIC_DISPATCH_PAYLOAD_COUNT = fixturePaths.length;

// Loaded lazily (and cached) on first use rather than at module scope, so importing this
// module does not require `packages/contracts/examples/` to exist on disk. That directory
// is source-tree-only and is not shipped in containers that deploy just `dist/`; reading it
// eagerly at module load would crash API startup for any request path that never touches
// the synthetic-dispatch-payload feature.
let cachedFixtures: ReadonlyArray<Record<string, unknown>> | undefined;

function loadFixtures(): ReadonlyArray<Record<string, unknown>> {
  cachedFixtures ??= fixturePaths.map((path) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
  return cachedFixtures;
}

/** Selects an independent copy so assignment-specific identities never mutate the fixture. */
export function randomSyntheticDispatchPayload(random: () => number = Math.random): Record<string, unknown> {
  const fixtures = loadFixtures();
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RangeError("Synthetic dispatch random source must return a value from 0 up to, but not including, 1");
  }
  return structuredClone(fixtures[Math.floor(sample * fixtures.length)]!);
}

export function syntheticDispatchPayloads(): ReadonlyArray<Record<string, unknown>> {
  return loadFixtures().map((fixture) => structuredClone(fixture));
}
