// The setup wizard's environment check (WP2): one
// ✓/✗ per platform feature with a fix hint, all PRE-claim. The lane-repo
// self-test is not here: it runs after the claim through WP5b's route. The
// origin check needs the request's origin, so the route adds
// it (`originCheck`).

import { COMPAT_DATE, type EnvironmentCheck } from "@tartan/contract";
import type { Env } from "../../env.ts";

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
	});
	return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
};

const message = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

type Probe = {
	readonly id: EnvironmentCheck["id"];
	readonly optional: boolean;
	readonly timeoutMs: number;
	readonly ok: string;
	readonly hint: string;
	readonly run: () => Promise<void>;
};

const check = async (p: Probe): Promise<EnvironmentCheck> => {
	try {
		await withTimeout(p.run(), p.timeoutMs);
		return {
			id: p.id,
			phase: "setup",
			ok: true,
			optional: p.optional,
			message: p.ok,
		};
	} catch (error) {
		return {
			id: p.id,
			phase: "setup",
			ok: false,
			optional: p.optional,
			message: message(error).slice(0, 300),
			hint: p.hint,
		};
	}
};

export const runEnvironmentChecks = (
	env: Env,
	scratchKey: string,
): Promise<EnvironmentCheck[]> =>
	Promise.all([
		check({
			id: "artifacts",
			optional: false,
			timeoutMs: 10_000,
			ok: "Artifacts answers",
			hint:
				"Artifacts may still be gated on this account: request access, then rerun the check",
			run: async () => {
				await env.ARTIFACTS.list({ limit: 1 });
			},
		}),
		check({
			id: "loader",
			optional: false,
			timeoutMs: 10_000,
			ok: "Dynamic Workers load and answer",
			hint:
				"Dynamic Workers (Worker Loader) are needed for uploaded extensions; builtins still work without them",
			run: async () => {
				const worker = env.LOADER.get("tartan-selftest@1", () => ({
					compatibilityDate: COMPAT_DATE,
					mainModule: "selftest.js",
					modules: {
						"selftest.js":
							"export default { fetch() { return new Response('ok'); } };",
					},
					globalOutbound: null,
				}));
				const response = await worker.getEntrypoint().fetch(
					"https://selftest.invalid/",
				);
				const text = await response.text();
				if (text !== "ok") {
					throw new Error(`unexpected answer: ${text.slice(0, 40)}`);
				}
			},
		}),
		check({
			id: "r2",
			optional: false,
			timeoutMs: 10_000,
			ok: "R2 stores and reads back",
			hint: "check the BLOBS bucket binding of this Worker",
			run: async () => {
				const key = `selftest/${scratchKey}`;
				await env.BLOBS.put(key, "ok");
				const object = await env.BLOBS.get(key);
				const text = await object?.text();
				await env.BLOBS.delete(key);
				if (text !== "ok") throw new Error("R2 read back something else");
			},
		}),
	]);

/** Environment check: warns on `*.workers.dev` (redirect URI and capability URLs use this origin). */
export const originCheck = (origin: string): EnvironmentCheck => {
	const host = new URL(origin).hostname;
	const workersDev = host.endsWith(".workers.dev");
	return {
		id: "origin",
		phase: "setup",
		ok: !workersDev,
		optional: true,
		message: `this forge answers on ${host}`,
		...(workersDev
			? {
				hint:
					"attach your custom domain first: the OIDC redirect URI and the lane capability URLs use this origin",
			}
			: {}),
	};
};
