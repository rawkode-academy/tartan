// Builds the repository-config evaluator (`tools/cue-wasm`):
//
//   deno task build:cue [--out <dir>]
//
// 1. `go build` for js/wasm, without cgo;
// 2. declares the module's maximum memory (`REPO_CONFIG_LIMITS.memoryKiB`): Go's
//    linker leaves it open, and the cap is what turns runaway evaluation
//    into a Go out-of-memory fatal;
// 3. writes the gzipped module, the toolchain's `wasm_exec.js` (its glue) and the
//    build's id to
//    `web/public`, so every Vite build copies them to the static assets (it
//    empties `web/dist`, and `wrangler deploy` runs one), under the paths the
//    Worker reads them from. They are never committed.
//
// The Go toolchain is the one `tools/cue-wasm/go.mod` names: its standard library
// shapes exported values, so a deploy runs what the corpus compared.
//
// Deploy tooling only; runtime code never imports it.

import * as path from "node:path";
import {
	CUE_WASM_BUILD_ASSET,
	CUE_WASM_GLUE_ASSET,
	CUE_WASM_MODULE_ASSET,
	REPO_CONFIG_LIMITS,
} from "@tartan/contract";

const WASM_PAGE_KIB = 64;
const MEMORY_SECTION = 5;

const uleb = (value: number): number[] => {
	const out: number[] = [];
	let rest = value;
	do {
		const byte = rest & 0x7f;
		rest = Math.floor(rest / 128);
		out.push(rest > 0 ? byte | 0x80 : byte);
	} while (rest > 0);
	return out;
};

const readUleb = (
	bytes: Uint8Array,
	start: number,
): { readonly value: number; readonly next: number } => {
	let value = 0;
	let scale = 1;
	let i = start;
	for (;;) {
		const byte = bytes[i++];
		value += (byte & 0x7f) * scale;
		scale *= 128;
		if ((byte & 0x80) === 0) return { value, next: i };
	}
};

/** `bytes` with its one memory's maximum set to `maxPages`. */
export const capWasmMemory = (
	bytes: Uint8Array,
	maxPages: number,
): Uint8Array => {
	const chunks: Uint8Array[] = [bytes.subarray(0, 8)];
	let found = false;
	let i = 8;
	while (i < bytes.length) {
		const id = bytes[i];
		const size = readUleb(bytes, i + 1);
		const end = size.next + size.value;
		if (id !== MEMORY_SECTION) {
			chunks.push(bytes.subarray(i, end));
			i = end;
			continue;
		}
		const count = readUleb(bytes, size.next);
		const flags = bytes[count.next];
		if (count.value !== 1 || flags !== 0) {
			throw new Error(
				`expected one memory without a maximum (${count.value}, flags ${flags})`,
			);
		}
		const min = readUleb(bytes, count.next + 1);
		if (min.value > maxPages) {
			throw new Error(`initial ${min.value} pages exceed ${maxPages}`);
		}
		const body = [1, 1, ...uleb(min.value), ...uleb(maxPages)];
		chunks.push(new Uint8Array([id, ...uleb(body.length), ...body]));
		found = true;
		i = end;
	}
	if (!found) throw new Error("no memory section");
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const chunk of chunks) {
		out.set(chunk, at);
		at += chunk.length;
	}
	return out;
};

export const CUE_WASM_MAX_PAGES = Math.floor(
	REPO_CONFIG_LIMITS.memoryKiB / WASM_PAGE_KIB,
);

const gzip = async (bytes: Uint8Array): Promise<Uint8Array> =>
	new Uint8Array(
		await new Response(
			new Blob([bytes as BlobPart]).stream().pipeThrough(
				new CompressionStream("gzip"),
			),
		).arrayBuffer(),
	);

const run = async (
	args: string[],
	options: { cwd: string; env?: Record<string, string> },
): Promise<string> => {
	const out = await new Deno.Command("go", {
		args,
		cwd: options.cwd,
		env: options.env,
		stdout: "piped",
		stderr: "inherit",
	}).output();
	if (!out.success) throw new Error(`go ${args[0]} failed (exit ${out.code})`);
	return new TextDecoder().decode(out.stdout).trim();
};

/** The `toolchain` line of a go.mod. */
export const goToolchainOf = (goMod: string): string => {
	const found = /^toolchain (go\d+\.\d+\.\d+)$/m.exec(goMod)?.[1];
	if (found === undefined) throw new Error("go.mod names no toolchain");
	return found;
};

const sha256 = async (parts: readonly Uint8Array[]): Promise<string> => {
	const whole = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		whole.set(part, at);
		at += part.length;
	}
	return [...new Uint8Array(await crypto.subtle.digest("SHA-256", whole))]
		.map((b) => b.toString(16).padStart(2, "0")).join("");
};

const main = async () => {
	const root = path.resolve(import.meta.dirname!, "..");
	const flag = Deno.args.indexOf("--out");
	const out = flag === -1
		? path.join(root, "web", "public")
		: path.resolve(Deno.args[flag + 1]);
	const source = path.join(root, "tools", "cue-wasm");
	const temp = await Deno.makeTempDir({ prefix: "tartan-cue-wasm-" });
	try {
		const GOTOOLCHAIN = goToolchainOf(
			await Deno.readTextFile(path.join(source, "go.mod")),
		);
		const built = path.join(temp, "cue.wasm");
		await run(["build", "-trimpath", "-ldflags=-s -w", "-o", built, "."], {
			cwd: source,
			env: { CGO_ENABLED: "0", GOOS: "js", GOARCH: "wasm", GOTOOLCHAIN },
		});
		const capped = capWasmMemory(
			await Deno.readFile(built),
			CUE_WASM_MAX_PAGES,
		);
		const goroot = await run(["env", "GOROOT"], {
			cwd: source,
			env: { GOTOOLCHAIN },
		});
		const glue = await Deno.readFile(
			path.join(goroot, "lib", "wasm", "wasm_exec.js"),
		);
		const write = async (asset: string, bytes: Uint8Array) => {
			const target = path.join(out, asset);
			await Deno.mkdir(path.dirname(target), { recursive: true });
			await Deno.writeFile(target, bytes);
			console.log(`${path.relative(root, target)}: ${bytes.length} bytes`);
		};
		await write(CUE_WASM_MODULE_ASSET, await gzip(capped));
		await write(CUE_WASM_GLUE_ASSET, glue);
		await write(
			CUE_WASM_BUILD_ASSET,
			new TextEncoder().encode(`${await sha256([capped, glue])}\n`),
		);
	} finally {
		await Deno.remove(temp, { recursive: true });
	}
};

if (import.meta.main) await main();
