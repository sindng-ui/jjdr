import type { UiStoreState } from "../store/useUiStore";

export type BlockingModalState = Pick<
  UiStoreState,
  | "settingsOpen"
  | "commandPaletteOpen"
  | "quickFileOpen"
  | "workspaceSearchOpen"
  | "projectModalProject"
  | "createWorktreeProjectId"
  | "editWorktreeTarget"
  | "launchTarget"
  | "teardownTarget"
  | "diffTarget"
  | "markdownViewerTarget"
  | "codeViewerTarget"
  | "reviewPickerTarget"
  | "updateModalOpen"
  | "contextMenu"
>;

/**
 * Pure predicate returning true whenever any blocking modal or context menu is open,
 * preventing background shortcuts or terminal auto-focus from stealing input.
 */
export function hasBlockingModalOpen(ui: BlockingModalState): boolean {
  return Boolean(
    ui.updateModalOpen ||
      ui.settingsOpen ||
      ui.commandPaletteOpen ||
      ui.quickFileOpen ||
      ui.workspaceSearchOpen ||
      ui.projectModalProject ||
      ui.createWorktreeProjectId ||
      ui.editWorktreeTarget ||
      ui.launchTarget ||
      ui.teardownTarget ||
      ui.diffTarget ||
      ui.markdownViewerTarget ||
      ui.codeViewerTarget ||
      ui.reviewPickerTarget ||
      ui.contextMenu
  );
}
