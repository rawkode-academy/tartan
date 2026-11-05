// Repository actions, sidebar contributions and navigation.

import { describe, expect, it, vi } from "vitest";
import { type FetchLike } from "../src/api/http.ts";
import { createMockFetch } from "../src/api/mock/server.ts";
import { instId, NOTES, SAMPLE_CATALOG } from "./support/catalog.ts";
import { mountApp } from "./support/app.ts";
import { byAttr, click, findAll, flush, text } from "./support/renderer.ts";

const REPO = "/acme/platform/router";

describe("repo header actions", () => {
	it("posts the contribution id with the narrowed ctx and follows the result", async () => {
		const app = await mountApp(`${REPO}/-/tree/main`);
		const button = byAttr(app.root, "data-action", "new-note")[0]!;
		expect(button.tag).toBe("button");
		expect(text(button)).toContain("New note");
		click(button);
		await flush();
		const post = app.calls.find((c) => c.method === "POST");
		expect(post?.path).toBe(
			`/-/api/slot/${instId(NOTES)}/new-note/action`,
		);
		expect(post?.body).toEqual({
			action: "new-note",
			ctx: { node: "acme/platform/router" },
		});
		await vi.waitFor(() =>
			expect(app.router.currentRoute.value.fullPath).toBe(`${REPO}/-/notes`)
		);
	});

	it("narrows a code page's hint to the repo and shows failures as a toast", async () => {
		const inner = createMockFetch({ catalog: SAMPLE_CATALOG });
		const failing: FetchLike = (input, init) =>
			input.endsWith("/action")
				? Promise.resolve(
					Response.json({
						error: "denied",
						message: "creating work needs Developer",
					}, {
						status: 403,
					}),
				)
				: inner(input, init);
		const app = await mountApp(`${REPO}/-/tree/main/services`, {
			fetch: failing,
		});
		click(byAttr(app.root, "data-action", "new-note")[0]!);
		await flush();
		const post = app.calls.find((c) => c.method === "POST");
		expect(post?.body).toEqual({
			action: "new-note",
			ctx: { node: "acme/platform/router" },
		});
		expect(app.toasts.items.map((t) => [t.tone, t.text])).toContainEqual([
			"danger",
			"creating work needs Developer",
		]);
		expect(app.router.currentRoute.value.fullPath).toBe(
			`${REPO}/-/tree/main/services`,
		);
	});
});

describe("repo sidebar column", () => {
	it("shows the sidebar only when the view lists repo.sidebar instances", async () => {
		const file = await mountApp(`${REPO}/-/blob/main/README.md`);
		expect(byAttr(file.root, "aria-label", "Repository sidebar")).toHaveLength(
			1,
		);
		expect(text(file.root)).toContain("3 notes");
		const tree = await mountApp(`${REPO}/-/tree/main/services`);
		expect(byAttr(tree.root, "aria-label", "Repository sidebar")).toEqual([]);
		expect(
			findAll(
				tree.root,
				(el) => (el.attrs["class"] ?? "").includes("repo-content__body--wide"),
			),
		).toHaveLength(1);
		const log = await mountApp(`${REPO}/-/commits/main`);
		expect(byAttr(log.root, "aria-label", "Repository sidebar")).toEqual([]);
	});
});
