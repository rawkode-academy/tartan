// A mock live connection acknowledges the subscription without inventing events.
import type { LiveFrame } from "@tartan/contract/api.ts";
import type { SocketLike } from "../../live/store.ts";
import { EVENTS_HEAD } from "./events.ts";
import { REPO_ID } from "./fixtures.ts";

export const createMockConnect = () => (path: string): SocketLike => {
	const url = new URL(path, "https://forge.test");
	const repo = url.searchParams.get("repo") ?? REPO_ID;
	const head = Math.max(
		EVENTS_HEAD,
		Number(url.searchParams.get("since") ?? EVENTS_HEAD),
	);
	const socket: SocketLike = {
		onopen: null,
		onmessage: null,
		onclose: null,
		onerror: null,
		close: () => {
			clearTimeout(timer);
			socket.onclose?.({});
		},
	};
	const timer = setTimeout(() => {
		socket.onopen?.({});
		const hello: LiveFrame = { t: "hello", repo, head };
		socket.onmessage?.({ data: JSON.stringify(hello) });
	}, 50);
	return socket;
};
