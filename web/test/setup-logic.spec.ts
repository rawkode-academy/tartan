// Setup wizard step order, environment checks and issuer field rules.

import { describe, expect, it } from "vitest";
import type { EnvironmentCheck } from "@tartan/contract/api.ts";
import { requiredChecksPass } from "../src/setup/checks.ts";
import { checkIssuer, jwksUri, redirectUri } from "../src/setup/issuer.ts";
import {
	entryStep,
	nextStep,
	postClaimSteps,
	PRE_CLAIM,
	stepAllowed,
} from "../src/setup/wizard.ts";

const check = (
	id: EnvironmentCheck["id"],
	ok: boolean,
	optional = false,
): EnvironmentCheck => ({ id, phase: "setup", ok, optional, message: id });

describe("wizard steps", () => {
	it("lands on the step of the kernel's setup state", () => {
		expect(entryStep("fresh", false)).toBe("unlock");
		expect(entryStep("unlocked", false)).toBe("checks");
		expect(entryStep("idp", false)).toBe("claim");
		expect(entryStep("done", true)).toBe("content");
		expect(entryStep("done", false)).toBe("already-set-up");
	});

	it("walks the pre-claim steps in order", () => {
		expect(PRE_CLAIM).toEqual(["unlock", "checks", "name", "idp", "claim"]);
		expect(nextStep("unlock", false)).toBe("checks");
		expect(nextStep("checks", false)).toBe("name");
		expect(nextStep("name", false)).toBe("idp");
		expect(nextStep("idp", false)).toBe("claim");
	});

	it("offers content setup only after the claim", () => {
		expect(postClaimSteps(false)[0]).toBe("content");
		expect(stepAllowed("content", "unlocked")).toBe(false);
		expect(stepAllowed("content", "done")).toBe(true);
	});

	it("offers the root-key step only on the button path", () => {
		expect(postClaimSteps(false)).toEqual([
			"content",
			"people",
			"finished",
		]);
		expect(postClaimSteps(true)).toEqual([
			"content",
			"people",
			"secret",
			"finished",
		]);
		expect(nextStep("people", true)).toBe("secret");
		expect(nextStep("people", false)).toBe("finished");
	});

	it("allows re-unlocking while not done (expired setup session)", () => {
		expect(stepAllowed("unlock", "unlocked")).toBe(true);
		expect(stepAllowed("unlock", "done")).toBe(false);
		expect(stepAllowed("claim", "unlocked")).toBe(false);
	});
});

describe("environment checks", () => {
	it("requires every non-optional check", () => {
		expect(requiredChecksPass([])).toBe(false);
		expect(
			requiredChecksPass([
				check("artifacts", true),
				check("origin", false, true),
			]),
		).toBe(true);
		expect(requiredChecksPass([check("artifacts", false)])).toBe(false);
	});
});

describe("issuer field", () => {
	it("accepts an https issuer exactly as typed (trimmed)", () => {
		expect(checkIssuer("  https://id.example.com ")).toEqual({
			ok: true,
			issuer: "https://id.example.com",
		});
	});

	it("warns about (but keeps) a trailing slash: issuers match exactly", () => {
		const result = checkIssuer("https://id.example.com/");
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.issuer).toBe("https://id.example.com/");
			expect(result.warning).toMatch(/trailing slash/);
		}
	});

	it("refuses what cannot be an issuer", () => {
		for (
			const bad of [
				"",
				"id.example.com",
				"http://id.example.com",
				"https://user:pw@id.example",
				"https://id.example/?a=1",
				"https://id.example/#x",
				"https://id.example/.well-known/openid-configuration",
				"javascript:alert(1)",
			]
		) {
			expect(checkIssuer(bad).ok).toBe(false);
		}
	});

	it("derives the redirect and JWKS URLs from the canonical origin", () => {
		expect(redirectUri("https://forge.example.com")).toBe(
			"https://forge.example.com/-/auth/callback",
		);
		expect(jwksUri("https://forge.example.com/")).toBe(
			"https://forge.example.com/-/auth/jwks.json",
		);
	});
});
