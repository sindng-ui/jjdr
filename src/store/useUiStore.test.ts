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
      updateInfo: null,
      updateModalOpen: false,
      updateModalBusy: false,
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

    useUiStore.setState({ startupReady: false, viewMode: "zen", zenModeTab: "dispatch" });
    store.completeStartupRouting();
    expect(useUiStore.getState().startupReady).toBe(true);
    expect(useUiStore.getState().viewMode).toBe("zen");
    expect(useUiStore.getState().zenModeTab).toBe("inbox");
  });

  it("preserves updateModalOpen across Zen transitions and blocks closing while busy", () => {
    const store = useUiStore.getState();
    store.setUpdateModalOpen(true);
    expect(useUiStore.getState().updateModalOpen).toBe(true);

    // Startup routing & Zen Dispatch transitions must never dismiss the update modal
    store.completeStartupRouting("inbox");
    store.openZenDispatch("proj-1");
    store.returnToZenInbox();
    expect(useUiStore.getState().updateModalOpen).toBe(true);

    // Closing is refused while download/install is busy
    store.setUpdateModalBusy(true);
    store.setUpdateModalOpen(false);
    expect(useUiStore.getState().updateModalOpen).toBe(true);

    // Once not busy, explicit close succeeds
    store.setUpdateModalBusy(false);
    store.setUpdateModalOpen(false);
    expect(useUiStore.getState().updateModalOpen).toBe(false);
  });
});
