// Prepare the Issues package after the forge has been claimed.
//
// The operator supplies an admin personal access token on stdin, never in the
// arguments. Package and installation readback makes repeated runs safe.

import { NodePathSchema, TOKEN_RE } from "@tartan/contract";
import { checkBundle } from "../src/kernel/exthost/api/packages.ts";

const ISSUES_ID = "rawkode.issues";
const USAGE =
	"Usage: deno run -A scripts/setup-issues.ts --origin <https-origin> --node <namespace-or-repo> --bundle <publish.json>\n" +
	"Pipe a forge-admin personal access token to stdin.";

class SetupError extends Error {}

export type SetupOptions = {
	readonly origin: string;
	readonly node: string;
	readonly bundle: string;
};

export type SetupIo = {
	readonly readTextFile: (path: string) => Promise<string>;
	readonly readToken: () => Promise<string>;
	readonly fetch: typeof fetch;
};

export type SetupResult = {
	readonly published: boolean;
	readonly inherited: boolean;
};

type Installation = {
	readonly id: string;
	readonly extId: string;
	readonly version: string;
	readonly nodePath: string;
	readonly mode: string;
	readonly storageScope: string;
	readonly runtimeOverride?: string;
	readonly grants: Record<string, unknown>;
};

type InstallationView = {
	readonly effective: readonly Installation[];
};

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const unprivileged = (permissions: Record<string, unknown>): boolean =>
	Object.entries(permissions).every(([name, value]) =>
		name === "repo" && value === "none"
	);

export const parseOptions = (args: readonly string[]): SetupOptions => {
	const values = new Map<string, string>();
	const flags = args[0] === "--" ? args.slice(1) : args;
	for (let i = 0; i < flags.length; i++) {
		const name = flags[i];
		if (
			!(["--origin", "--node", "--bundle"] as string[]).includes(name) ||
			values.has(name) || flags[i + 1] === undefined ||
			flags[i + 1].startsWith("--")
		) throw new SetupError(USAGE);
		values.set(name, flags[++i]);
	}
	const origin = values.get("--origin");
	const node = values.get("--node");
	const bundle = values.get("--bundle");
	if (!origin || !node || !bundle) throw new SetupError(USAGE);
	return { origin, node, bundle };
};

const checkedOrigin = (input: string): string => {
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		throw new SetupError("The origin must be an HTTPS origin.");
	}
	const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
	if (
		(url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
		url.username !== "" || url.password !== "" || url.pathname !== "/" ||
		url.search !== "" || url.hash !== ""
	) {
		throw new SetupError(
			"The origin must be an HTTPS origin (HTTP is allowed only on loopback).",
		);
	}
	return url.origin;
};

const readInstallation = (value: unknown, node: string): Installation => {
	if (
		!record(value) || typeof value.id !== "string" || value.id === "" ||
		typeof value.extId !== "string" || typeof value.version !== "string" ||
		typeof value.nodePath !== "string" ||
		!NodePathSchema.safeParse(value.nodePath).success ||
		!(node === value.nodePath || node.startsWith(`${value.nodePath}/`)) ||
		!["enforce", "shadow", "disabled"].includes(String(value.mode)) ||
		!["repo", "node"].includes(String(value.storageScope)) ||
		!record(value.grants) ||
		(value.runtimeOverride !== undefined &&
			!["builtin", "js", "wasm"].includes(String(value.runtimeOverride)))
	) throw new SetupError("The forge returned an invalid installation view.");
	return value as Installation;
};

const assertCompatible = (
	installation: Installation,
	version: string,
): void => {
	if (
		installation.extId !== ISSUES_ID || installation.mode !== "enforce" ||
		installation.version !== version || installation.storageScope !== "repo" ||
		!unprivileged(installation.grants) ||
		(installation.runtimeOverride !== undefined &&
			installation.runtimeOverride !== "wasm")
	) {
		throw new SetupError(
			"The Issues installation has a different version, mode, scope or grants; inspect it before continuing.",
		);
	}
};

export const setupIssues = async (
	options: SetupOptions,
	io: SetupIo,
): Promise<SetupResult> => {
	const origin = checkedOrigin(options.origin);
	if (!NodePathSchema.safeParse(options.node).success) {
		throw new SetupError("The node must be a namespace or repository path.");
	}
	let body: unknown;
	try {
		body = JSON.parse(await io.readTextFile(options.bundle));
	} catch {
		throw new SetupError("Could not read the local Issues package.");
	}
	let bundle: ReturnType<typeof checkBundle>;
	try {
		bundle = checkBundle(body);
	} catch {
		throw new SetupError("The local Issues package is invalid.");
	}
	const manifest = bundle.manifest;
	if (
		manifest.id !== ISSUES_ID || manifest.kind !== "extension" ||
		manifest.runtime !== "wasm" ||
		manifest.storage.scope !== "repo" ||
		!unprivileged(manifest.permissions)
	) {
		throw new SetupError(
			"The local package is not the expected unprivileged WASM Issues package.",
		);
	}

	let token: string;
	try {
		token = (await io.readToken()).trim();
	} catch {
		throw new SetupError("Could not read the admin token from stdin.");
	}
	if (!TOKEN_RE.test(token) || !token.startsWith("tpat_")) {
		throw new SetupError(
			"Stdin must contain a forge-admin personal access token.",
		);
	}

	const request = async (
		method: "GET" | "PUT" | "POST",
		path: string,
		payload?: unknown,
	): Promise<Response> => {
		try {
			return await io.fetch(new URL(path, origin), {
				method,
				redirect: "manual",
				credentials: "omit",
				headers: {
					authorization: `Bearer ${token}`,
					...(payload === undefined
						? {}
						: { "content-type": "application/json" }),
				},
				...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
			});
		} catch {
			throw new SetupError("The forge could not be reached.");
		}
	};
	const json = async (response: Response): Promise<unknown> => {
		try {
			return await response.json();
		} catch {
			throw new SetupError("The forge returned an invalid response.");
		}
	};
	const view = async (): Promise<InstallationView> => {
		const response = await request(
			"GET",
			`/-/api/installations?node=${encodeURIComponent(options.node)}`,
		);
		if (!response.ok) {
			throw new SetupError(
				`Could not inspect Issues installations (HTTP ${response.status}).`,
			);
		}
		const data = await json(response);
		if (
			!record(data) || !record(data.node) || data.node.path !== options.node ||
			!Array.isArray(data.installations)
		) {
			throw new SetupError("The forge returned an invalid installation view.");
		}
		return {
			effective: data.installations.map((item) => {
				if (!record(item)) {
					throw new SetupError(
						"The forge returned an invalid installation view.",
					);
				}
				return readInstallation(item.installation, options.node);
			}),
		};
	};
	const packagePresent = async (): Promise<boolean> => {
		const response = await request("GET", `/-/api/packages/${ISSUES_ID}`);
		if (response.status === 404) return false;
		if (!response.ok) {
			throw new SetupError(
				`Could not inspect the Issues package (HTTP ${response.status}).`,
			);
		}
		const data = await json(response);
		if (!record(data) || !Array.isArray(data.packages)) {
			throw new SetupError("The forge returned an invalid package list.");
		}
		let found = false;
		for (const item of data.packages) {
			if (
				!record(item) || item.extId !== ISSUES_ID ||
				typeof item.version !== "string" || typeof item.sha256 !== "string"
			) throw new SetupError("The forge returned an invalid package list.");
			if (item.version !== manifest.version) continue;
			if (found || item.sha256 !== bundle.sha256 || item.runtime !== "wasm") {
				throw new SetupError(
					"The published Issues version does not match the local package.",
				);
			}
			found = true;
		}
		return found;
	};

	// Check the node exists before making any changes. This view excludes
	// disabled installations, so only the atomic ensure operation can decide
	// whether creating or reusing an installation is safe.
	await view();
	let published = false;
	if (!(await packagePresent())) {
		const response = await request("PUT", "/-/api/packages", body);
		if (!response.ok && response.status !== 409) {
			throw new SetupError(
				`Could not publish the Issues package (HTTP ${response.status}).`,
			);
		}
		if (!(await packagePresent())) {
			throw new SetupError(
				"The Issues package could not be verified after publication.",
			);
		}
		published = response.ok;
	}

	const install = () =>
		request("POST", "/-/api/installations", {
			extId: ISSUES_ID,
			version: manifest.version,
			node: options.node,
			mode: "enforce",
			ensure: true,
		});
	let response = await install();
	// A concurrent caller may have changed the lineage; ask the atomic ensure
	// operation to resolve it again instead of trusting the filtered GET view.
	if (response.status === 409) response = await install();
	if (!response.ok) {
		throw new SetupError(
			`Could not ensure the Issues installation (HTTP ${response.status}).`,
		);
	}
	const current = readInstallation(await json(response), options.node);
	assertCompatible(current, manifest.version);
	const effective = (await view()).effective.filter((i) =>
		i.extId === ISSUES_ID
	);
	if (effective.length !== 1 || effective[0].id !== current.id) {
		throw new SetupError("The Issues installation could not be verified.");
	}
	assertCompatible(effective[0], manifest.version);
	return { published, inherited: current.nodePath !== options.node };
};

const readStdinToken = async (): Promise<string> => {
	if (Deno.stdin.isTerminal()) {
		throw new SetupError("Token input must be piped.");
	}
	const reader = Deno.stdin.readable.getReader();
	const decoder = new TextDecoder();
	let token = "";
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			token += decoder.decode(value, { stream: true });
			if (token.length > 512) throw new SetupError("Token input is too long.");
		}
		return token + decoder.decode();
	} finally {
		reader.releaseLock();
	}
};

export const main = async (
	args: readonly string[],
	io: SetupIo & {
		readonly out: (line: string) => void;
		readonly err: (line: string) => void;
	},
): Promise<number> => {
	const flags = args[0] === "--" ? args.slice(1) : args;
	if (flags.length === 1 && flags[0] === "--help") {
		io.out(USAGE);
		return 0;
	}
	try {
		const result = await setupIssues(parseOptions(args), io);
		io.out(
			`Issues is ready (${
				result.published ? "published" : "package already present"
			}; ${
				result.inherited ? "inherited installation" : "installation verified"
			}).`,
		);
		return 0;
	} catch (error) {
		io.err(
			error instanceof SetupError ? error.message : "Could not prepare Issues.",
		);
		return 1;
	}
};

if (import.meta.main) {
	Deno.exit(
		await main(Deno.args, {
			readTextFile: Deno.readTextFile,
			readToken: readStdinToken,
			fetch,
			out: (line) => console.log(line),
			err: (line) => console.error(line),
		}),
	);
}
