// Extension administration, forge settings and node settings against the mock kernel.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ManifestSchema } from "@tartan/contract/manifest.ts";
import type { FetchLike } from "../src/api/http.ts";
import { EMPTY_CATALOG, samplePackage } from "../src/api/mock/catalog.ts";
import {
	DEMO_CATALOG,
	DEMO_ISSUES_INSTALLATION,
} from "../src/api/mock/demo.ts";
import { createMockFetch } from "../src/api/mock/server.ts";
import { SAMPLE_CATALOG } from "./support/catalog.ts";
import { mountApp } from "./support/app.ts";
import {
	byAttr,
	byTag,
	byText,
	choose,
	click,
	findAll,
	flush,
	submit,
	type TestElement,
	text,
	type,
} from "./support/renderer.ts";

const field = (root: TestElement, name: string): TestElement => {
	const found = findAll(
		root,
		(el) =>
			["input", "select", "textarea"].includes(el.tag) &&
			el.attrs["name"] === name,
	)[0];
	if (!found) throw new Error(`no field ${name}`);
	return found;
};

const button = (root: TestElement, label: string | RegExp): TestElement => {
	const found = byText(root, "button", label);
	if (!found) throw new Error(`no button ${label}`);
	return found;
};

let confirms: string[] = [];
beforeEach(() => {
	confirms = [];
	vi.stubGlobal("confirm", (message: string) => {
		confirms.push(message);
		return true;
	});
});
afterEach(() => vi.unstubAllGlobals());

/** The form that holds the field `name`. */
const formOf = (root: TestElement, name: string): TestElement => {
	let el: TestElement | null = field(root, name);
	while (el && el.tag !== "form") el = el.parent;
	if (!el) throw new Error(`no form around ${name}`);
	return el;
};

/** Shows what is in force at `node` (WP7a requires a node). */
const showInForce = async (root: TestElement, node: string): Promise<void> => {
	type(field(root, "installed-at"), node);
	submit(formOf(root, "installed-at"));
	await flush();
};

describe("extensions admin", () => {
	it("lists what is in force at a node (WP7a `{node, installations: InstallationInForce[]}`)", async () => {
		const app = await mountApp("/-/extensions");
		// Starts where the kernel says (no `node`: never a guessed node that
		// may not exist, e2e), here the viewer's own namespace.
		expect(app.calls.map((c) => c.path)).toContain("/-/api/installations");
		expect(app.calls.map((c) => c.path)).toContain(
			"/-/api/installations?node=rawkode&include=disabled",
		);
		expect(field(app.root, "installed-at").value).toBe("rawkode");
		expect(byText(app.root, "a", "sample.queue")).toBeNull();
		// A repo under acme inherits acme's installations.
		await showInForce(app.root, "acme/platform/router");
		expect(app.calls.map((c) => c.path)).toContain(
			"/-/api/installations?node=acme%2Fplatform%2Frouter",
		);
		const rows = findAll(app.root, (el) => el.tag === "tr").map(text);
		expect(rows.some((r) => r.includes("sample.queue") && r.includes("acme")))
			.toBe(true);
		expect(rows.some((r) => r.includes("sample.notes"))).toBe(true);
	});

	it("keeps effective installations visible when disabled entries require more access", async () => {
		const inner = createMockFetch({ catalog: SAMPLE_CATALOG });
		const fetch: FetchLike = (input, init) =>
			new URL(input, "https://f.test").searchParams.get("include") ===
					"disabled"
				? Promise.resolve(
					Response.json({ error: "denied", message: "denied" }, {
						status: 403,
					}),
				)
				: inner(input, init);
		const app = await mountApp("/-/extensions?node=acme", { fetch });
		expect(byText(app.root, "a", "sample.queue")).not.toBeNull();
		expect(text(app.root)).toContain(
			"Only maintainers can manage disabled extensions here.",
		);
		expect(findAll(app.root, (el) => el.attrs["role"] === "alert"))
			.toHaveLength(0);
	});

	it("finds a disabled installation at its owning namespace and enables it again", async () => {
		const app = await mountApp("/-/extensions?node=acme");
		await app.router.push(
			byText(app.root, "a", "sample.queue")!.attrs["href"]!,
		);
		await flush();
		click(
			findAll(
				app.root,
				(el) => el.attrs["role"] === "radio" && text(el).startsWith("Disabled"),
			)[0]!,
		);
		await flush();
		await app.router.push(
			byText(app.root, "a", "← Extensions")!.attrs["href"]!,
		);
		await flush();
		const disabled = byAttr(app.root, "aria-label", "Disabled extensions")[0]!;
		expect(text(disabled)).toContain("sample.queue");
		expect(app.router.currentRoute.value.query["node"]).toBe("acme");

		await showInForce(app.root, "acme/platform/router");
		expect(byAttr(app.root, "aria-label", "Disabled extensions")).toEqual([]);
		expect(text(app.root)).toContain("select that namespace above");
		await showInForce(app.root, "acme");
		await app.router.push(
			byText(app.root, "a", "sample.queue")!.attrs["href"]!,
		);
		await flush();
		click(
			findAll(
				app.root,
				(el) => el.attrs["role"] === "radio" && text(el).startsWith("Enabled"),
			)[0]!,
		);
		await flush();
		await app.router.push(
			byText(app.root, "a", "← Extensions")!.attrs["href"]!,
		);
		await flush();
		expect(text(byAttr(app.root, "aria-label", "Extensions in force")[0]!))
			.toContain("sample.queue");
		expect(byAttr(app.root, "aria-label", "Disabled extensions")).toEqual([]);
	});

	it("lets an Owner request a mode change for a locked installation", async () => {
		const catalog = {
			...SAMPLE_CATALOG,
			installations: SAMPLE_CATALOG.installations.map((item) =>
				item.extId === "sample.queue"
					? { ...item, locked: true, mode: "disabled" as const }
					: item
			),
		};
		const app = await mountApp("/-/extensions?node=acme", {
			mock: { catalog },
		});
		await app.router.push(
			byText(app.root, "a", "sample.queue")!.attrs["href"]!,
		);
		await flush();
		const enabled = findAll(
			app.root,
			(el) => el.attrs["role"] === "radio" && text(el).startsWith("Enabled"),
		)[0]!;
		expect("disabled" in enabled.attrs).toBe(false);
		click(enabled);
		await flush();
		expect(app.calls.find((c) => c.path.endsWith("/mode"))?.body).toEqual({
			mode: "enforce",
		});
	});

	it("shows a server refusal when the viewer cannot change a locked installation", async () => {
		const catalog = {
			...SAMPLE_CATALOG,
			installations: SAMPLE_CATALOG.installations.map((item) =>
				item.extId === "sample.queue"
					? { ...item, locked: true, mode: "disabled" as const }
					: item
			),
		};
		const inner = createMockFetch({ catalog });
		const fetch: FetchLike = (input, init) =>
			input.endsWith("/mode")
				? Promise.resolve(
					Response.json({
						error: "denied",
						message: "Owner access is required.",
					}, { status: 403 }),
				)
				: inner(input, init);
		const app = await mountApp("/-/extensions?node=acme", { fetch });
		await app.router.push(
			byText(app.root, "a", "sample.queue")!.attrs["href"]!,
		);
		await flush();
		click(
			findAll(
				app.root,
				(el) => el.attrs["role"] === "radio" && text(el).startsWith("Enabled"),
			)[0]!,
		);
		await flush();
		expect(app.toasts.items.map((item) => item.text)).toContain(
			"Owner access is required.",
		);
	});

	it("an invited user starts at the node the kernel picks, with no alert (e2e)", async () => {
		const inner = createMockFetch({ catalog: SAMPLE_CATALOG });
		const startAt = (status: 200 | 404): FetchLike => (input, init) => {
			if (input !== "/-/api/installations") return inner(input, init);
			if (status === 404) {
				return Promise.resolve(Response.json({
					error: "not_found",
					message: "no namespace you can read yet: name a node",
				}, { status: 404 }));
			}
			return inner("/-/api/installations?node=acme%2Fplatform", init);
		};
		const app = await mountApp("/-/extensions", { fetch: startAt(200) });
		await flush();
		expect(field(app.root, "installed-at").value).toBe("acme/platform");
		expect(findAll(app.root, (el) => el.attrs["role"] === "alert"))
			.toHaveLength(0);
		const rows = findAll(app.root, (el) => el.tag === "tr").map(text);
		expect(rows.some((r) => r.includes("sample.queue"))).toBe(true);
		// Nothing readable yet: a prompt, not "installations was not found".
		const none = await mountApp("/-/extensions", { fetch: startAt(404) });
		await flush();
		expect(text(none.root)).toContain(
			"Enter a namespace to see the extensions in force there.",
		);
		expect(text(none.root)).not.toContain("was not found");
	});

	it("installs the WASM Issues package in enforce mode after reviewing permissions", async () => {
		const manifest = ManifestSchema.parse(
			JSON.parse(readFileSync("extensions/issues/tartan.json", "utf8")),
		);
		const catalog = {
			...EMPTY_CATALOG,
			packages: [{ ...samplePackage(manifest, 0), bundled: false }],
		};
		const app = await mountApp("/-/extensions", { mock: { catalog } });
		const issues = findAll(
			app.root,
			(el) =>
				el.tag === "li" &&
				text(el).includes(`rawkode.issues@${manifest.version}`),
		)[0]!;
		click(byText(issues, "button", "Install…")!);
		await flush();
		type(field(app.root, "node"), "acme/platform");
		await flush();
		submit(formOf(app.root, "node"));
		await flush();
		expect(app.calls.find((c) => c.path === "/-/api/installations/sheet")?.body)
			.toEqual({
				extId: "rawkode.issues",
				version: manifest.version,
				node: "acme/platform",
				mode: "enforce",
				ensure: true,
			});
		const sheet = findAll(
			app.root,
			(el) => el.attrs["aria-label"] === "Permission sheet",
		)[0]!;
		expect(text(sheet)).toContain("No repository access");
		expect(text(sheet)).not.toContain("gate");
		expect(
			app.calls.some((c) =>
				c.path === "/-/api/installations" && c.method === "POST"
			),
		)
			.toBe(false);
		submit(formOf(app.root, "node"));
		await flush();
		expect(
			app.calls.find((c) =>
				c.path === "/-/api/installations" && c.method === "POST"
			)?.body,
		)
			.toMatchObject({
				extId: "rawkode.issues",
				node: "acme/platform",
				mode: "enforce",
				ensure: true,
			});
		expect(app.toasts.items.map((t) => t.text)).toContain(
			"rawkode.issues installed at acme/platform.",
		);
	});

	it("refuses to install a second Issues database over a disabled installation", async () => {
		const node = "acme/platform/router";
		const app = await mountApp(`/-/extensions?node=${node}`, {
			mock: { catalog: DEMO_CATALOG, demoIssues: true },
		});
		await app.router.push(
			byText(app.root, "a", "rawkode.issues")!.attrs["href"]!,
		);
		await flush();
		click(
			findAll(
				app.root,
				(el) => el.attrs["role"] === "radio" && text(el).startsWith("Disabled"),
			)[0]!,
		);
		await flush();
		await app.router.push(
			byText(app.root, "a", "← Extensions")!.attrs["href"]!,
		);
		await flush();
		const pkg = findAll(
			app.root,
			(el) => el.tag === "li" && text(el).includes("rawkode.issues@"),
		)[0]!;
		click(byText(pkg, "button", "Install…")!);
		await flush();
		type(field(app.root, "node"), node);
		await flush();
		submit(formOf(app.root, "node"));
		await flush();
		submit(formOf(app.root, "node"));
		await flush();
		expect(text(app.root)).toContain(
			"rawkode.issues has a conflicting installation on this path",
		);
		expect(
			app.calls.find((c) =>
				c.path === "/-/api/installations" && c.method === "POST"
			)?.body,
		)
			.toMatchObject({ extId: "rawkode.issues", node, ensure: true });
		const result = await app.api.extensions.installations(node, true);
		expect(result.installations).toEqual([]);
		expect(result.disabled?.map((item) => item.id)).toEqual([
			DEMO_ISSUES_INSTALLATION.id,
		]);
	});

	it("shows and resets the WASM circuit breaker", async () => {
		const app = await mountApp("/-/extensions");
		await showInForce(app.root, "acme");
		await app.router.push(
			byText(app.root, "a", "sample.gate")!.attrs["href"]!,
		);
		await flush();
		// Isolated extensions expose their circuit breaker.
		expect(text(app.root)).toContain("Circuit breaker");
		// Repo-scoped: the breaker is per repository (blank = the kernel asks).
		type(field(app.root, "breaker-repo"), "acme/platform/router");
		submit(formOf(app.root, "breaker-repo"));
		await flush();
		expect(text(byAttr(app.root, "data-breaker")[0]!)).toContain(
			"1 strike(s) in the last 10 minutes",
		);
		click(button(app.root, "Reset breaker"));
		await flush();
		expect(confirms).toEqual(["Reset the circuit breaker of sample.gate?"]);
		expect(
			app.calls.filter((c) => c.path.includes("/breaker")).map((c) => c.method),
		).toEqual(["GET", "POST"]);
		expect(text(byAttr(app.root, "data-breaker")[0]!)).toContain("0 strike(s)");
	});

	it("disables an installation and shows its settings read-only", async () => {
		const app = await mountApp("/-/extensions");
		await showInForce(app.root, "acme");
		const link = byText(app.root, "a", "sample.queue")!;
		await app.router.push(link.attrs["href"]!);
		await flush();
		expect(text(app.root)).toContain("Approved permissions");
		click(
			findAll(
				app.root,
				(el) => el.attrs["role"] === "radio" && text(el).startsWith("Disabled"),
			)[0]!,
		);
		await flush();
		expect(confirms).toEqual(["Switch sample.queue to disabled?"]);
		expect(app.calls.find((c) => c.path.endsWith("/mode"))?.body).toEqual({
			mode: "disabled",
		});
		// The values come from contributes.settings and the config; titles stay
		// text. The kernel has no config route yet: nothing to submit.
		const terms = findAll(app.root, (el) => el.tag === "dt").map(text);
		const details = findAll(app.root, (el) => el.tag === "dd").map(text);
		expect(details[terms.indexOf("Batch size")]).toBe("1");
		expect(details[terms.indexOf("Queue label <script>")]).toBe("main");
		expect(findAll(app.root, (el) => el.tag === "script")).toEqual([]);
		expect(byTag(app.root, "form")).toEqual([]);
		expect(text(app.root)).toContain(
			"Settings are read-only here.",
		);
		expect(app.calls.some((c) => c.path.endsWith("/config"))).toBe(false);
	});
});

describe("forge settings and health", () => {
	it("shows the forge name, build, bindings and root-key notice, and only calls routes the kernel serves", async () => {
		const app = await mountApp("/-/settings");
		const page = text(app.root);
		expect(page).toContain("Tartan Demo");
		expect(page).toContain("Root key held in Durable Object storage");
		expect(page).toContain("ARTIFACTS: ok");
		for (
			const unserved of [
				"/-/api/settings",
				"/-/api/admin/root-key/export",
			]
		) {
			expect(app.calls.some((c) => c.path === unserved), unserved).toBe(false);
		}
	});

	it("creates single-use invite links", async () => {
		const app = await mountApp("/-/settings");
		type(field(app.root, "node"), "acme/platform");
		choose(field(app.root, "role"), "Maintainer");
		await flush();
		const form = findAll(
			app.root,
			(el) => el.tag === "form" && text(el).includes("Create invite link"),
		)[0]!;
		submit(form);
		await flush();
		expect(app.calls.find((c) => c.path === "/-/api/invites")?.body).toEqual({
			node: "acme/platform",
			role: 40,
		});
		expect(
			findAll(app.root, (el) => String(el.value).includes("/-/invite/")).length,
		).toBe(1);
	});
});

describe("repository settings", () => {
	it("shows repository details and the extension installation path", async () => {
		const app = await mountApp("/acme/platform/router/-/settings");
		expect(text(app.root)).toContain("repo");
		expect(text(app.root)).toContain("Default branch");
		expect(byText(app.root, "a", "Extensions")?.attrs["href"]).toBe(
			"/-/extensions?node=acme/platform/router",
		);
		expect(app.calls.some((c) => c.path.includes("/lanes/settings"))).toBe(
			false,
		);
	});
});

describe("node settings without a repo", () => {
	it("shows group details only", async () => {
		const app = await mountApp("/acme/-/settings");
		expect(text(app.root)).toContain("group");
		expect(byTag(app.root, "form")).toEqual([]);
	});
});
