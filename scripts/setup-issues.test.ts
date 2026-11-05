import { deepStrictEqual, equal, match, ok, rejects } from "node:assert/strict";
import { checkBundle } from "../src/kernel/exthost/api/packages.ts";
import {
	main,
	parseOptions,
	type SetupIo,
	setupIssues,
} from "./setup-issues.ts";

const TOKEN = `tpat_${"a".repeat(43)}`;
const OPTIONS = {
	origin: "https://forge.test",
	node: "acme/platform/repo",
	bundle: "generated/publish.json",
};

const BODY = {
	manifest: {
		schema: 1,
		id: "rawkode.issues",
		name: "Issues",
		version: "0.2.0",
		api: "tartan:ext@0.1.0",
		runtime: "wasm",
		entry: { js: "ext.js", wasm: ["ext.core.wasm"] },
		storage: { scope: "repo" },
		permissions: {},
	},
	files: {
		"ext.js": btoa("export default {}"),
		// Empty valid core module: no imports, matching imports.json.
		"ext.core.wasm": "AGFzbQEAAAA=",
		"imports.json": btoa("[]"),
	},
};
const HASH = checkBundle(BODY).sha256;

type Installation = {
	id: string;
	extId: string;
	version: string;
	nodePath: string;
	mode: string;
	storageScope: string;
	grants: Record<string, unknown>;
};

const installation = (overrides: Partial<Installation> = {}): Installation => ({
	id: "i_example",
	extId: "rawkode.issues",
	version: "0.2.0",
	nodePath: OPTIONS.node,
	mode: "enforce",
	storageScope: "repo",
	grants: { repo: "none" },
	...overrides,
});

const json = (value: unknown, status = 200): Response =>
	new Response(JSON.stringify(value), {
		status,
		headers: { "content-type": "application/json" },
	});

const fakeForge = () => {
	let packages: Array<
		{ extId: string; version: string; runtime: string; sha256: string }
	> = [];
	let installations: Installation[] = [];
	let publishRace = false;
	let publishRaceHash = HASH;
	let installRace = false;
	let oldServer = false;
	let corruptReply = false;
	const calls: { method: string; path: string; payload: unknown }[] = [];
	const fetchFake: typeof fetch = async (input, init) => {
		await Promise.resolve();
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		const payload = typeof init?.body === "string"
			? JSON.parse(init.body)
			: undefined;
		calls.push({ method, path: `${url.pathname}${url.search}`, payload });
		equal(url.origin, OPTIONS.origin);
		equal(new Headers(init?.headers).get("authorization"), `Bearer ${TOKEN}`);
		equal(init?.redirect, "manual");
		equal(init?.credentials, "omit");
		if (url.pathname === "/-/api/installations" && method === "GET") {
			return json({
				node: { path: OPTIONS.node },
				installations: installations
					.filter((i) =>
						i.mode !== "disabled" &&
						(OPTIONS.node === i.nodePath ||
							OPTIONS.node.startsWith(`${i.nodePath}/`))
					)
					.map((i) => ({ installation: i })),
			});
		}
		if (url.pathname === "/-/api/packages/rawkode.issues" && method === "GET") {
			return packages.length === 0 ? json({}, 404) : json({ packages });
		}
		if (url.pathname === "/-/api/packages" && method === "PUT") {
			deepStrictEqual(payload, BODY);
			packages.push({
				extId: "rawkode.issues",
				version: "0.2.0",
				runtime: "wasm",
				sha256: publishRaceHash,
			});
			return json({}, publishRace ? 409 : 201);
		}
		if (url.pathname === "/-/api/installations" && method === "POST") {
			deepStrictEqual(payload, {
				extId: "rawkode.issues",
				version: "0.2.0",
				node: OPTIONS.node,
				mode: "enforce",
				ensure: true,
			});
			if (oldServer) return json({}, 400);
			if (installRace) {
				installRace = false;
				installations.push(installation());
				return json({}, 409);
			}
			const conflicting = installations.some((i) =>
				i.extId === "rawkode.issues" &&
				(i.mode !== "enforce" || i.version !== "0.2.0" ||
					i.nodePath.startsWith(`${OPTIONS.node}/`))
			);
			if (conflicting) return json({}, 409);
			let result = installations.find((i) => i.extId === "rawkode.issues");
			if (result === undefined) {
				result = installation();
				installations.push(result);
			}
			return json(corruptReply ? { ...result, mode: "shadow" } : result, 201);
		}
		throw new Error("unexpected request");
	};
	const io: SetupIo = {
		readTextFile: (path) => {
			equal(path, OPTIONS.bundle);
			return Promise.resolve(JSON.stringify(BODY));
		},
		readToken: () => Promise.resolve(`${TOKEN}\n`),
		fetch: fetchFake,
	};
	return {
		io,
		calls,
		setPackages: (value: typeof packages) => packages = value,
		setInstallations: (value: Installation[]) => installations = value,
		getInstallations: () => installations,
		setPublishRace: () => publishRace = true,
		setPublishRaceHash: (hash: string) => {
			publishRace = true;
			publishRaceHash = hash;
		},
		setInstallRace: () => installRace = true,
		setOldServer: () => oldServer = true,
		setCorruptReply: () => corruptReply = true,
	};
};

Deno.test("setup publishes and atomically ensures Issues; a repeat keeps the same installation", async () => {
	const f = fakeForge();
	deepStrictEqual(await setupIssues(OPTIONS, f.io), {
		published: true,
		inherited: false,
	});
	const id = f.getInstallations()[0].id;
	deepStrictEqual(await setupIssues(OPTIONS, f.io), {
		published: false,
		inherited: false,
	});
	equal(f.getInstallations().length, 1);
	equal(f.getInstallations()[0].id, id);
	equal(f.calls.filter((c) => c.method === "PUT").length, 1);
	equal(f.calls.filter((c) => c.method === "POST").length, 2);
});

Deno.test("setup reuses an inherited installation", async () => {
	const f = fakeForge();
	f.setInstallations([installation({ id: "i_inherited", nodePath: "acme" })]);
	deepStrictEqual(await setupIssues(OPTIONS, f.io), {
		published: true,
		inherited: true,
	});
	deepStrictEqual(f.getInstallations().map((i) => i.id), ["i_inherited"]);
});

Deno.test("an immutable version with different content stops before installation", async () => {
	const f = fakeForge();
	f.setPackages([{
		extId: "rawkode.issues",
		version: "0.2.0",
		runtime: "wasm",
		sha256: "0".repeat(64),
	}]);
	await rejects(setupIssues(OPTIONS, f.io), /does not match/);
	equal(f.calls.filter((c) => c.method !== "GET").length, 0);
});

Deno.test("concurrent publication and installation are safely rechecked", async () => {
	const f = fakeForge();
	f.setPublishRace();
	f.setInstallRace();
	deepStrictEqual(await setupIssues(OPTIONS, f.io), {
		published: false,
		inherited: false,
	});
	equal(f.calls.filter((c) => c.method === "POST").length, 2);
	equal(f.getInstallations().length, 1);
});

Deno.test("a concurrent publication of different bytes is refused", async () => {
	const f = fakeForge();
	f.setPublishRaceHash("f".repeat(64));
	await rejects(setupIssues(OPTIONS, f.io), /does not match/);
	equal(f.calls.filter((c) => c.method === "POST").length, 0);
});

for (
	const old of [
		installation({ mode: "disabled" }),
		installation({ mode: "shadow" }),
		installation({ version: "0.1.0" }),
		installation({ nodePath: `${OPTIONS.node}/child` }),
	]
) {
	Deno.test(`an existing conflicting installation is never replaced (${old.mode}, ${old.version}, ${old.nodePath})`, async () => {
		const f = fakeForge();
		f.setInstallations([old]);
		await rejects(setupIssues(OPTIONS, f.io), /Could not ensure/);
		deepStrictEqual(f.getInstallations(), [old]);
		ok(f.calls.every((c) => c.method !== "DELETE"));
	});
}

Deno.test("an older server that rejects ensure never receives an ordinary install", async () => {
	const f = fakeForge();
	f.setOldServer();
	await rejects(setupIssues(OPTIONS, f.io), /HTTP 400/);
	equal(f.calls.filter((c) => c.method === "POST").length, 1);
	equal(f.getInstallations().length, 0);
});

Deno.test("the ensure response must identify the expected enforcing installation", async () => {
	const f = fakeForge();
	f.setCorruptReply();
	await rejects(setupIssues(OPTIONS, f.io), /different version, mode/);
});

Deno.test("an existing installation with additional grants is refused", async () => {
	const f = fakeForge();
	const elevated = installation({ grants: { repo: "read" } });
	f.setInstallations([elevated]);
	await rejects(setupIssues(OPTIONS, f.io), /different version, mode/);
	deepStrictEqual(f.getInstallations(), [elevated]);
});

Deno.test("package, node, token and origin are validated before network access", async () => {
	for (
		const input of [
			{ ...OPTIONS, origin: "http://forge.test" },
			{ ...OPTIONS, origin: "https://user:secret@forge.test" },
			{ ...OPTIONS, origin: "https://forge.test/path" },
			{ ...OPTIONS, node: "../repo" },
		]
	) {
		const f = fakeForge();
		await rejects(setupIssues(input, f.io));
		equal(f.calls.length, 0);
	}
	const badBundle = fakeForge();
	await rejects(
		setupIssues(OPTIONS, {
			...badBundle.io,
			readTextFile: () => Promise.resolve("{}"),
		}),
		/invalid/,
	);
	equal(badBundle.calls.length, 0);
	const badToken = fakeForge();
	await rejects(
		setupIssues(OPTIONS, {
			...badToken.io,
			readToken: () => Promise.resolve("bad token"),
		}),
		/personal access token/,
	);
	equal(badToken.calls.length, 0);
	const privileged = fakeForge();
	await rejects(
		setupIssues(OPTIONS, {
			...privileged.io,
			readTextFile: () =>
				Promise.resolve(JSON.stringify({
					...BODY,
					manifest: { ...BODY.manifest, permissions: { repo: "read" } },
				})),
		}),
		/unprivileged WASM Issues/,
	);
	equal(privileged.calls.length, 0);
});

Deno.test("loopback HTTP is accepted and other untrusted URL forms are refused", async () => {
	for (
		const origin of [
			"http://localhost:3000",
			"http://127.0.0.1:3000",
			"http://[::1]:3000",
		]
	) {
		const f = fakeForge();
		let requested = false;
		await rejects(
			setupIssues({ ...OPTIONS, origin }, {
				...f.io,
				fetch: () => {
					requested = true;
					return Promise.reject(new Error("offline"));
				},
			}),
			/could not be reached/,
		);
		ok(requested);
	}
});

Deno.test("arguments and errors never print token or remote response details", async () => {
	const f = fakeForge();
	const output: string[] = [];
	const args = [
		"--origin",
		OPTIONS.origin,
		"--node",
		OPTIONS.node,
		"--bundle",
		OPTIONS.bundle,
	];
	deepStrictEqual(parseOptions(args), OPTIONS);
	deepStrictEqual(parseOptions(["--", ...args]), OPTIONS);
	await rejects(
		Promise.resolve().then(() => parseOptions(["--", "--", ...args])),
		/Usage/,
	);
	equal(
		await main(args, {
			...f.io,
			fetch: () => Promise.reject(new Error(`leaked ${TOKEN}`)),
			out: (line) => output.push(line),
			err: (line) => output.push(line),
		}),
		1,
	);
	match(output.join("\n"), /could not be reached/);
	ok(!output.join("\n").includes(TOKEN));
	output.length = 0;
	equal(
		await main(args, {
			...f.io,
			fetch: () => Promise.resolve(json({ error: TOKEN }, 403)),
			out: (line) => output.push(line),
			err: (line) => output.push(line),
		}),
		1,
	);
	match(output.join("\n"), /HTTP 403/);
	ok(!output.join("\n").includes(TOKEN));
	await rejects(
		Promise.resolve().then(() => parseOptions(["--token", TOKEN])),
		/Usage/,
	);
});
