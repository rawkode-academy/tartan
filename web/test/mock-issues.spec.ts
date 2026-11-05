// The local preview follows the Issues tool protocol and project scoping.
import { describe, expect, it, vi } from "vitest";
import { createApi } from "../src/api/client.ts";
import { createHttp } from "../src/api/http.ts";
import { createSession } from "../src/auth/session.ts";
import {
	DEMO_CATALOG,
	DEMO_ISSUES_INSTALLATION,
} from "../src/api/mock/demo.ts";
import { mockUlid, REPO_ID } from "../src/api/mock/fixtures.ts";
import { mockServices } from "../src/api/mock/index.ts";
import { createMockFetch, createMockState } from "../src/api/mock/server.ts";
import {
	createForgeStore,
	type Issue,
	type IssueList,
} from "../src/forge/data/index.ts";

const EXT = "rawkode.issues";

describe("mock Issues preview", () => {
	it("keeps existing mock Issues data and does not add a conflicting demo installation", () => {
		const state = createMockState();
		state.issues = {
			[REPO_ID]: [{
				number: 1,
				title: "User-created issue",
				project: null,
				state: "open",
				author: { kind: "user", id: "user" },
				createdAt: 1,
				updatedAt: 1,
				closedAt: null,
			}],
		};
		state.installations = [{
			...DEMO_ISSUES_INSTALLATION,
			id: `i_${mockUlid(888)}`,
			nodeId: mockUlid(11),
			nodePath: "acme",
		}];
		let saved = JSON.stringify(state);
		vi.stubGlobal("sessionStorage", {
			getItem: () => saved,
			setItem: (_key: string, value: string) => {
				saved = value;
			},
		});
		try {
			mockServices({ pathname: "/", search: "" }, { replaceState: () => {} });
			const restored = JSON.parse(saved) as typeof state;
			expect(restored.issues[REPO_ID]?.[0]?.title).toBe("User-created issue");
			expect(restored.installations.map((item) => item.id)).toEqual([
				`i_${mockUlid(888)}`,
			]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("shows aggregate and project counts without a false visibility warning", async () => {
		const api = createApi(createHttp(createMockFetch({
			demoIssues: true,
			catalog: DEMO_CATALOG,
		})));
		const session = createSession(api);
		await session.load();
		const store = createForgeStore(api, session);
		await store.loadEverything();
		expect(store.openCount(store.state.tree)).toBe(2);
		expect(store.refusedUnder(store.state.tree)).toEqual([]);
		expect(store.openCount(store.nodeAt("acme/platform/router:api")!)).toBe(1);
		expect(store.issuesAt("acme/platform/billing")).toMatchObject({
			reason: "not_installed",
		});
	});

	it("lists project issues, creates, closes and reopens them within their scope", async () => {
		const api = createApi(createHttp(createMockFetch({
			demoIssues: true,
			catalog: DEMO_CATALOG,
		})));
		const graph = await api.projects(REPO_ID);
		expect(graph.projects.map((p) => p.name)).toEqual(["api", "web", "shared"]);
		const all = await api.tool<IssueList>(REPO_ID, EXT, "list", {
			state: "all",
		});
		expect([all.open, all.closed]).toEqual([2, 1]);
		const apiList = await api.tool<IssueList>(REPO_ID, EXT, "list", {
			state: "all",
		}, "api");
		expect(apiList.project).toBe("services/api");
		expect(apiList.issues.map((i) => i.title)).toEqual([
			"Add rate limits to the public API",
		]);

		const created = await api.tool<{ issue: Issue }>(REPO_ID, EXT, "create", {
			title: "Handle timeouts",
			body: "Add a test.",
		}, "api");
		expect(created.issue).toMatchObject({
			number: 4,
			project: "services/api",
			state: "open",
		});
		await expect(api.tool(REPO_ID, EXT, "get", { number: 4 }, "web"))
			.rejects.toMatchObject({ code: "not_found" });
		const closed = await api.tool<{ issue: Issue; changed: boolean }>(
			REPO_ID,
			EXT,
			"close",
			{ number: 4 },
			"api",
		);
		expect(closed).toMatchObject({ issue: { state: "closed" }, changed: true });
		const reopened = await api.tool<{ issue: Issue; changed: boolean }>(
			REPO_ID,
			EXT,
			"reopen",
			{ number: 4 },
			"api",
		);
		expect(reopened).toMatchObject({ issue: { state: "open" }, changed: true });

		await api.extensions.setMode(DEMO_ISSUES_INSTALLATION.id, "disabled");
		await expect(api.tool(REPO_ID, EXT, "list", {}))
			.rejects.toMatchObject({ code: "not_installed" });
	});

	it("reports not_installed rather than an unknown failure without the extension", async () => {
		const api = createApi(createHttp(createMockFetch()));
		await expect(api.tool(REPO_ID, EXT, "list", {}))
			.rejects.toMatchObject({ code: "not_installed", status: 404 });
	});
});
