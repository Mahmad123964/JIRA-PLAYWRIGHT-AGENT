import { test, expect } from "@playwright/test";

/**
 * Deliberately trivial passing spec with no `page` fixture, so executing it
 * requires no browser install and no network. It exists so the execution
 * engine can be driven end to end on the default artifact-capture path.
 */
test("artifact capture self check", () => {
  expect(1 + 1).toBe(2);
});
