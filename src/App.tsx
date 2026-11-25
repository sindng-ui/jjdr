import { Suspense, lazy } from "react";
import { useHerdrSync } from "./hooks/useHerdrSync";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useFileIndexWarmup } from "./hooks/useFileIndexWarmup";
import { useUiStore } from "./store/useUiStore";
import { TopStatusBar } from "./components/layout/TopStatusBar";
import { SidebarProjects } from "./components/layout/SidebarProjects";
import { HerdrHealthBanner } from "./components/shared/HerdrHealthBanner";
import { StartupSplash } from "./components/shared/StartupSplash";
import { AttentionBoard } from "./components/attention/AttentionBoard";
import { RadarBoardView } from "./components/board/RadarBoardView";
import { ZenModeView } from "./components/zen/ZenModeView";
import { WorktreeContextMenu } from "./components/board/WorktreeContextMenu";
import { CommandPalette } from "./components/modals/CommandPalette";
import { QuickFileModal } from "./components/modals/QuickFileModal";
import { ProjectModal } from "./components/modals/ProjectModal";
import { CreateWorktreeModal } from "./components/modals/CreateWorktreeModal";
import { EditWorktreeModal } from "./components/modals/EditWorktreeModal";
import { LaunchSessionModal } from "./components/modals/LaunchSessionModal";
import { TeardownModal } from "./components/modals/TeardownModal";
import { DiffPreviewModal } from "./components/modals/DiffPreviewModal";
import { SettingsModal } from "./components/modals/SettingsModal";

const AttachedTerminalDrawer = lazy(() =>
  import("./components/terminal/AttachedTerminalDrawer").then((m) => ({
    default: m.AttachedTerminalDrawer,
  }))
);

const MarkdownViewerModal = lazy(() =>
  import("./components/modals/MarkdownViewerModal").then((m) => ({
    default: m.MarkdownViewerModal,
  }))
);

const CodeViewerModal = lazy(() =>
  import("./components/modals/CodeViewerModal").then((m) => ({
    default: m.CodeViewerModal,
  }))
);

export function App() {
  useHerdrSync();
  useGlobalShortcuts();
  useFileIndexWarmup();

  const startupReady = useUiStore((s) => s.startupReady);
  const viewMode = useUiStore((s) => s.viewMode);
  const terminalDrawerOpen = useUiStore((s) => s.terminalDrawerOpen);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const terminalWidthPx = useUiStore((s) => s.terminalWidthPx);
  const markdownViewerTarget = useUiStore((s) => s.markdownViewerTarget);
  const codeViewerTarget = useUiStore((s) => s.codeViewerTarget);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toast = useUiStore((s) => s.toast);
  const clearToast = useUiStore((s) => s.clearToast);

  const showDrawer = terminalDrawerOpen || Boolean(attachedAddress);

  return (
    <div className="jjdr-shell h-full w-full flex flex-col overflow-hidden">
      <TopStatusBar />
      <HerdrHealthBanner />

      {/* Frameless Shell Body -> Borderless Sidebar (hidden in Zen Mode) + Floating 22px Rounded Stage */}
      <div className="flex-1 flex min-h-0 overflow-hidden px-3 pb-3 gap-3">
        {sidebarOpen && viewMode !== "zen" && <SidebarProjects />}
        <main className="jjdr-stage flex-1 rounded-[22px] flex min-w-0 min-h-0 overflow-hidden">
          {!startupReady ? (
            <StartupSplash />
          ) : viewMode === "radar" ? (
            <RadarBoardView />
          ) : viewMode === "queue" ? (
            <AttentionBoard />
          ) : (
            <ZenModeView />
          )}
          {startupReady && showDrawer && (
            <Suspense
              fallback={
                <div
                  style={
                    terminalWidthPx
                      ? { width: `${terminalWidthPx}px` }
                      : { width: "50%" }
                  }
                  className="min-w-[360px] max-w-[78%] p-2.5 pl-0 shrink-0"
                >
                  <div
                    className="h-full rounded-[18px] flex items-center justify-center text-xs"
                    style={{
                      background: "var(--term-bg)",
                      border: "1px solid var(--term-border)",
                      color: "var(--text-muted)",
                    }}
                  >
                    Opening terminal...
                  </div>
                </div>
              }
            >
              <AttachedTerminalDrawer />
            </Suspense>
          )}
        </main>
      </div>

      {/* Context Menu & Modals */}
      <WorktreeContextMenu />
      <CommandPalette />
      <QuickFileModal />
      {markdownViewerTarget && (
        <Suspense fallback={null}>
          <MarkdownViewerModal />
        </Suspense>
      )}
      {codeViewerTarget && (
        <Suspense fallback={null}>
          <CodeViewerModal />
        </Suspense>
      )}
      <ProjectModal />
      <CreateWorktreeModal />
      <EditWorktreeModal />
      <LaunchSessionModal />
      <TeardownModal />
      <DiffPreviewModal />
      <SettingsModal />

      {/* Organic Pill Toast (Zero-Blur) */}
      {toast && (
        <div
          onClick={clearToast}
          className="fixed bottom-5 right-5 z-50 px-4 py-2 rounded-full text-xs font-semibold cursor-pointer shadow-lg"
          style={
            toast.kind === "error"
              ? {
                  background: "var(--modal-bg)",
                  border: "1px solid var(--action-border)",
                  color: "var(--action-fg)",
                }
              : toast.kind === "success"
              ? {
                  background: "var(--modal-bg)",
                  border: "1px solid var(--ready-border)",
                  color: "var(--ready-fg)",
                }
              : {
                  background: "var(--modal-bg)",
                  border: "1px solid var(--modal-border)",
                  color: "var(--text-primary)",
                }
          }
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
