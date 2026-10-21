import type { SurfaceSpec } from "@dispatch/ui-contract";
import { describe, expect, it, vi } from "vitest";
import { createSurfaceProtocol } from "./surface-protocol.svelte";

const spec: SurfaceSpec = { id: "s1", region: "inline", title: "Snapshot", fields: [] };

function fixture() {
  let focusedId = "c1";
  const surfaces = createSurfaceProtocol({
    focusedConversationId: () => focusedId,
    send: vi.fn(),
  });
  surfaces.handleServerMessage({
    type: "catalog",
    catalog: [{ id: "s1", region: "inline", title: "Snapshot", scope: "conversation" }],
  });
  return {
    surfaces,
    focus(id: string) {
      focusedId = id;
      surfaces.syncSubscriptions();
    },
  };
}

describe("conversation-scoped surface lookup", () => {
  it("keeps retained rendering but withholds another conversation's snapshot from decisions", () => {
    const { surfaces, focus } = fixture();
    expect(surfaces.surfaceSpecOp("s1", "c1")).toBeNull();
    surfaces.handleServerMessage({ type: "surface", conversationId: "c1", spec });
    expect(surfaces.surfaceSpecOp("s1", "c1")).toEqual(spec);
    focus("c2");
    expect(surfaces.surfaceSpecOp("s1")).toEqual(spec);
    expect(surfaces.surfaceSpecOp("s1", "c2")).toBeNull();
    surfaces.handleServerMessage({ type: "surface", conversationId: "c1", spec });
    expect(surfaces.surfaceSpecOp("s1", "c2")).toBeNull();
    const updated = { ...spec, title: "Current" };
    surfaces.handleServerMessage({
      type: "update",
      update: { surfaceId: "s1", conversationId: "c2", spec: updated },
    });
    expect(surfaces.surfaceSpecOp("s1", "c2")).toEqual(updated);
    expect(surfaces.surfaceSpecOp("s1", "c1")).toBeNull();
  });

  it("does not treat an unscoped snapshot as known conversation-specific data", () => {
    const { surfaces } = fixture();
    surfaces.handleServerMessage({ type: "surface", spec });
    expect(surfaces.surfaceSpecOp("s1")).toEqual(spec);
    expect(surfaces.surfaceSpecOp("s1", "c1")).toBeNull();
  });

  it("drops snapshot scope on explicit unsubscribe and catalog removal", () => {
    const { surfaces } = fixture();
    surfaces.handleServerMessage({ type: "surface", conversationId: "c1", spec });
    surfaces.unsubscribeSurfaceOp("s1");
    expect(surfaces.surfaceSpecOp("s1", "c1")).toBeNull();
    surfaces.subscribeSurfaceOp("s1");
    expect(surfaces.surfaceSpecOp("s1", "c1")).toBeNull();
    surfaces.handleServerMessage({ type: "surface", conversationId: "c1", spec });
    expect(surfaces.surfaceSpecOp("s1", "c1")).toEqual(spec);
    surfaces.handleServerMessage({ type: "catalog", catalog: [] });
    expect(surfaces.surfaceSpecOp("s1", "c1")).toBeNull();
  });
});

describe("surface subscription budget", () => {
  it("bounds a large catalog and releases old slots before subscribing a replacement catalog", () => {
    const live = new Set<string>();
    let peak = 0;
    const surfaces = createSurfaceProtocol({
      focusedConversationId: () => "chat",
      send(message) {
        if (message.type === "subscribe") live.add(message.surfaceId);
        if (message.type === "unsubscribe") live.delete(message.surfaceId);
        peak = Math.max(peak, live.size);
      },
    });
    for (const prefix of ["old", "new"]) {
      surfaces.handleServerMessage({
        type: "catalog",
        catalog: Array.from({ length: 339 }, (_, i) => ({
          id: `${prefix}-${i}`,
          region: "inline",
          title: "Surface",
          scope: "global" as const,
        })),
      });
      expect(live.size).toBe(128);
      expect([...live].every((id) => id.startsWith(prefix))).toBe(true);
    }
    surfaces.subscribeSurfaceOp("overflow");
    expect(live.has("overflow")).toBe(false);
    expect(peak).toBe(128);
  });
});
