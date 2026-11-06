// The repository-config evaluator: CUE compiled to WebAssembly
// (`tools/cue-wasm`, built by `scripts/build-cue-wasm.ts`) in a Dynamic Worker
// with no bindings and no network (ADR repo config, "The evaluator").
//
// The sandbox's queue hands over one bundle at a time. This module adds the
// job's `cue.mod/module.cue` with a module path fresh for the job, evaluates
// in a new Go instance, and packs the job's one result line, which
// `classifyCueJob` reads. An instance holds nothing after its call, so one
// repository's input never meets another's.
//
// Limits:
// - memory: the module's declared maximum (`REPO_CONFIG_LIMITS.memoryKiB`).
//   Reaching it is a Go runtime fatal, exit 2, read as `LIMIT_EXCEEDED`.
// - stack: Go on WebAssembly uses the host's call stack, whose depth the isolate
//   decides. Exhausting it is exit 2 as well, and the same answer.
// - CPU: `wallClockS` of CPU on the entrypoint. The platform ends a call that
//   exceeds it; synchronous WebAssembly cannot be stopped from inside, and the
//   Go runtime has no other thread to do so.
// - Loading comes first, without a CPU limit, so a stalled loader or a missing
//   asset is an outage and never reads as the input's own limit. Only what the
//   platform says about the evaluation call is a limit answer: results are cached,
//   and a cached failure lets lands resume. Anything else, a call that never
//   settles included, rejects, and the queue retries it as an outage.

import {
	COMPAT_DATE,
	CUE_JOB_VERSION,
	CUE_VERSION,
	CUE_WASM_BUILD_ASSET,
	CUE_WASM_GLUE_ASSET,
	CUE_WASM_MODULE_ASSET,
	type EvalLimits,
	FORGE_MODULE_PREFIX,
	forgeModuleFile,
	stripForgeModule,
} from "@tartan/contract";
import { CUE_JOB_EXIT } from "../../runs/cue.ts";

/** What one Go instance answers. */
export type CueGuestResult = {
	readonly rc: number;
	readonly cue: string;
	readonly out: string;
	readonly err: string;
};

/**
 * The guest's runtime, as module text. Go's `js/wasm` port reaches the host
 * through `globalThis.fs` and `process`. Every path answers ENOENT, so the
 * request's overlay is the guest's whole filesystem. Node's flag values let
 * Go's `syscall` open directories; nothing reads them beyond that.
 */
export const CUE_GUEST_CORE = String.raw`
const decoder = new TextDecoder();
const STDERR_MAX = 256 * 1024;
const noEntry = (...args) => {
	const error = new Error("no such file or directory");
	error.code = "ENOENT";
	args[args.length - 1](error);
};
for (const name of [
	"chmod", "chown", "fchmod", "fchown", "fstat", "fsync", "ftruncate", "lchown",
	"link", "lstat", "mkdir", "open", "readdir", "readlink", "rename", "rmdir",
	"stat", "symlink", "truncate", "unlink", "utimes",
]) globalThis.fs[name] = noEntry;
globalThis.fs.constants = {
	O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_TRUNC: 512,
	O_APPEND: 1024, O_DIRECTORY: 65536,
};
globalThis.process.cwd = () => "/m";

export const evaluateCue = async (module, input) => {
	let stderr = "";
	globalThis.fs.writeSync = (fd, bytes) => {
		if (fd === 2 && stderr.length < STDERR_MAX) stderr += decoder.decode(bytes);
		return bytes.length;
	};
	let version = "";
	let done = null;
	globalThis.__cueInput = input;
	globalThis.__cueStart = (v) => { version = v; };
	globalThis.__cueDone = (text) => { done = JSON.parse(text); };
	const go = new globalThis.Go();
	const instance = await WebAssembly.instantiate(module, go.importObject);
	try {
		await go.run(instance);
	} catch (error) {
		stderr += String(error);
		return { rc: 2, cue: version, out: "", err: stderr };
	} finally {
		delete globalThis.__cueInput;
		delete globalThis.__cueStart;
		delete globalThis.__cueDone;
	}
	return done ?? { rc: 2, cue: version, out: "", err: stderr };
};
`;

export const CUE_GUEST_ENTRYPOINT = "Evaluator";

/** The Dynamic Worker's main module. */
export const cueGuestSource = (): string =>
	`import { WorkerEntrypoint } from "cloudflare:workers";
import "./wasm_exec.js";
import cue from "./cue.wasm";
${CUE_GUEST_CORE}
export class ${CUE_GUEST_ENTRYPOINT} extends WorkerEntrypoint {
	ready() { return true; }
	async evaluate(input) { return JSON.stringify(await evaluateCue(cue, input)); }
}
export default { fetch: () => new Response(null, { status: 404 }) };
`;

const decodeBase64 = (text: string): string => {
	const binary = atob(text);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return new TextDecoder().decode(bytes);
};

const freshModulePath = (): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return `${FORGE_MODULE_PREFIX}${
		[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
	}@v0`;
};

/** The guest's input: a bundle's files, plus the job's own module file. */
export const cueGuestInput = (bundleJson: string): string => {
	const bundle = JSON.parse(bundleJson) as {
		readonly files: Readonly<Record<string, string>>;
	};
	const files: Record<string, string> = {};
	for (const [path, base64] of Object.entries(bundle.files)) {
		files[path] = decodeBase64(base64);
	}
	files["cue.mod/module.cue"] = forgeModuleFile(freshModulePath());
	return JSON.stringify({ files });
};

const headBytes = (text: string, max: number): string => {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= max) return text;
	// Back to a character boundary: a cut sequence would decode longer.
	let end = max;
	while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
	return new TextDecoder().decode(bytes.subarray(0, end));
};

/** The job's result line (`classifyCueJob`), under the request's limits. */
export const packCueResult = (
	guest: CueGuestResult,
	limits: EvalLimits,
	ms: number,
): string => {
	const outBytes = new TextEncoder().encode(guest.out).length;
	const err = stripForgeModule(guest.err);
	const rc = guest.rc === CUE_JOB_EXIT.ok &&
			outBytes >= limits.outputFileKiB * 1024
		? CUE_JOB_EXIT.fileSize
		: guest.rc;
	return JSON.stringify({
		job: CUE_JOB_VERSION,
		cue: guest.cue === "" ? null : guest.cue,
		rc,
		ms,
		out: outBytes <= limits.jsonBytes ? guest.out : "",
		outBytes,
		err: headBytes(err, limits.stderrBytes),
		errBytes: new TextEncoder().encode(err).length,
	});
};

const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** Extra time past the CPU limit before the host stops waiting. */
export const CUE_HOST_GRACE_MS = 5_000;
/** One load: three attempts of this stay inside the cold deadline of 75 s. */
export const CUE_LOAD_DEADLINE_MS = 20_000;

/** The platform's words for a call it ended; other text is never a limit. */
const CPU_LIMIT = /exceeded (?:its )?cpu time limit/i;
const MEMORY_LIMIT = /exceeded (?:its )?memory(?: limit)?/i;

export type CueGuest = {
	/** Resolves once the Dynamic Worker is loaded. */
	ready(): Promise<void>;
	evaluate(input: string, cpuMs: number): Promise<string>;
};

export type CueWasmDeps = {
	readonly guest: CueGuest;
	readonly now?: () => number;
	readonly onLoaded?: () => void;
};

const withDeadline = async <T>(
	work: Promise<T>,
	ms: number,
	what: string,
): Promise<T> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new Error(`the evaluator did not ${what} within ${ms} ms`)),
			ms,
		);
	});
	try {
		return await Promise.race([work, deadline]);
	} finally {
		clearTimeout(timer);
	}
};

/** One job: the bundle in, the result line out. Rejects on an outage. */
export const runCueWasmJob = async (
	bundleJson: string,
	limits: EvalLimits,
	deps: CueWasmDeps,
): Promise<string> => {
	const now = deps.now ?? (() => Date.now());
	await withDeadline(deps.guest.ready(), CUE_LOAD_DEADLINE_MS, "load");
	deps.onLoaded?.();
	const started = now();
	const cpuMs = Math.floor(limits.wallClockS * 1000);
	try {
		const answer = await withDeadline(
			deps.guest.evaluate(cueGuestInput(bundleJson), cpuMs),
			cpuMs + CUE_HOST_GRACE_MS,
			"answer",
		);
		return packCueResult(
			JSON.parse(answer) as CueGuestResult,
			limits,
			now() - started,
		);
	} catch (error) {
		const text = errorText(error);
		const rc = CPU_LIMIT.test(text)
			? CUE_JOB_EXIT.timeout
			: MEMORY_LIMIT.test(text)
			? CUE_JOB_EXIT.killed
			: null;
		if (rc === null) throw error;
		return packCueResult(
			{ rc, cue: CUE_VERSION, out: "", err: text },
			limits,
			now() - started,
		);
	}
};

const gunzip = async (compressed: ArrayBuffer): Promise<ArrayBuffer> =>
	await new Response(
		new Blob([compressed]).stream().pipeThrough(
			new DecompressionStream("gzip"),
		),
	).arrayBuffer();

/**
 * The module and its Go glue, as the deploy published them. The asset layer
 * answers an unknown path with the SPA's index, so the gzip magic and the glue's
 * class are checked: a deploy built without them fails as an outage.
 */
export const readCueAssets = async (
	assets: Pick<Fetcher, "fetch">,
): Promise<{ readonly wasm: ArrayBuffer; readonly glue: string }> => {
	const read = async (path: string) => {
		const response = await assets.fetch(`https://assets.local${path}`);
		if (!response.ok) throw new Error(`${path}: ${response.status}`);
		return response;
	};
	const compressed = await (await read(CUE_WASM_MODULE_ASSET)).arrayBuffer();
	const magic = new Uint8Array(compressed.slice(0, 2));
	if (magic[0] !== 0x1f || magic[1] !== 0x8b) {
		throw new Error(`${CUE_WASM_MODULE_ASSET} is not in this deployment`);
	}
	const glue = await (await read(CUE_WASM_GLUE_ASSET)).text();
	if (!glue.includes("globalThis.Go")) {
		throw new Error(`${CUE_WASM_GLUE_ASSET} is not in this deployment`);
	}
	return { wasm: await gunzip(compressed), glue };
};

/** The published build's id; the asset layer's fallback page is a missing asset. */
export const readCueBuildId = async (
	assets: Pick<Fetcher, "fetch">,
): Promise<string> => {
	const response = await assets.fetch(
		`https://assets.local${CUE_WASM_BUILD_ASSET}`,
	);
	const id = response.ok ? (await response.text()).trim() : "";
	if (!/^[0-9a-f]{64}$/.test(id)) {
		throw new Error(`${CUE_WASM_BUILD_ASSET} is not in this deployment`);
	}
	return id;
};

const digestOf = async (text: string): Promise<string> =>
	[
		...new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
		),
	].map((b) => b.toString(16).padStart(2, "0")).join("");

type CueGuestStub = {
	ready(): Promise<unknown>;
	evaluate(input: string): Promise<string>;
};

/**
 * The guest of one sandbox. A sandbox runs one job at a time, so its own loader
 * id means one isolate holds one instance. The platform requires the same code
 * for the same id, so the id names the module's build and this guest's source.
 */
export const createCueGuest = (deps: {
	readonly loader: WorkerLoader;
	readonly assets: Pick<Fetcher, "fetch">;
	readonly evaluator: string;
	readonly sandbox: string;
}): CueGuest => {
	const load = async () => {
		const source = cueGuestSource();
		const build = await digestOf(
			`${await readCueBuildId(deps.assets)}\n${source}`,
		);
		return deps.loader.get(
			`cue-eval:${deps.evaluator}:${build}:${deps.sandbox}`,
			async () => {
				const { wasm, glue } = await readCueAssets(deps.assets);
				return {
					compatibilityDate: COMPAT_DATE,
					mainModule: "guest.js",
					modules: {
						"guest.js": { js: source },
						"wasm_exec.js": { js: glue },
						"cue.wasm": { wasm },
					},
					globalOutbound: null,
					env: {},
				};
			},
		);
	};
	let worker: ReturnType<typeof load> | null = null;
	const loaded = () => worker ??= load();
	return {
		ready: async () => {
			const stub = (await loaded()).getEntrypoint(
				CUE_GUEST_ENTRYPOINT,
			) as unknown as CueGuestStub;
			await stub.ready();
		},
		evaluate: async (input, cpuMs) => {
			const stub = (await loaded()).getEntrypoint(CUE_GUEST_ENTRYPOINT, {
				limits: { cpuMs },
			}) as unknown as CueGuestStub;
			return await stub.evaluate(input);
		},
	};
};
