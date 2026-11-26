import React, { useEffect, useState } from "react";
import { DownloadCloud, Eye, Loader2, RotateCcw } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useUiStore } from "../../store/useUiStore";
import { getAppVersion } from "../../services/tauriBridge";
import {
  clearSkippedUpdateVersion,
  runManualUpdateCheck,
} from "../../hooks/useUpdateChecker";
import { buildMockUpdateResult } from "../../utils/updatePolicy";

export const UpdateSettingsSection = React.memo(function UpdateSettingsSection() {
  const skippedVersion = useAppStore((s) => s.settings.skipped_update_version);
  const openUpdateModal = useUiStore((s) => s.openUpdateModal);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);

  const [appVersion, setAppVersion] = useState<string>("0.4.4");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let active = true;
    void getAppVersion()
      .then((v) => {
        if (active && v) setAppVersion(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const handleCheckNow = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const res = await runManualUpdateCheck();
      if (res?.has_update) {
        setSettingsOpen(false);
      }
    } finally {
      setChecking(false);
    }
  };

  const handlePreviewMock = () => {
    setSettingsOpen(false);
    openUpdateModal(buildMockUpdateResult(appVersion));
  };

  return (
    <div
      className="pt-4 space-y-2.5"
      style={{ borderTop: "1px solid var(--divider)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <DownloadCloud
            className="w-3.5 h-3.5"
            style={{ color: "var(--accent)" }}
          />
          <span
            className="font-bold text-xs"
            style={{ color: "var(--text-primary)" }}
          >
            앱 업데이트 (GitHub Releases)
          </span>
        </div>
        <span
          className="text-[11px] font-mono-code px-2 py-0.5 rounded-full"
          style={{
            background: "var(--pill-bg)",
            color: "var(--text-muted)",
          }}
        >
          현재 v{appVersion}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {skippedVersion
            ? `건너뛴 버전: v${skippedVersion} (더 높은 버전 출시 시 자동 알림)`
            : "앱 실행 시 최신 GitHub 릴리즈를 자동으로 확인합니다."}
        </p>

        <div className="flex items-center gap-1.5">
          {skippedVersion && (
            <button
              type="button"
              onClick={() => void clearSkippedUpdateVersion()}
              className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <RotateCcw className="w-3 h-3" />
              <span>Skip 해제</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleCheckNow()}
            disabled={checking}
            className="jjdr-pill inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            style={{ color: "var(--accent)" }}
          >
            {checking ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <DownloadCloud className="w-3 h-3" />
            )}
            <span>{checking ? "확인 중..." : "지금 업데이트 확인"}</span>
          </button>
          {import.meta.env.DEV && (
            <button
              type="button"
              onClick={handlePreviewMock}
              className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium cursor-pointer"
              style={{ color: "var(--text-muted)" }}
              title="DEV 모드 전용: 업데이트 팝업 UI 즉시 미리보기"
            >
              <Eye className="w-3 h-3" />
              <span>Mock 미리보기</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
