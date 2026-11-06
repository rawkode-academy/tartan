/// <reference types="@cloudflare/vitest-pool-workers/types" />
// The evaluator on the platform (workerd): the production Dynamic Worker,
// without network or bindings, over the built module (`deno task build:cue`;
// skipped when it has not been built). workerd does not enforce CPU or isolate
// memory limits locally, so those are for a live deployment; the module's own
// memory cap is enforced here.

import {
	CUE_WASM_BUILD_ASSET,
	CUE_WASM_MODULE_ASSET,
	DEFAULT_EVAL_LIMITS,
	isEvalOk,
} from "@tartan/contract";
import { describe, expect, it } from "vitest";
import { testEnv as env, uniqueName } from "../../../../test/env.ts";
import { buildCueBundle, classifyCueJob } from "../../runs/cue.ts";
import { createCueGuest, runCueWasmJob } from "./wasm.ts";

const built = env as unknown as {
	readonly TEST_CUE_WASM_GZ?: ArrayBuffer;
	readonly TEST_CUE_GLUE?: string;
	readonly TEST_CUE_BUILD?: string;
};

const assets = {
	fetch: (url: string) =>
		Promise.resolve(
			new Response(
				url.endsWith(CUE_WASM_MODULE_ASSET)
					? built.TEST_CUE_WASM_GZ
					: url.endsWith(CUE_WASM_BUILD_ASSET)
					? built.TEST_CUE_BUILD
					: built.TEST_CUE_GLUE,
			),
		),
} as unknown as Pick<Fetcher, "fetch">;

const evaluate = async (config: string) => {
	const bundle = buildCueBundle({
		"~tartan.cue": "package tartan\n",
		"tartan.cue": `package tartan\n\n${config}\n`,
	});
	if (!bundle.ok) throw new Error(bundle.message);
	const guest = createCueGuest({
		loader: env.LOADER,
		assets,
		evaluator: "test",
		sandbox: uniqueName("cue"),
	});
	return classifyCueJob(
		await runCueWasmJob(bundle.json, DEFAULT_EVAL_LIMITS, { guest }),
	);
};

describe.skipIf(built.TEST_CUE_WASM_GZ === undefined)("cue on workerd", () => {
	it("exports a value", async () => {
		const r = await evaluate('global: ["a"]');
		expect(isEvalOk(r) && r.ok).toEqual({ global: ["a"] });
	}, 60_000);

	it("reports positioned CUE errors", async () => {
		const r = await evaluate("global: 1\nglobal: 2");
		expect(!isEvalOk(r) && r.error.code).toBe("BUILD_VALUE");
		expect(r.issues[0]?.pos).toContain("tartan.cue:3:9");
	}, 60_000);

	it("refuses a registry import", async () => {
		const r = await evaluate('import "github.com/acme/x"\n');
		expect(!isEvalOk(r) && r.error.code).not.toBe("EVALUATOR_UNAVAILABLE");
	}, 60_000);

	it("refuses extreme nesting without losing the evaluator", async () => {
		const depth = 50_000;
		const r = await evaluate(
			`x: ${"{a: ".repeat(depth)}1${"}".repeat(depth)}`,
		);
		expect(!isEvalOk(r) && r.error.code).toMatch(
			/^(LOAD_INSTANCE|LIMIT_EXCEEDED)$/,
		);
		const after = await evaluate('global: ["a"]');
		expect(isEvalOk(after)).toBe(true);
	}, 60_000);

	it("a runaway stops at the module's memory cap", async () => {
		const doubled = Array.from(
			{ length: 30 },
			(_, i) => `_s${i + 1}: _s${i} + _s${i}`,
		).join("\n");
		const r = await evaluate(
			`_s0: "xxxxxxxxxxxxxxxx"\n${doubled}\nglobal: [_s30]`,
		);
		expect(!isEvalOk(r) && r.error.code).toBe("LIMIT_EXCEEDED");
	}, 60_000);
});
