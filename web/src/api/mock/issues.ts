// Mock the Issues tool protocol for the local preview; no WASM executes here.
import type {
	InstallationDto,
	NodeDto,
	ViewerDto,
} from "@tartan/contract/api.ts";
import type { Issue } from "../../forge/data/index.ts";
import { DEMO_PROJECTS } from "./demo.ts";
import { REPO_ID } from "./fixtures.ts";

type State = {
	readonly nodes: readonly NodeDto[];
	readonly viewer: ViewerDto;
	readonly installations: readonly InstallationDto[];
	readonly issues: Record<string, Issue[]>;
};

const fail = (status: number, code: string, message: string): Response =>
	Response.json({ error: { code, message } }, { status });
const withoutBody = ({ body: _body, ...issue }: Issue): Omit<Issue, "body"> =>
	issue;

export const handleIssuesTool = (
	path: string,
	method: string,
	body: Record<string, unknown>,
	state: State,
): Response | null => {
	const match =
		/^\/-\/api\/repos\/([^/]+)\/ext\/rawkode\.issues\/tools\/([^/]+)$/.exec(
			path,
		);
	if (!match || method !== "POST") return null;
	if (!state.viewer.principal) {
		return fail(401, "unauthenticated", "Sign in to see issues.");
	}
	if (state.viewer.role < 20) {
		return fail(403, "denied", "Reporter access is required.");
	}
	const repo = state.nodes.find((node) =>
		node.id === match[1] && node.kind === "repo"
	);
	if (!repo) return fail(404, "not_found", "Repository not found.");
	const installed = state.installations.some((item) =>
		item.extId === "rawkode.issues" && item.mode === "enforce" &&
		(repo.path === item.nodePath || repo.path.startsWith(`${item.nodePath}/`))
	);
	if (!installed) {
		return fail(404, "not_installed", "Issues is not installed here.");
	}
	const project = typeof body["project"] === "string"
		? (repo.id === REPO_ID ? DEMO_PROJECTS : []).find((p) =>
			p.name === body["project"]
		)
		: undefined;
	if (body["project"] !== undefined && !project) {
		return fail(404, "not_found", "Project not found.");
	}
	const args = typeof body["args"] === "object" && body["args"] !== null
		? body["args"] as Record<string, unknown>
		: {};
	const issues = state.issues[repo.id] ??= [];
	const scoped = project
		? issues.filter((issue) => issue.project === project.root)
		: issues;
	const tool = match[2];
	if (tool === "list") {
		const filter = typeof args["state"] === "string" ? args["state"] : "open";
		if (!["open", "closed", "all"].includes(filter)) {
			return fail(400, "invalid", "Invalid state.");
		}
		const limit = typeof args["limit"] === "number"
			? Math.max(1, Math.min(100, args["limit"]))
			: 30;
		return Response.json({
			result: {
				state: filter,
				project: project?.root ?? null,
				issues: scoped.filter((issue) =>
					filter === "all" || issue.state === filter
				)
					.slice().sort((a, b) => b.number - a.number).slice(0, limit).map(
						withoutBody,
					),
				open: scoped.filter((issue) => issue.state === "open").length,
				closed: scoped.filter((issue) => issue.state === "closed").length,
			},
		});
	}
	if (tool === "create") {
		const title = typeof args["title"] === "string" ? args["title"].trim() : "";
		if (!title || title.length > 200) {
			return fail(400, "invalid", "Enter a title of up to 200 characters.");
		}
		const now = Date.now();
		const issue: Issue = {
			number: Math.max(0, ...issues.map((i) => i.number)) + 1,
			title,
			body: typeof args["body"] === "string" ? args["body"] : "",
			project: project?.root ?? null,
			state: "open",
			author: {
				kind: state.viewer.principal.kind,
				id: state.viewer.principal.id,
			},
			createdAt: now,
			updatedAt: now,
			closedAt: null,
		};
		issues.push(issue);
		return Response.json({ result: { issue } });
	}
	const index = issues.findIndex((issue) =>
		issue.number === args["number"] &&
		(!project || issue.project === project.root)
	);
	if (index < 0) return fail(404, "not_found", "Issue not found.");
	const issue = issues[index]!;
	if (tool === "get") return Response.json({ result: { issue } });
	if (tool === "close" || tool === "reopen") {
		if (state.viewer.role < 30) {
			return fail(403, "denied", "Developer access is required.");
		}
		const next = tool === "close" ? "closed" : "open";
		const changed = issue.state !== next;
		const now = Date.now();
		const updated: Issue = changed
			? {
				...issue,
				state: next,
				updatedAt: now,
				closedAt: next === "closed" ? now : null,
			}
			: issue;
		issues[index] = updated;
		return Response.json({ result: { issue: withoutBody(updated), changed } });
	}
	return fail(404, "not_found", "Tool not found.");
};
