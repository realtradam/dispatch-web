import type { Environment } from "vitest/environments";
import { builtinEnvironments } from "vitest/environments";

/** Real runtime fetch and AbortSignal must belong to the same implementation.
 * jsdom supplies DOM APIs but replaces these globals with an incompatible realm.
 * Keep the runtime's pair for this opt-in real-network component probe only.
 */
export default {
  name: "text-file-jsdom",
  transformMode: "web",
  async setup(global, options) {
    const controller = global.AbortController;
    const signal = global.AbortSignal;
    const environment = await builtinEnvironments.jsdom.setup(global, options);
    global.AbortController = controller;
    global.AbortSignal = signal;
    return environment;
  },
} satisfies Environment;
