import { afterEach, describe, expect, it, vi } from "vitest";
import DemoIndicator from "../src/components/DemoIndicator.vue";
import { mount, text } from "./support/renderer.ts";

afterEach(() => vi.unstubAllEnvs());

describe("demo indicator", () => {
	it("appears only when the mock forge is enabled", () => {
		vi.stubEnv("VITE_TARTAN_MOCK", "1");
		const demo = mount(DemoIndicator);
		expect(text(demo.root)).toBe("Demo data");
		demo.unmount();
		vi.stubEnv("VITE_TARTAN_MOCK", "");
		const live = mount(DemoIndicator);
		expect(text(live.root)).toBe("");
		live.unmount();
	});
});
