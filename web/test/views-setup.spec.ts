// The setup wizard against the mock kernel: unlock with
// the fragment token (never displayed), environment checks, name and
// origin, "paste your issuer URL" (DCR, the
// optional initial access token, the manual fallback), the claim link, and
// the post-claim steps (content, invites and root key).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../src/api/http.ts";
import { createMockFetch } from "../src/api/mock/server.ts";
import { mountApp } from "./support/app.ts";
import {
	byTag,
	byText,
	click,
	findAll,
	flush,
	html,
	submit,
	type TestElement,
	text,
	type,
} from "./support/renderer.ts";

const TOKEN = "s3t_ab12cd34ef56gh78ij90kl12mn34op";

const title = (root: TestElement): string =>
	text(findAll(root, (el) => el.attrs["id"] === "wizard-step-title")[0]!);

const input = (root: TestElement, name: string): TestElement => {
	const found = findAll(
		root,
		(el) =>
			(el.tag === "input" || el.tag === "textarea" || el.tag === "select") &&
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

beforeEach(() => {
	vi.stubGlobal("confirm", () => true);
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe("setup wizard: pre-claim", () => {
	it("unlocks with the fragment token without ever showing it, then checks the environment", async () => {
		const app = await mountApp("/-/setup", {
			mock: { setupState: "fresh", signedIn: false },
			setupToken: TOKEN,
		});
		await flush();
		const unlock = app.calls.find((c) => c.path === "/-/setup/unlock");
		expect(unlock).toMatchObject({ method: "POST", body: { token: TOKEN } });
		expect(unlock?.headers["content-type"]).toBe("application/json");
		expect(html(app.root)).not.toContain(TOKEN);
		expect(title(app.root)).toBe("Environment");

		expect(app.calls.filter((c) => c.path === "/-/setup/checks")).toHaveLength(
			1,
		);
		expect("disabled" in button(app.root, "Continue").attrs).toBe(false);
		expect(text(app.root)).not.toContain("container");
		expect(text(app.root)).not.toContain("Workers AI");
		expect(text(app.root)).toContain("Forge address");
		expect(text(app.root)).toContain("Attach your custom domain first");
		click(button(app.root, "Continue"));
		await flush();
		expect(title(app.root)).toBe("Name and address");
	});

	it("blocks on a required failure and allows a manual retry, including after an error", async () => {
		const inner = createMockFetch({ setupState: "unlocked", signedIn: false });
		let attempts = 0;
		const fetch: FetchLike = (path, init) => {
			if (path !== "/-/setup/checks") return inner(path, init);
			attempts += 1;
			if (attempts === 3) {
				return Promise.resolve(
					Response.json(
						{ error: "unavailable", message: "Checks unavailable" },
						{ status: 503 },
					),
				);
			}
			return Promise.resolve(Response.json({
				checks: [
					{
						id: "artifacts",
						phase: "setup",
						ok: attempts > 1,
						optional: false,
						message: "Artifacts",
					},
					{
						id: "loader",
						phase: "setup",
						ok: true,
						optional: false,
						message: "Loader",
					},
					{
						id: "r2",
						phase: "setup",
						ok: true,
						optional: false,
						message: "R2",
					},
				],
			}));
		};
		const app = await mountApp("/-/setup", { fetch });
		expect("disabled" in button(app.root, "Continue").attrs).toBe(true);
		await app.clock.advance(120_000);
		await flush();
		expect(attempts).toBe(1);
		click(button(app.root, "Run checks again"));
		await flush();
		expect("disabled" in button(app.root, "Continue").attrs).toBe(false);
		click(button(app.root, "Run checks again"));
		await flush();
		expect(text(app.root)).toContain("Checks unavailable");
		expect("disabled" in button(app.root, "Continue").attrs).toBe(true);
		click(button(app.root, "Run checks again"));
		await flush();
		expect(text(app.root)).not.toContain("Checks unavailable");
		expect("disabled" in button(app.root, "Continue").attrs).toBe(false);
	});

	it("asks for the token or logs code when the URL carried none", async () => {
		const app = await mountApp("/-/setup", {
			mock: { setupState: "fresh", signedIn: false },
		});
		expect(title(app.root)).toBe("Unlock");
		const field = input(app.root, "setup-code");
		expect(field.attrs["type"]).toBe("password");
		type(field, "short");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(text(app.root)).toContain("too short");
		expect(app.calls.some((c) => c.path === "/-/setup/unlock")).toBe(false);
		type(field, "a-bad-code-from-the-logs-xxxx");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(text(app.root)).toContain("invalid setup token or code");
		type(field, "correct-horse-battery-staple-xx");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(title(app.root)).toBe("Environment");
		// WP2's real routes: status (never the old `state`), then unlock.
		expect(app.calls.some((c) => c.path === "/-/setup/state")).toBe(false);
		expect(
			app.calls.filter((c) => c.path === "/-/setup/status").length,
		).toBeGreaterThanOrEqual(2);
	});

	it("asks the forge for a claim code (WP2 `POST /-/setup/code`) and says what happened", async () => {
		const app = await mountApp("/-/setup", {
			mock: { setupState: "fresh", signedIn: false },
		});
		expect(app.calls.some((c) => c.path === "/-/setup/code")).toBe(false);
		click(button(app.root, "Write a claim code to the logs"));
		await flush();
		expect(app.calls.filter((c) => c.path === "/-/setup/code")).toEqual([
			expect.objectContaining({ method: "POST" }),
		]);
		expect(text(app.root)).toContain("A claim code is in Workers Logs now");
		// A second request while that code is valid logs nothing new.
		click(button(app.root, "Write a claim code to the logs"));
		await flush();
		expect(text(app.root)).toContain("No new code was written");
		expect(text(app.root)).toContain("npx wrangler tail");
	});

	it("logs no claim code when the deploy set a setup token", async () => {
		const app = await mountApp("/-/setup", {
			mock: { setupState: "fresh", signedIn: false, setupTokenDeployed: true },
		});
		click(button(app.root, "Write a claim code to the logs"));
		await flush();
		expect(text(app.root)).toContain("deployed with a setup token");
	});

	it("starts at unlock when the setup session has expired mid-way", async () => {
		const app = await mountApp("/-/setup", {
			mock: { setupState: "idp", signedIn: false, setupSession: false },
		});
		expect(title(app.root)).toBe("Unlock");
		type(input(app.root, "setup-code"), "correct-horse-battery-staple-xx");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		// The forge already has its IdP: straight to the claim.
		expect(title(app.root)).toBe("Claim ownership");
	});

	it("lands on the claim when the IdP is configured and the session holds", async () => {
		const app = await mountApp("/-/setup", {
			mock: { setupState: "idp", signedIn: false },
		});
		expect(title(app.root)).toBe("Claim ownership");
		expect(app.calls.map((c) => c.path)).toContain("/-/setup/status");
	});

	it("saves the name and an https origin, warning about workers.dev", async () => {
		const app = await mountApp("/-/setup", {
			mock: { setupState: "unlocked", signedIn: false },
		});
		await flush();
		click(button(app.root, "Continue"));
		await flush();
		type(input(app.root, "forgeName"), "Rawkode Academy");
		type(input(app.root, "canonicalOrigin"), "http://insecure.example");
		await flush();
		expect("disabled" in byText(app.root, "button", "Save and continue")!.attrs)
			.toBe(true);
		type(
			input(app.root, "canonicalOrigin"),
			"https://tartan.acme.workers.dev/some/path",
		);
		await flush();
		expect(text(app.root)).toContain("*.workers.dev");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(app.calls.find((c) => c.path === "/-/setup/name")?.body).toEqual({
			forgeName: "Rawkode Academy",
			canonicalOrigin: "https://tartan.acme.workers.dev",
		});
		expect(title(app.root)).toBe("Identity provider");
	});

	const toIdp = async (fetch?: FetchLike) => {
		const app = await mountApp("/-/setup", {
			mock: { setupState: "unlocked", signedIn: false },
			...(fetch ? { fetch } : {}),
		});
		await flush();
		click(button(app.root, "Continue"));
		await flush();
		type(input(app.root, "forgeName"), "Forge");
		type(input(app.root, "canonicalOrigin"), "https://code.example");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(title(app.root)).toBe("Identity provider");
		return app;
	};

	it("registers by DCR from a pasted issuer, sending the initial access token once", async () => {
		const app = await toIdp();
		type(input(app.root, "issuer"), "https://id.rawkode.academy");
		type(input(app.root, "initialAccessToken"), "iat-123");
		await flush();
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(app.calls.find((c) => c.path === "/-/setup/idp/register")?.body)
			.toEqual({
				issuer: "https://id.rawkode.academy",
				initialAccessToken: "iat-123",
			});
		expect(text(app.root)).toContain("Client id tartan-dev-8f2c");
		expect(html(app.root)).not.toContain("iat-123");
		click(button(app.root, "Continue"));
		await flush();
		expect(title(app.root)).toBe("Claim ownership");
		const claim = byText(app.root, "a", "Sign in to become owner")!;
		expect(claim.attrs["href"]).toBe(
			"/-/auth/login?return_to=%2F-%2Fsetup&purpose=bootstrap",
		);
	});

	it("warns about a trailing slash and refuses non-https issuers", async () => {
		const app = await toIdp();
		type(input(app.root, "issuer"), "https://id.rawkode.academy/");
		await flush();
		expect(text(app.root)).toContain("Most have no trailing slash");
		type(input(app.root, "issuer"), "http://id.rawkode.academy");
		await flush();
		expect("disabled" in byText(app.root, "button", "Register Tartan")!.attrs)
			.toBe(true);
	});

	it("falls back to manual client entry when registration fails", async () => {
		const app = await toIdp();
		type(input(app.root, "issuer"), "https://login.example.com");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(text(app.root)).toContain("no registration endpoint");
		expect(text(app.root)).toContain("Registration did not work");
		const redirect = findAll(
			app.root,
			(el) => el.tag === "input" && el.attrs["readonly"] !== undefined,
		)[0]!;
		expect(redirect.value).toBe("https://code.example/-/auth/callback");
		type(input(app.root, "clientId"), "tartan-client");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(app.calls.find((c) => c.path === "/-/setup/idp")?.body).toEqual({
			issuer: "https://login.example.com",
			clientId: "tartan-client",
			clientAuth: "none",
		});
		expect(title(app.root)).toBe("Claim ownership");
	});

	it("lists the IdP recipes, including Cloudflare Access", async () => {
		const app = await toIdp();
		const recipes = byTag(app.root, "summary").map(text);
		expect(recipes).toContain("Cloudflare Access (no new vendor)");
		expect(recipes.some((r) => r.includes("id.rawkode.academy"))).toBe(true);
	});

	it("sends a signed-out visitor of a set-up forge to sign in", async () => {
		const app = await mountApp("/-/setup", {
			mock: { setupState: "done", signedIn: false },
		});
		expect(text(app.root)).toContain("already set up");
		expect(byText(app.root, "a", "Sign in")!.attrs["href"]).toBe(
			"/-/auth/login?return_to=%2F-%2Fsetup",
		);
	});
});

describe("setup wizard: post-claim", () => {
	it("offers content, invites and the root key after the claim", async () => {
		const app = await mountApp("/-/setup", { mock: { setupState: "done" } });
		await flush();
		expect(title(app.root)).toBe("Content");
		expect(app.calls.some((c) => c.path === "/-/api/admin/selftest/lanes"))
			.toBe(false);
		click(button(app.root, "Skip for now"));
		await flush();
		expect(title(app.root)).toBe("Invite people");
		click(button(app.root, "Continue"));
		await flush();
		expect(title(app.root)).toBe("Root key");
		expect(
			findAll(app.root, (el) => el.tag === "input").map((el) => el.value),
		).toContain("npx wrangler secret put TARTAN_SECRET");
		expect(app.calls.some((c) => c.path === "/-/api/admin/root-key/export"))
			.toBe(false);
		click(button(app.root, "Show the root key"));
		await flush();
		const secret = findAll(
			app.root,
			(el) => el.tag === "input" && el.attrs["type"] === "password",
		)[0]!;
		expect(String(secret.value)).toMatch(/^mock-root-key-/);
		expect(text(app.root)).not.toContain("mock-root-key-");
		click(button(app.root, "Done"));
		await flush();
		expect(title(app.root)).toBe("Done");
	});

	it("creates a first group and repository in the content step", async () => {
		const app = await mountApp("/-/setup", { mock: { setupState: "done" } });
		await flush();
		type(input(app.root, "slug"), "studio");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(
			app.calls.find((c) => c.path === "/-/api/nodes" && c.method === "POST")
				?.body,
		)
			.toEqual({ kind: "group", slug: "studio", visibility: "private" });
		expect(text(app.root)).toContain("Group studio created");
		type(input(app.root, "slug"), "demo");
		submit(byTag(app.root, "form")[0]!);
		await flush();
		expect(app.calls.find((c) => c.path === "/-/api/nodes/repos")?.body)
			.toEqual({
				parent: "studio",
				slug: "demo",
				visibility: "private",
			});
		expect(text(app.root)).toContain("Repository studio/demo created");
	});
});
