// Mock activity events must use the kernel's real envelope and payload shape.
import { describe, expect, it } from "vitest";
import { parseEvent } from "@tartan/contract/events.ts";
import { EVENTS } from "../src/api/mock/events.ts";

describe("mock activity events", () => {
	it("are valid repository pushes in sequence", () => {
		for (const event of EVENTS) {
			const parsed = parseEvent(event);
			expect(parsed.ok, `${event.type}: ${JSON.stringify(parsed)}`).toBe(true);
			expect(event.data).toMatchObject({ target: "repo" });
		}
		expect(EVENTS.map((event) => event.seq)).toEqual([1, 2, 3]);
	});
});
