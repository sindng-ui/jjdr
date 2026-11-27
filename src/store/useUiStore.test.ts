import { beforeEach, describe, expect, it } from "vitest";
import { useUiStore } from "./useUiStore";

describe("useUiStore Zen view transitions", () => {
  beforeEach(() => {
    useUiStore.setState({
      startupReady: true,
      viewMode: "zen",
      zenModeTab: "inbox",
      zenDispatchStep: "pick_project",
      zenDispatchProjectId: null,
      zenHiredSolo: null,
      zenHiringState: null,
    });
  });

  it("opens Zen in inbox tab when switching from radar via setViewMode (button / Ctrl+3)", () => {
    const store = useUiStore.getState();
    store.openZenDispatch("proj-1");
    expect(useUiStore.getState().zenModeTab).toBe("dispatch");

    store.setViewMode("radar");
    expect(useUiStore.getState().viewMode).toBe("radar");

    store.setViewMode("zen");
    const after = useUiStore.getState();
    expect(after.viewMode).toBe("zen");
    expect(after.zenModeTab).toBe("inbox");
    expect(after.zenDispatchProjectId).toBeNull();
    expect(after.zenDispatchStep).toBe("pick_project");
  });

  it("opens Zen in inbox tab when switching from queue via setViewMode or toggleViewMode (Ctrl+M)", () => {
    const store = useUiStore.getState();
    store.openZenDispatch("proj-1");
    store.setViewMode("queue");
    expect(useUiStore.getState().viewMode).toBe("queue");

    store.toggleViewMode();
    const afterToggle = useUiStore.getState();
    expect(afterToggle.viewMode).toBe("zen");
    expect(afterToggle.zenModeTab).toBe("inbox");

    store.openZenDispatch("proj-2");
    store.setViewMode("queue");
    store.setViewMode("zen");
    expect(useUiStore.getState().zenModeTab).toBe("inbox");
  });

  it("preserves explicit dispatch entry via openZenDispatch (Ctrl+Shift+D) and startup routing", () => {
    const store = useUiStore.getState();
    store.setViewMode("radar");
    store.openZenDispatch();
    expect(useUiStore.getState().viewMode).toBe("zen");
    expect(useUiStore.getState().zenModeTab).toBe("dispatch");

    useUiStore.setState({ startupReady: false, viewMode: "zen", zenModeTab: "inbox" });
    store.completeStartupRouting("dispatch");
    expect(useUiStore.getState().viewMode).toBe("zen");
    expect(useUiStore.getState().zenModeTab).toBe("dispatch");
  });
});
