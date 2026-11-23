import { Suspense, lazy } from "react";
import { useHerdrSync } from "./hooks/useHerdrSync";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { useUiStore } from "./store/useUiStore";
import { TopStatusBar } from "./components/layout/TopStatusBar";
import { SidebarProjects } from "./components/layout/SidebarProjects";
import { HerdrHealthBanner } from "./components/shared/HerdrHealthBanner";
import { AttentionBoard } from "./components/attention/AttentionBoard";
import { RadarBoardView } from "./components/board/RadarBoardView";
import { CommandPalette } from "./components/modals/CommandPalette";
import { ProjectModal } from "./components/modals/ProjectModal";
import { CreateWorktreeModal } from "./components/modals/CreateWorktreeModal";
import { LaunchSessionModal } from "./components/modals/LaunchSessionModal";
import { TeardownModal } from "./components/modals/TeardownModal";
import { DiffPreviewModal } from "./components/modals/DiffPreviewModal";
import { SettingsModal } from "./components/modals/SettingsModal";

const AttachedTerminalDrawer = lazy(() =>
  import("./components/terminal/AttachedTerminalDrawer").then((m) => ({
    default: m.AttachedTerminalDrawer,
  }))
);

export function App() {
  useHerdrSync();
  useGlobalShortcuts();

  const viewMode = useUiStore((s) => s.viewMode);
  const attachedAddress = useUiStore((s) => s.attachedAddress);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const toast = useUiStore((s) => s.toast);
  const clearToast = useUiStore((s) => s.clearToast);

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0b0c0e] text-[#f4f4f5] overflow-hidden">
      <TopStatusBar />
      <HerdrHealthBanner />

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {sidebarOpen && <SidebarProjects />}
        <main className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
          {viewMode === "radar" ? <RadarBoardView /> : <AttentionBoard />}
          {attachedAddress && (
            <Suspense
              fallback={
                <div className="w-[52%] min-w-[460px] border-l border-[#1c1f26] bg-[#0b0c0e] flex items-center justify-center text-xs text-[#71717a]">
                  Opening terminal...
                </div>
              }
            >
              <AttachedTerminalDrawer />
            </Suspense>
          )}
        </main>
      </div>

      {/* Modals */}
      <CommandPalette />
      <ProjectModal />
      <CreateWorktreeModal />
      <LaunchSessionModal />
      <TeardownModal />
      <DiffPreviewModal />
      <SettingsModal />

      {/* Crisp Zero-Blur Obsidian Toast */}
      {toast && (
        <div
          onClick={clearToast}
          className={`fixed bottom-4 right-4 z-50 px-3.5 py-2 rounded-lg border text-xs font-medium cursor-pointer ${
            toast.kind === "error"
              ? "bg-[#1a1114] border-[#4a232c] text-[#f87171]"
              : toast.kind === "success"
              ? "bg-[#111c17] border-[#1f3d2e] text-[#34d399]"
              : "bg-[#14171d] border-[#272b36] text-[#e4e4e7]"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
