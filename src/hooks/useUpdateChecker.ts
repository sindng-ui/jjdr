import { useEffect, useRef } from "react";
import {
  checkForUpdate,
  isTauriRuntime,
  saveSettings,
} from "../services/tauriBridge";
import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import { normalizeVersion, shouldShowUpdatePopup } from "../utils/updatePolicy";
import type { UpdateCheckResult } from "../types/domain";

const STARTUP_CHECK_DELAY_MS = 2500;

export async function runManualUpdateCheck(): Promise<UpdateCheckResult | null> {
  const ui = useUiStore.getState();
  if (!isTauriRuntime()) {
    ui.showToast("데스크톱 앱(Tauri) 환경에서만 업데이트를 확인할 수 있습니다.", "info");
    return null;
  }

  try {
    const result = await checkForUpdate();
    ui.setUpdateInfo(result);
    if (shouldShowUpdatePopup(result, null, true)) {
      ui.setUpdateModalOpen(true);
    } else {
      ui.showToast(`최신 버전을 사용 중입니다 (v${result.current_version})`, "success");
    }
    return result;
  } catch (err) {
    ui.showToast(`업데이트 확인 실패: ${String(err)}`, "error");
    return null;
  }
}

export async function skipUpdateVersion(version: string): Promise<void> {
  const norm = normalizeVersion(version);
  if (!norm) return;
  const current = useAppStore.getState().settings;
  const next = { ...current, skipped_update_version: norm };
  useAppStore.getState().setSettings(next);
  await saveSettings(next).catch(() => {});
  useUiStore.getState().setUpdateModalOpen(false);
  useUiStore
    .getState()
    .showToast(`v${norm} 업데이트를 건너뛰었습니다.`, "info");
}

export async function clearSkippedUpdateVersion(): Promise<void> {
  const current = useAppStore.getState().settings;
  if (!current.skipped_update_version) return;
  const next = { ...current, skipped_update_version: null };
  useAppStore.getState().setSettings(next);
  await saveSettings(next).catch(() => {});
  useUiStore
    .getState()
    .showToast("건너뛴 업데이트 버전 기록을 초기화했습니다.", "info");
}

/**
 * Performs a single non-blocking GitHub Release check shortly after initial hydration
 * and startup routing complete, so the update modal never races with boot transitions.
 */
export function useUpdateChecker() {
  const hydrated = useAppStore((s) => s.hydrated);
  const startupReady = useUiStore((s) => s.startupReady);
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!hydrated || !startupReady || checkedRef.current || !isTauriRuntime()) return;
    checkedRef.current = true;

    let cancelled = false;
    const timer = setTimeout(() => {
      void checkForUpdate()
        .then((result) => {
          if (cancelled) return;
          const ui = useUiStore.getState();
          ui.setUpdateInfo(result);
          const skipped = useAppStore.getState().settings.skipped_update_version;
          if (shouldShowUpdatePopup(result, skipped, false)) {
            ui.setUpdateModalOpen(true);
          }
        })
        .catch((err) => {
          // Stay completely silent on offline / rate-limit errors during startup
          console.debug("[jjdr:updater] Startup check skipped:", err);
        });
    }, STARTUP_CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hydrated, startupReady]);
}
