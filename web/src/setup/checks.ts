import type { EnvironmentCheck } from "@tartan/contract/api.ts";

/** Every required (non-optional) check passed. */
export const requiredChecksPass = (
	checks: readonly EnvironmentCheck[],
): boolean => checks.length > 0 && checks.every((c) => c.ok || c.optional);
