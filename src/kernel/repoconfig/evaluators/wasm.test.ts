// The WebAssembly evaluator: the result line it packs, and every corpus case
// against the official CLI of the same release (`CUE_WASM_DIR` holds the
// `deno task build:cue` output, `CUE_BIN` is cue v0.17.1; the comparison skips
// without them). The guest runs in a Deno Worker, with the runtime text the
// Dynamic Worker uses.

import { deepStrictEqual, equal, match, ok, rejects } from "node:assert/strict";
import {
	CUE_JOB_VERSION,
	CUE_VERSION,
	CUE_WASM_GLUE_ASSET,
	CUE_WASM_MODULE_ASSET,
	DEFAULT_EVAL_LIMITS,
	type EvalResponse,
	isEvalOk,
	REPO_CONFIG_LIMITS,
} from "@tartan/contract";
import { buildCueBundle, classifyCueJob } from "../../runs/cue.ts";
import { caseRequest, CASES, cueBin } from "../testing/corpus.ts";
import { createCliEvaluator } from "./cli.ts";
import {
	CUE_GUEST_CORE,
	CUE_LOAD_DEADLINE_MS,
	type CueGuest,
	cueGuestInput,
	packCueResult,
	readCueAssets,
	readCueBuildId,
	runCueWasmJob,
} from "./wasm.ts";

const LIMITS = DEFAULT_EVAL_LIMITS;
const bundleOf = (files: Record<string, string>) => {
	const b = buildCueBundle(files);
	if (!b.ok) throw new Error(b.message);
	return b.json;
};
const BUNDLE = bundleOf({ "~tartan.cue": "package tartan\n", "a.cue": "é" });

const answer = (over: Record<string, unknown> = {}) =>
	JSON.stringify({ rc: 0, cue: CUE_VERSION, out: "{}\n", err: "", ...over });

Deno.test("cueGuestInput: decodes the bundle and adds a module file fresh for the job", () => {
	const read = () =>
		(JSON.parse(cueGuestInput(BUNDLE)) as {
			files: Record<string, string>;
		}).files;
	const first = read();
	equal(first["a.cue"], "é");
	match(first["cue.mod/module.cue"], /tartan\.local\/j[0-9a-f]{32}@v0/);
	ok(first["cue.mod/module.cue"] !== read()["cue.mod/module.cue"]);
});

Deno.test("packCueResult: the classifier reads a value, CUE errors and each limit", () => {
	const classify = (line: string): EvalResponse => classifyCueJob(line);
	const value = classify(
		packCueResult(
			{ rc: 0, cue: CUE_VERSION, out: '{"a":1}', err: "" },
			LIMITS,
			7,
		),
	);
	ok(isEvalOk(value));
	deepStrictEqual(value.ok, { a: 1 });
	equal(value.ms, 7);
	const line = JSON.parse(
		packCueResult({ rc: 0, cue: CUE_VERSION, out: "{}", err: "" }, LIMITS, 0),
	);
	equal(line.job, CUE_JOB_VERSION);
	const codeOf = (guest: Parameters<typeof packCueResult>[0]) => {
		const r = classify(packCueResult(guest, LIMITS, 0));
		return isEvalOk(r) ? "ok" : r.error.code;
	};
	const base = { cue: CUE_VERSION, out: "", err: "" };
	equal(
		codeOf({
			...base,
			rc: 1,
			err: "x: conflicting values:\n    ./a.cue:1:2\n",
		}),
		"BUILD_VALUE",
	);
	equal(
		codeOf({ ...base, rc: 2, err: "fatal error: out of memory" }),
		"LIMIT_EXCEEDED",
	);
	equal(
		codeOf({
			...base,
			rc: 2,
			err: "RangeError: Maximum call stack size exceeded",
		}),
		"LIMIT_EXCEEDED",
	);
	equal(codeOf({ ...base, rc: 2, err: "fatal error: boom" }), "INTERNAL");
	equal(
		codeOf({ ...base, rc: 0, out: `"${"x".repeat(LIMITS.jsonBytes)}"` }),
		"LIMIT_EXCEEDED",
	);
	equal(
		codeOf({
			...base,
			rc: 0,
			out: "x".repeat(LIMITS.outputFileKiB * 1024),
		}),
		"LIMIT_EXCEEDED",
	);
	equal(codeOf({ ...base, cue: "v0.0.0", rc: 0, out: "{}" }), "INTERNAL");
});

Deno.test("packCueResult: error text is capped in bytes and the job's module path is gone", () => {
	const line = JSON.parse(packCueResult(
		{
			rc: 1,
			cue: CUE_VERSION,
			out: "",
			err: `tartan.local/j${"0".repeat(32)}@v0 ${
				"é".repeat(LIMITS.stderrBytes)
			}`,
		},
		LIMITS,
		0,
	));
	ok(line.err.startsWith("<module> "));
	ok(new TextEncoder().encode(line.err).length <= LIMITS.stderrBytes);
	ok(line.errBytes > LIMITS.stderrBytes);
});

const guestOf = (evaluate: CueGuest["evaluate"]): CueGuest => ({
	ready: () => Promise.resolve(),
	evaluate,
});

Deno.test("runCueWasmJob: the platform's limits on the evaluation are limit answers; anything else is an outage", async () => {
	const failing = (message: string) =>
		guestOf(() => Promise.reject(new Error(message)));
	const code = async (guest: CueGuest) => {
		const r = classifyCueJob(await runCueWasmJob(BUNDLE, LIMITS, { guest }));
		return isEvalOk(r) ? "ok" : r.error.code;
	};
	equal(await code(guestOf(() => Promise.resolve(answer()))), "ok");
	equal(await code(failing("Worker exceeded CPU time limit.")), "TIMEOUT");
	equal(await code(failing("Worker exceeded memory limit.")), "LIMIT_EXCEEDED");
	for (
		const text of [
			"loader failed",
			"CompileError: out of memory",
			"cpuMs is not supported",
		]
	) {
		await rejects(
			runCueWasmJob(BUNDLE, LIMITS, { guest: failing(text) }),
			new RegExp(text),
		);
	}
});

Deno.test("runCueWasmJob: a failed load is an outage and never starts the evaluation, whatever its text", async () => {
	let evaluated = 0;
	let loaded = 0;
	await rejects(
		runCueWasmJob(BUNDLE, LIMITS, {
			guest: {
				ready: () =>
					Promise.reject(new Error("Worker exceeded CPU time limit.")),
				evaluate: () => {
					evaluated++;
					return Promise.resolve(answer());
				},
			},
			onLoaded: () => loaded++,
		}),
		/exceeded CPU/,
	);
	equal(evaluated, 0);
	equal(loaded, 0);
});

Deno.test("runCueWasmJob: passes the CPU limit; a call that never settles is an outage", async () => {
	let cpu = -1;
	const limits = { ...LIMITS, wallClockS: 0 };
	await rejects(
		runCueWasmJob(BUNDLE, limits, {
			guest: guestOf((_input, cpuMs) => {
				cpu = cpuMs;
				return new Promise(() => {});
			}),
		}),
		/did not answer/,
	);
	equal(cpu, 0);
	ok(CUE_LOAD_DEADLINE_MS * 3 < REPO_CONFIG_LIMITS.deadlineColdMs);
});

Deno.test("readCueBuildId: a fallback page is a missing build", async () => {
	const fake = (body: string) =>
		({
			fetch: () => Promise.resolve(new Response(body)),
		}) as unknown as Pick<Fetcher, "fetch">;
	equal(await readCueBuildId(fake(`${"a".repeat(64)}\n`)), "a".repeat(64));
	await rejects(readCueBuildId(fake("<html>")), /not in this deployment/);
});

Deno.test("readCueAssets: gunzips the module; the SPA's fallback page is a missing asset", async () => {
	const gz = new Uint8Array(
		await new Response(
			new Blob(["wasm"]).stream().pipeThrough(new CompressionStream("gzip")),
		).arrayBuffer(),
	);
	const fake = (module: BodyInit, glue: string) =>
		({
			fetch: (url: string) =>
				Promise.resolve(
					new Response(url.endsWith(CUE_WASM_MODULE_ASSET) ? module : glue),
				),
		}) as unknown as Pick<Fetcher, "fetch">;
	const read = await readCueAssets(fake(gz, "globalThis.Go = class {}"));
	equal(new TextDecoder().decode(read.wasm), "wasm");
	await rejects(
		readCueAssets(fake("<html>", "<html>")),
		/not in this deployment/,
	);
	await rejects(readCueAssets(fake(gz, "<html>")), /not in this deployment/);
});

// ---------------------------------------------------------------------------
// The corpus against the CLI
// ---------------------------------------------------------------------------

const DIR = Deno.env.get("CUE_WASM_DIR") ?? null;
const BIN = cueBin();
if (DIR === null || BIN === null) {
	console.warn(
		"wasm.test.ts: CUE_WASM_DIR or CUE_BIN is not set; the corpus comparison is skipped",
	);
}

const denoGuest = (dir: string, wallMs: number): CueGuest => {
	const load = async () => {
		const gz = await Deno.readFile(`${dir}${CUE_WASM_MODULE_ASSET}`);
		const glue = await Deno.readTextFile(`${dir}${CUE_WASM_GLUE_ASSET}`);
		const wasm = await new Response(
			new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip")),
		).arrayBuffer();
		return { module: await WebAssembly.compile(wasm), glue };
	};
	const loaded = load();
	const evaluate: CueGuest["evaluate"] = async (input) => {
		const { module, glue } = await loaded;
		const source = `${glue}\n${CUE_GUEST_CORE}
self.onmessage = async ({ data }) => {
	self.postMessage(JSON.stringify(await evaluateCue(data.module, data.input)));
};`;
		const worker = new Worker(
			URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
			{ type: "module" },
		);
		try {
			return await new Promise<string>((resolve, reject) => {
				const timer = setTimeout(
					() => reject(new Error("exceeded CPU time limit")),
					wallMs,
				);
				worker.onmessage = ({ data }) => {
					clearTimeout(timer);
					resolve(data);
				};
				worker.onerror = (event) => {
					clearTimeout(timer);
					event.preventDefault();
					reject(new Error(event.message));
				};
				worker.postMessage({ module, input });
			});
		} finally {
			worker.terminate();
		}
	};
	return { ready: () => loaded.then(() => {}), evaluate };
};

/**
 * The CLI's limits differ on purpose in these: 2 GiB of address space, 10 s of
 * wall clock and a native stack, against a memory cap the module reaches first
 * and the host's call stack.
 */
const STOPPED_BY_EVALUATOR_LIMIT = new Set([
	"pathological-comprehension",
	"pathological-doubling",
]);

Deno.test({
	name:
		"the corpus: every case's envelope equals the official CLI's, other than the limit that stops a runaway",
	ignore: DIR === null || BIN === null,
	sanitizeResources: false,
	sanitizeOps: false,
	fn: async () => {
		const guest = denoGuest(DIR!, 30_000);
		const cli = createCliEvaluator({ cueBin: BIN! });
		for (const name of [...CASES, "pathological-nesting"]) {
			const request = await caseRequest(name);
			const wasm = classifyCueJob(
				await runCueWasmJob(bundleOf(request.files), request.limits, { guest }),
				{ limits: request.limits },
			);
			if (STOPPED_BY_EVALUATOR_LIMIT.has(name)) {
				ok(!isEvalOk(wasm) && wasm.error.code === "LIMIT_EXCEEDED", name);
				continue;
			}
			// CUE's parser refuses this past 10,000 levels, if the stack gets there.
			if (
				name === "pathological-nesting" && !isEvalOk(wasm) &&
				wasm.error.code === "LIMIT_EXCEEDED"
			) continue;
			const oracle = await cli.evaluate(request);
			const shape = (r: EvalResponse) =>
				isEvalOk(r)
					? { ok: JSON.stringify(r.ok), issues: r.issues }
					: { code: r.error.code, message: r.error.message, issues: r.issues };
			deepStrictEqual(shape(wasm), shape(oracle), name);
		}
	},
});
