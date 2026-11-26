import type { UpdateCheckResult } from "../types/domain";

export function normalizeVersion(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.trim().replace(/^[vV]/, "").trim();
}

/**
 * Determine whether the update modal should open for a check result.
 * - Manual checks ignore `skippedVersion` so users can revisit skipped releases.
 * - Automatic startup checks suppress the modal when the exact latest version was skipped.
 */
export function shouldShowUpdatePopup(
  result: UpdateCheckResult | null | undefined,
  skippedVersion: string | null | undefined,
  manual: boolean
): boolean {
  if (!result || !result.has_update) return false;
  if (manual) return true;
  const skipped = normalizeVersion(skippedVersion);
  const latest = normalizeVersion(result.latest_version);
  if (skipped && latest && skipped === latest) {
    return false;
  }
  return true;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatReleaseDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function resolveReleaseNotesMarkdown(
  notes: string | null | undefined,
  latestVersion: string
): string {
  const trimmed = notes?.trim() ?? "";
  if (trimmed.length > 0) return trimmed;
  const norm = normalizeVersion(latestVersion) || "latest";
  return `### jjdr v${norm}\n\n- 새로운 버전이 릴리즈되었습니다.\n- 자세한 변경 내역은 GitHub Releases 페이지를 확인해 주세요.`;
}

export function buildMockUpdateResult(
  currentVersion = "0.3.0"
): UpdateCheckResult {
  return {
    current_version: normalizeVersion(currentVersion) || "0.3.0",
    latest_version: "9.9.9",
    has_update: true,
    release_name: "jjdr v9.9.9 (Preview)",
    release_notes: [
      "## What's New",
      "",
      "- **GitHub Releases 자동 업데이트 팝업** 추가 (What's New Markdown 지원)",
      "- **원클릭 인스톨러 다운로드 & 실행** — 업데이트 중에도 `herdr-core` AI 세션 무손실 유지",
      "- **이 버전 건너뛰기(Skip)** 영속 저장 및 설정에서 수동 업데이트 확인 지원",
      "",
      "> [!TIP]",
      "> 현재 화면은 DEV 모드 미리보기입니다. 로컬 Mock 서버(`npm run test:update-mock`)로 실제 다운로드 진행률까지 E2E 테스트할 수 있습니다.",
    ].join("\n"),
    release_url: "https://github.com/sindng-ui/jjdr/releases/latest",
    published_at: new Date().toISOString(),
    asset_name: "jjdr_9.9.9_x64-setup.exe",
    asset_download_url: "http://127.0.0.1:18420/assets/jjdr_9.9.9_x64-setup.exe",
    asset_size_bytes: 2 * 1024 * 1024,
  };
}
