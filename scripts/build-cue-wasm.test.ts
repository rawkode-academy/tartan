import { deepStrictEqual, equal, throws } from "node:assert/strict";
import {
	capWasmMemory,
	CUE_WASM_MAX_PAGES,
	goToolchainOf,
} from "./build-cue-wasm.ts";
import { REPO_CONFIG_LIMITS } from "@tartan/contract";

const HEADER = [0, 0x61, 0x73, 0x6d, 1, 0, 0, 0];
const module = (memory: number[]) =>
	new Uint8Array([...HEADER, 5, memory.length, ...memory]);

Deno.test("capWasmMemory: declares the maximum and leaves the module valid", async () => {
	const capped = capWasmMemory(module([1, 0, 2]), 300);
	deepStrictEqual([...capped.subarray(8)], [5, 5, 1, 1, 2, 0xac, 0x02]);
	const compiled = await WebAssembly.compile(capped as BufferSource);
	equal(WebAssembly.Module.imports(compiled).length, 0);
});

Deno.test("capWasmMemory: keeps the other sections and refuses what it cannot cap", () => {
	const custom = [0, 2, 1, 0x61];
	const capped = capWasmMemory(
		new Uint8Array([...HEADER, ...custom, 5, 3, 1, 0, 1, ...custom]),
		2,
	);
	deepStrictEqual(
		[...capped.subarray(8)],
		[...custom, 5, 4, 1, 1, 1, 2, ...custom],
	);
	throws(() => capWasmMemory(new Uint8Array(HEADER), 2), /no memory/);
	throws(() => capWasmMemory(module([1, 1, 1, 2]), 2), /without a maximum/);
	throws(() => capWasmMemory(module([1, 0, 3]), 2), /exceed/);
});

Deno.test("the build pins the toolchain go.mod names", async () => {
	const goMod = await Deno.readTextFile(
		new URL("../tools/cue-wasm/go.mod", import.meta.url),
	);
	equal(goToolchainOf(goMod), "go1.26.10");
	throws(() => goToolchainOf("go 1.25.0\n"), /no toolchain/);
});

Deno.test("the cap is the contract's memory limit, in whole pages", () => {
	equal(CUE_WASM_MAX_PAGES * 64, REPO_CONFIG_LIMITS.memoryKiB);
});
