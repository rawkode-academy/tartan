// A mock-only Issues installation and project graph for the local preview.
import type { InstallationDto, ProjectDto } from "@tartan/contract/api.ts";
import type { Issue } from "../../forge/data/index.ts";
import { EMPTY_CATALOG, sampleManifest, samplePackage } from "./catalog.ts";
import { MOCK_NOW, mockUlid, OWNER_ID, REPO_ID } from "./fixtures.ts";

const manifest = sampleManifest(
	"rawkode.issues",
	"Issues",
	"Per-repository issues, optionally filed against a project",
	{
		version: "0.2.0",
		runtime: "wasm",
		entry: { js: "ext.js", wasm: ["ext.core.wasm"] },
		permissions: { repo: "none" },
	},
);

export const DEMO_ISSUES_INSTALLATION: InstallationDto = {
	id: `i_${mockUlid(610)}`,
	extId: manifest.id,
	version: manifest.version,
	nodeId: REPO_ID,
	nodePath: "acme/platform/router",
	mode: "enforce",
	storageScope: "repo",
	config: {},
	grants: manifest.permissions,
	backgroundRole: 20,
	locked: false,
	backfill: "none",
	installedBy: OWNER_ID,
	installedAt: MOCK_NOW,
};

export const DEMO_CATALOG = {
	...EMPTY_CATALOG,
	packages: [{ ...samplePackage(manifest, MOCK_NOW), bundled: false }],
	installations: [DEMO_ISSUES_INSTALLATION],
};

const project = (name: string, root: string, deps: string[]): ProjectDto => ({
	key: root,
	name,
	slug: name,
	root,
	source: "tartan",
	nameSource: "directory",
	layers: [],
	deps,
	dependents: [],
	manifestPath: `${root}/tartan.cue`,
	issues: [],
	extensions: {},
});

export const DEMO_PROJECTS: readonly ProjectDto[] = [
	project("api", "services/api", ["shared"]),
	project("web", "apps/web", ["shared"]),
	project("shared", "packages/shared", []),
];

export const demoIssues = (now = MOCK_NOW): Record<string, Issue[]> => {
	const issue = (
		number: number,
		title: string,
		project: string | null,
		age: number,
		state: Issue["state"] = "open",
	): Issue => ({
		number,
		title,
		project,
		state,
		author: { kind: "user", id: OWNER_ID },
		createdAt: now - age,
		updatedAt: now - age,
		closedAt: state === "closed" ? now - age : null,
		body: "Example issue for the local preview.",
	});
	return {
		[REPO_ID]: [
			issue(3, "Document the router setup", null, 60 * 60_000),
			issue(
				2,
				"Add rate limits to the public API",
				"services/api",
				3 * 60 * 60_000,
			),
			issue(
				1,
				"Improve the web loading state",
				"apps/web",
				24 * 60 * 60_000,
				"closed",
			),
		],
	};
};
