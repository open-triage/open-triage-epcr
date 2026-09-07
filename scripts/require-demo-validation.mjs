import { pathToFileURL } from "node:url";

export function unsuccessfulValidationJobs(results) {
  if (results === null || typeof results !== "object" || Array.isArray(results)) {
    throw new TypeError("Validation results must be a job-result object.");
  }

  return Object.entries(results)
    .filter(([, value]) => value?.result !== "success")
    .map(([job]) => job)
    .sort();
}

export function requireSuccessfulValidations(results) {
  const unsuccessful = unsuccessfulValidationJobs(results);

  if (unsuccessful.length > 0) {
    throw new Error(`Required validation did not pass: ${unsuccessful.join(", ")}`);
  }
}

function run() {
  if (!process.env.VALIDATION_RESULTS) {
    throw new Error("VALIDATION_RESULTS is required.");
  }

  requireSuccessfulValidations(JSON.parse(process.env.VALIDATION_RESULTS));
  console.log("All required demo validation jobs passed.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
