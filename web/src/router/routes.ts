// SPA route table (WP18, WP19).
//
// URL grammar: a node (user, group or repo) lives at
// `/<path>`, and its views at `/<path>/-/<view>` (GitLab-style separator).
// Forge-level pages live under `/-/`. The Worker claims `/-/api`, `/-/auth`,
// `/-/live`, `/-/mcp`, `/-/oauth`, `/-/health`, `/-/raw`, `/.well-known`, git
// paths (`*.git/…`, `/-/lanes/<id>.git/…`) and unsafe `/-/setup/*` methods
// before assets; everything else reaches this table through the SPA fallback.
// The kernel re-derives node, repo, ref and path server-side; route params are
// hints only.
//
// The forge shell (`forge/ForgeApp.vue`) owns the forge root, nodes and their
// projects, issues, activity and new-node pages. Repo browsing and administration
// render inside the same shell. `:` joins a project to its repo inside one path
// segment, so `router/address.ts` splits it before it reaches the kernel.
//
// The remaining views belong to WP18.

import type { RouteRecordRaw } from "vue-router";
import ForgeApp from "../forge/ForgeApp.vue";

/**
 * One node-path segment. Slugs match `[a-z0-9][a-z0-9-]*` (`nodes.slug`), so
 * a segment never starts with `-`, and the first `/-/` in a
 * URL always separates the node path from its view. The pattern is looser than
 * the slug grammar on purpose: the kernel answers 404 for unknown nodes.
 */
export const NODE_SEGMENT = "[^/-][^/]*";

/** `/<nodePath>` (one or more segments) followed by `suffix`. */
const node = (suffix = ""): string => `/:nodePath(${NODE_SEGMENT})+${suffix}`;

export type RouteOwner = "WP18";

export type ViewMeta = {
	readonly title: string;
	readonly owner: RouteOwner;
	/** The page belongs in the forge shell. */
	readonly forge?: boolean;
	/** The route's component is rendered as content inside the shell. */
	readonly forgeContent?: boolean;
};

const meta = (title: string, owner: RouteOwner = "WP18"): ViewMeta => ({
	title,
	owner,
});

const forgeMeta = (title: string): ViewMeta => ({
	...meta(title),
	forge: true,
});

const contentMeta = (title: string): ViewMeta => ({
	...forgeMeta(title),
	forgeContent: true,
});

/** The shell's pages, at the forge root and on every node. */
const forgePages = (
	prefix: string,
	at: (suffix: string) => string,
): readonly RouteRecordRaw[] =>
	[
		["projects", "/-/projects", "Projects"],
		["activity", "/-/activity", "Activity"],
		["new", "/-/new/:kind(group|repo)", "New"],
		["issues", "/-/issues", "Issues"],
		["issue-new", "/-/issues/new", "New issue"],
		["issue", "/-/issues/:n(\\d+)", "Issue"],
		// Issues are the shell's whole page, so nothing below it is an extension tab.
		["issue-unknown", "/-/issues/:rest(.*)+", "Issue"],
	].map(([name, suffix, title]) => ({
		path: at(suffix!),
		name: `${prefix}-${name}`,
		component: ForgeApp,
		meta: forgeMeta(title!),
	}));

export const routes: readonly RouteRecordRaw[] = [
	// The forge root: everything the owner keeps here.
	{
		path: "/",
		name: "home",
		component: ForgeApp,
		meta: forgeMeta("Everything"),
	},
	...forgePages("forge", (suffix) => suffix),

	// First run and sign-in.
	{
		path: "/-/setup",
		name: "setup",
		component: () => import("../views/setup/SetupWizardView.vue"),
		meta: meta("Set up your forge"),
	},
	{
		path: "/-/login",
		name: "login",
		component: () => import("../views/auth/LoginView.vue"),
		meta: meta("Sign in"),
	},
	{
		path: "/-/invite/:code",
		name: "invite",
		component: () => import("../views/auth/InviteView.vue"),
		meta: meta("Invite"),
	},

	// Forge administration.
	{
		path: "/-/explore",
		name: "explore",
		redirect: "/",
	},
	{
		path: "/-/extensions",
		name: "extensions",
		component: () => import("../views/admin/ExtensionsView.vue"),
		meta: contentMeta("Extensions"),
	},
	{
		path: "/-/extensions/:installationId",
		name: "extension",
		component: () => import("../views/admin/ExtensionInstallationView.vue"),
		meta: contentMeta("Extension installation"),
	},
	{
		path: "/-/settings",
		name: "settings",
		component: () => import("../views/admin/SettingsView.vue"),
		meta: contentMeta("Settings"),
	},

	// Shell utilities.
	{
		path: "/-/leaving",
		name: "leaving",
		component: () => import("../views/shell/LeavingView.vue"),
		meta: meta("Leaving Tartan"),
	},
	{
		path: "/-/:rest(.*)*",
		name: "forge-not-found",
		component: () => import("../views/shell/NotFoundView.vue"),
		meta: meta("Not found"),
	},

	// Reserved root slugs that people type by hand.
	{ path: "/explore", redirect: { name: "explore" } },
	{ path: "/settings", redirect: { name: "settings" } },
	{ path: "/setup", redirect: { name: "setup" } },
	{ path: "/login", redirect: { name: "login" } },

	// Nodes: users, groups and repos.
	{
		path: node(),
		name: "node",
		component: ForgeApp,
		meta: forgeMeta("Namespace"),
	},
	...forgePages("node", node),
	{
		path: node("/-/settings"),
		name: "node-settings",
		component: () => import("../views/node/NodeSettingsView.vue"),
		meta: contentMeta("Node settings"),
	},
	// Repo code views (WP18; kernel browse API, WP3).
	{
		path: node("/-/tree/:refPath*"),
		name: "repo-tree",
		component: () => import("../views/repo/RepoTreeView.vue"),
		meta: contentMeta("Files"),
	},
	{
		path: node("/-/blob/:refPath+"),
		name: "repo-file",
		component: () => import("../views/repo/RepoFileView.vue"),
		meta: contentMeta("File"),
	},
	{
		path: node("/-/commits/:refPath*"),
		name: "repo-log",
		component: () => import("../views/repo/RepoLogView.vue"),
		meta: contentMeta("History"),
	},
	{
		path: node("/-/commit/:sha"),
		name: "repo-commit",
		component: () => import("../views/repo/RepoCommitView.vue"),
		meta: contentMeta("Commit"),
	},
	{
		path: node("/-/compare/:range+"),
		name: "repo-compare",
		component: () => import("../views/repo/RepoCompareView.vue"),
		meta: contentMeta("Compare revisions"),
	},

	// Extension-contributed node.tab / repo.tab pages. Manifest routes match
	// `^[a-z0-9-/*]{1,64}$`; kernel views above win because
	// static segments outrank params.
	{
		path: node("/-/:tab([a-z0-9-]+)/:rest*"),
		name: "slot-tab",
		component: () => import("../views/node/SlotTabView.vue"),
		meta: contentMeta("Extension tab"),
	},

	{
		path: "/:pathMatch(.*)*",
		name: "not-found",
		component: () => import("../views/shell/NotFoundView.vue"),
		meta: meta("Not found"),
	},
];

/** Document title for a route's meta (meta values are `unknown` to vue-router). */
export const pageTitle = (routeMeta: Record<PropertyKey, unknown>): string => {
	const title = routeMeta["title"];
	return typeof title === "string" && title !== ""
		? `${title} · Tartan`
		: "Tartan";
};
