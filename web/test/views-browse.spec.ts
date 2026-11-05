// Namespace browser, node pages, repo code views, extension tabs, the shell
// and the auth pages, against the mock kernel.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SHAS } from "../src/api/mock/fixtures.ts";
import { mountApp } from "./support/app.ts";
import {
	byTag,
	byText,
	findAll,
	flush,
	html,
	submit,
	type TestElement,
	text,
	type,
} from "./support/renderer.ts";

const links = (root: TestElement): string[] =>
	byTag(root, "a").map((a) => a.attrs["href"] ?? "");

beforeEach(() => vi.stubGlobal("confirm", () => true));
afterEach(() => vi.unstubAllGlobals());

describe("repo code views", () => {
	it("walks into a directory and shows the parent link", async () => {
		const app = await mountApp(
			"/acme/platform/router/-/tree/main/services/api",
		);
		expect(
			app.calls.some((c) =>
				c.path.startsWith(
					"/-/api/tree?repo=acme%2Fplatform%2Frouter&ref=main&path=services%2Fapi",
				)
			),
		).toBe(true);
		expect(links(app.root)).toContain(
			"/acme/platform/router/-/tree/main/services/api/src",
		);
		expect(links(app.root)).toContain(
			"/acme/platform/router/-/tree/main/services",
		);
	});

	it("shows a file with line numbers, a raw link and the file banner slot", async () => {
		const app = await mountApp(
			"/acme/platform/router/-/blob/main/services/api/src/server.ts",
		);
		const lines = findAll(
			app.root,
			(el) =>
				el.tag === "td" && (el.attrs["class"] ?? "").includes("file__line"),
		);
		expect(lines).toHaveLength(7);
		expect(text(lines[4]!)).toContain("limit(Number");
		const raw = byText(app.root, "a", "Raw")!;
		expect(raw.attrs["href"]).toBe(
			"/-/raw/acme/platform/router/main/services/api/src/server.ts",
		);
		expect(raw.attrs).toHaveProperty("data-reload");
		expect(text(app.root)).toContain("Sample banner on this file");
		expect(findAll(app.root, (el) => el.attrs["data-slot"] === "file.banner"))
			.toHaveLength(1);
	});

	it("says a binary file is not shown", async () => {
		const app = await mountApp(
			"/acme/platform/router/-/blob/main/apps/web/public/logo.png",
		);
		expect(text(app.root)).toContain("Binary file not shown.");
	});

	it("shows a not-found state for a missing path", async () => {
		const app = await mountApp("/acme/platform/router/-/blob/main/nope.ts");
		expect(text(app.root)).toContain("this file was not found");
	});

	it("lists history with agent and advance trailers", async () => {
		const app = await mountApp("/acme/platform/router/-/commits/main");
		expect(text(app.root)).toContain("api: split router into modules");
		expect(text(app.root)).toContain("advance: adv_2");
		expect(text(app.root)).toContain("agent: a_codex-1");
		expect(links(app.root)).toContain(
			`/acme/platform/router/-/commit/${SHAS.c2}`,
		);
	});

	it("shows a commit with trailers and file diffs", async () => {
		const app = await mountApp(`/acme/platform/router/-/commit/${SHAS.c1}`);
		// The page asks for the patches (WP8 builds them only on request).
		expect(
			app.calls.some((c) =>
				c.path.startsWith("/-/api/commit?") && c.path.endsWith("&patch=1")
			),
		).toBe(true);
		expect(text(app.root)).toContain("api: rate limits on /n");
		expect(text(app.root)).toContain("Change-Id");
		expect(text(app.root)).toContain("2 files changed");
		expect(
			findAll(
				app.root,
				(el) => (el.attrs["class"] ?? "").includes("diff__line--add"),
			).length,
		)
			.toBeGreaterThan(0);
		expect(links(app.root)).toContain(
			`/acme/platform/router/-/commit/${SHAS.genesis}`,
		);
	});

	it("compares two revisions and edits the range", async () => {
		const app = await mountApp(
			"/acme/platform/router/-/compare/main...lanes%2Fln_x",
		);
		expect(
			app.calls.some((c) =>
				c.path ===
					"/-/api/compare?repo=acme%2Fplatform%2Frouter&base=main&head=lanes%2Fln_x&patch=1"
			),
		).toBe(true);
		expect(text(app.root)).toContain("2 files");
		const head = findAll(app.root, (el) => el.attrs["name"] === "head")[0]!;
		expect(head.value).toBe("lanes/ln_x");
		type(head, "feature");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(app.router.currentRoute.value.fullPath).toBe(
			"/acme/platform/router/-/compare/main...feature",
		);
	});
});

describe("extension tabs", () => {
	it("renders a repo.tab page from its contribution", async () => {
		const app = await mountApp("/acme/platform/router/-/notes");
		await flush();
		expect(findAll(app.root, (el) => el.attrs["data-slot"] === "repo.tab"))
			.toHaveLength(1);
		expect(text(app.root)).toContain("Sample note one");
		const nav = findAll(
			app.root,
			(el) => el.attrs["aria-label"] === "Extension pages",
		)[0]!;
		expect(byText(nav, "a", "Notes")!.attrs["href"]).toBe(
			"/acme/platform/router/-/notes",
		);
	});

	it("moves a board card through the slot action and refreshes the slot", async () => {
		const app = await mountApp("/acme/platform/router/-/notes");
		await flush();
		const select = findAll(app.root, (el) => el.tag === "select")[0]!;
		select.value = "done";
		select.selectedIndex = 2;
		for (
			const fn of select.listeners["change"] ? [select.listeners["change"]] : []
		) fn({ type: "change", target: select } as never);
		await flush();
		const action = app.calls.find((c) => c.path.includes("/action"));
		expect(action?.body).toMatchObject({
			action: "move",
			payload: { card: "n_2", from: "open", to: "done" },
			ctx: { node: "acme/platform/router" },
		});
	});

	it("says when no extension provides a tab", async () => {
		const app = await mountApp("/acme/platform/router/-/nothing-here");
		expect(text(app.root)).toContain(
			"No extension provides “nothing-here” here.",
		);
	});
});

describe("shell, sign-in and the leaving interstitial", () => {
	it("routes https links through the interstitial with rel=noopener noreferrer", async () => {
		const app = await mountApp(
			"/-/leaving?to=https%3A%2F%2Fexample.com%2Fdocs%3Fa%3D1",
		);
		const link = byText(app.root, "a", "Continue to example.com")!;
		expect(link.attrs["href"]).toBe("https://example.com/docs?a=1");
		expect(link.attrs["rel"]).toBe("noopener noreferrer");
		expect(text(app.root)).toContain("https://example.com/docs?a=1");
	});

	it("refuses anything but https in the interstitial", async () => {
		for (
			const to of [
				"javascript:alert(1)",
				"//evil.example",
				"http://evil.example",
				"https://u:p@evil.example",
			]
		) {
			const app = await mountApp(`/-/leaving?to=${encodeURIComponent(to)}`);
			expect(byTag(app.root, "a")).toEqual([]);
			expect(text(app.root)).toContain("not a valid https address");
			expect(html(app.root)).not.toContain('evil.example"');
		}
	});

	it("keeps login return_to on this origin", async () => {
		const app = await mountApp("/-/login?return_to=%2F%2Fevil.example", {
			mock: { signedIn: false },
		});
		expect(byText(app.root, "a", "Continue to sign in")!.attrs["href"]).toBe(
			"/-/auth/login?return_to=%2F",
		);
		const ok = await mountApp("/-/login?return_to=%2Facme", {
			mock: { signedIn: false },
		});
		expect(byText(ok.root, "a", "Continue to sign in")!.attrs["href"]).toBe(
			"/-/auth/login?return_to=%2Facme",
		);
	});

	it("turns an invite link into a login carrying the code", async () => {
		const app = await mountApp("/-/invite/abcDEF12345", {
			mock: { signedIn: false },
		});
		expect(byText(app.root, "a", "Accept and sign in")!.attrs["href"]).toBe(
			"/-/auth/login?return_to=%2F&invite=abcDEF12345",
		);
		const bad = await mountApp("/-/invite/%3Cscript%3E", {
			mock: { signedIn: false },
		});
		expect(byTag(bad.root, "a")).toEqual([]);
	});

	it("redirects to the wizard while the forge is not set up", async () => {
		const app = await mountApp("/-/explore", {
			mock: { setupState: "fresh", signedIn: false },
			guard: true,
		});
		expect(app.router.currentRoute.value.name).toBe("setup");
	});
});
