import React, { useState } from "react";
import {
  Eye,
  EyeOff,
  Loader2,
  PauseCircle,
  PlayCircle,
  PlugZap,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { useAppStore } from "../../../store/useAppStore";
import { useUiStore } from "../../../store/useUiStore";
import {
  detectTeamGithubId,
  flushTeamOutbox,
  reconnectTeamRelay,
  testTeamRelayConnection,
} from "../../../services/tauriBridge";
import { AGENT_OPTIONS } from "../../../utils/agents";
import {
  DEFAULT_AUTO_REVIEW_PROMPT,
  formatCsvTokens,
  normalizeTeamSettings,
  parseCsvTokens,
  REVIEW_PROMPT_VARIABLES,
} from "../../../utils/teamSettings";
import type {
  AppSettings,
  RelayTestResult,
  TeamOrchestrationSettings,
} from "../../../types/domain";

interface TeamOrchestrationSettingsTabProps {
  draft: AppSettings;
  onChangeDraft: (updater: (prev: AppSettings) => AppSettings) => void;
}

export const TeamOrchestrationSettingsTab = React.memo(
  function TeamOrchestrationSettingsTab({
    draft,
    onChangeDraft,
  }: TeamOrchestrationSettingsTabProps) {
    const team = normalizeTeamSettings(draft.team);
    const savedTeamEnabled = Boolean(useAppStore((s) => s.settings.team?.enabled));
    const snapshot = useAppStore((s) => s.teamSnapshot);
    const projects = useAppStore((s) => s.projects);
    const showToast = useUiStore((s) => s.showToast);

    const [showKey, setShowKey] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<RelayTestResult | null>(null);
    const [detectingId, setDetectingId] = useState(false);
    const [flushing, setFlushing] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);

    // Local text mirrors for CSV fields so users can type trailing commas smoothly
    const [labelsText, setLabelsText] = useState(() =>
      formatCsvTokens(team.reject_excluded_labels)
    );
    const [branchesText, setBranchesText] = useState(() =>
      formatCsvTokens(team.reject_excluded_branches)
    );
    const [allowedText, setAllowedText] = useState(() =>
      formatCsvTokens(team.reject_allowed_authors)
    );
    const [blockedText, setBlockedText] = useState(() =>
      formatCsvTokens(team.reject_blocked_authors)
    );

    const patchTeam = (patch: Partial<TeamOrchestrationSettings>) => {
      onChangeDraft((prev) => ({
        ...prev,
        team: {
          ...normalizeTeamSettings(prev.team),
          ...patch,
        },
      }));
    };

    const handleTestConnection = async () => {
      setTesting(true);
      setTestResult(null);
      try {
        const res = await testTeamRelayConnection(
          team.relay_url,
          team.team_key,
          team.bypass_proxy
        );
        setTestResult(res);
        if (res.ok) {
          showToast(
            `Relay 연결 성공 (${res.latency_ms}ms · 온라인 ${res.online_peers}명)`,
            "success"
          );
        } else {
          showToast(res.error || "Relay 연결 테스트 실패", "error");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(msg, "error");
      } finally {
        setTesting(false);
      }
    };

    const handleDetectGithubId = async () => {
      setDetectingId(true);
      try {
        const id = await detectTeamGithubId();
        patchTeam({ github_id_override: id });
        showToast(`GHE ID 감지됨: @${id}`, "success");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        showToast(`GHE ID 감지 실패: ${msg}`, "error");
      } finally {
        setDetectingId(false);
      }
    };

    const handleFlushOutbox = async () => {
      setFlushing(true);
      try {
        const flushed = await flushTeamOutbox();
        showToast(
          flushed > 0
            ? `대기 중이던 아웃박스 ${flushed}건을 전송했습니다`
            : "전송할 아웃박스 항목이 없습니다",
          "info"
        );
      } catch (err) {
        showToast(String(err), "error");
      } finally {
        setFlushing(false);
      }
    };

    const toggleDisabledProject = (projectId: string) => {
      const set = new Set(team.reject_disabled_project_ids);
      if (set.has(projectId)) set.delete(projectId);
      else set.add(projectId);
      patchTeam({ reject_disabled_project_ids: Array.from(set) });
    };

    const appendPromptToken = (token: string) => {
      const sep =
        team.review_prompt_template.endsWith(" ") ||
        team.review_prompt_template.endsWith("\n")
          ? ""
          : " ";
      patchTeam({
        review_prompt_template: `${team.review_prompt_template}${sep}${token}`,
      });
    };

    const connBadgeColor =
      snapshot?.state === "connected"
        ? "var(--ready-fg)"
        : snapshot?.state === "paused"
        ? "var(--warn-fg)"
        : snapshot?.state === "error"
        ? "var(--action-fg)"
        : "var(--text-muted)";

    const connBadgeBg =
      snapshot?.state === "connected"
        ? "var(--ready-soft)"
        : snapshot?.state === "paused"
        ? "var(--warn-soft)"
        : snapshot?.state === "error"
        ? "var(--action-soft)"
        : "var(--pill-bg)";

    const onlinePeerCount =
      snapshot?.peers.filter((p) => p.status === "online").length ?? 0;

    return (
      <div className="space-y-4">
        {/* Live Connection Status Banner */}
        <div
          className="rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3"
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <Users className="w-4 h-4 shrink-0" style={{ color: "var(--accent)" }} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-xs font-bold"
                  style={{ color: "var(--text-primary)" }}
                >
                  Team PR Auto-Review Relay
                </span>
                <span
                  className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full"
                  style={{ background: connBadgeBg, color: connBadgeColor }}
                >
                  {snapshot?.state ?? (team.enabled ? "connecting" : "disabled")}
                </span>
                {snapshot?.connected && (
                  <span
                    className="text-[11px] font-mono-code"
                    style={{ color: "var(--text-muted)" }}
                  >
                    온라인 {onlinePeerCount} / 전체 {snapshot.peers.length}명
                  </span>
                )}
              </div>
              <div
                className="text-[11px] mt-0.5 truncate"
                style={{ color: "var(--text-muted)" }}
              >
                {snapshot?.last_error
                  ? snapshot.last_error
                  : snapshot?.github_id
                  ? `내 계정: @${snapshot.github_id} · Device: ${snapshot.device_id.slice(0, 12)} · 등록 레포 ${snapshot.registered_repos.length}개`
                  : "공용 Relay PC 주소와 Team Key를 입력하고 Save Settings를 누르면 자동 연결됩니다."}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {savedTeamEnabled && !snapshot?.connected && (
              <button
                type="button"
                disabled={reconnecting}
                onClick={async () => {
                  setReconnecting(true);
                  try {
                    await reconnectTeamRelay();
                    showToast("Relay 재연결을 시도했습니다", "info", 1800);
                  } catch (err) {
                    showToast(String(err), "error");
                  } finally {
                    setReconnecting(false);
                  }
                }}
                className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
                style={{ color: "var(--accent)" }}
              >
                <RefreshCw className={`w-3 h-3 ${reconnecting ? "animate-spin" : ""}`} />
                Reconnect
              </button>
            )}
            {(snapshot?.outbox_pending ?? 0) > 0 && (
              <button
                type="button"
                disabled={flushing}
                onClick={() => void handleFlushOutbox()}
                className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
                style={{ color: "var(--warn-fg)" }}
              >
                <RefreshCw
                  className={`w-3 h-3 ${flushing ? "animate-spin" : ""}`}
                />
                Outbox ({snapshot?.outbox_pending})
              </button>
            )}
            <button
              type="button"
              role="switch"
              aria-checked={team.enabled}
              onClick={() => patchTeam({ enabled: !team.enabled })}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold cursor-pointer"
              style={{
                background: team.enabled ? "var(--accent)" : "var(--pill-bg)",
                color: team.enabled ? "#ffffff" : "var(--text-muted)",
                border: "1px solid var(--pill-border)",
              }}
            >
              {team.enabled ? "Enabled" : "Disabled"}
            </button>
          </div>
        </div>

        {/* Section 1: Relay Connection & Identity */}
        <div
          className="rounded-2xl p-3.5 space-y-3"
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <PlugZap className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
              <span
                className="font-bold text-xs"
                style={{ color: "var(--text-primary)" }}
              >
                1. Relay 서버 연결 & 계정 식별
              </span>
            </div>
            <button
              type="button"
              disabled={testing}
              onClick={() => void handleTestConnection()}
              className="jjdr-pill inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
              style={{ color: "var(--accent)" }}
            >
              {testing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <PlugZap className="w-3 h-3" />
              )}
              Test Connection
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Relay Server URL (공용 PC)
              </span>
              <input
                type="text"
                value={team.relay_url}
                onChange={(e) => patchTeam({ relay_url: e.target.value })}
                placeholder="http://10.x.x.x:8787"
                className="jjdr-input w-full px-3 py-1.5 rounded-xl font-mono-code text-xs"
              />
            </label>

            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                Team Shared Key
              </span>
              <div className="relative flex items-center">
                <input
                  type={showKey ? "text" : "password"}
                  value={team.team_key}
                  onChange={(e) => patchTeam({ team_key: e.target.value })}
                  placeholder="JJDR_RELAY_TEAM_KEY"
                  className="jjdr-input w-full pl-3 pr-9 py-1.5 rounded-xl font-mono-code text-xs"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  className="absolute right-2 p-1 rounded-full cursor-pointer"
                  style={{ color: "var(--text-muted)" }}
                  title={showKey ? "Hide key" : "Show key"}
                >
                  {showKey ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </label>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span
                  className="text-[11px] font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  사내 GHE ID (비우면 `gh` 자동 감지)
                </span>
                <button
                  type="button"
                  disabled={detectingId}
                  onClick={() => void handleDetectGithubId()}
                  className="text-[10px] font-semibold hover:underline cursor-pointer"
                  style={{ color: "var(--accent)" }}
                >
                  {detectingId ? "감지 중..." : "gh로 자동 감지"}
                </button>
              </div>
              <input
                type="text"
                value={team.github_id_override}
                onChange={(e) =>
                  patchTeam({ github_id_override: e.target.value })
                }
                placeholder={snapshot?.github_id || "auto-detected via gh api user"}
                className="jjdr-input w-full px-3 py-1.5 rounded-xl font-mono-code text-xs"
              />
            </div>

            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                표시 이름 (팀원 리뷰어 선택창 표시)
              </span>
              <input
                type="text"
                value={team.display_name}
                onChange={(e) => patchTeam({ display_name: e.target.value })}
                placeholder="예: 김민수 (백엔드)"
                className="jjdr-input w-full px-3 py-1.5 rounded-xl text-xs"
              />
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <label
              className="flex items-center gap-2 cursor-pointer text-[11px]"
              style={{ color: "var(--text-secondary)" }}
            >
              <input
                type="checkbox"
                checked={team.bypass_proxy}
                onChange={(e) => patchTeam({ bypass_proxy: e.target.checked })}
              />
              사내 HTTP 프록시 우회 (`no_proxy` · 사내 LAN IP 공용 PC 접속 권장)
            </label>

            <button
              type="button"
              onClick={() =>
                patchTeam({ auto_review_paused: !team.auto_review_paused })
              }
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold cursor-pointer"
              style={{
                background: team.auto_review_paused
                  ? "var(--warn-soft)"
                  : "var(--ready-soft)",
                color: team.auto_review_paused
                  ? "var(--warn-fg)"
                  : "var(--ready-fg)",
                border: "1px solid var(--pill-border)",
              }}
            >
              {team.auto_review_paused ? (
                <>
                  <PauseCircle className="w-3.5 h-3.5" />
                  Auto-Review PAUSED (수신 거절)
                </>
              ) : (
                <>
                  <PlayCircle className="w-3.5 h-3.5" />
                  Auto-Review ACTIVE
                </>
              )}
            </button>
          </div>

          {testResult && (
            <div
              className="rounded-xl px-3 py-2 text-[11px] font-mono-code"
              style={{
                background: testResult.ok
                  ? "var(--ready-soft)"
                  : "var(--action-soft)",
                color: testResult.ok ? "var(--ready-fg)" : "var(--action-fg)",
              }}
            >
              {testResult.ok
                ? `OK · v${testResult.server_version} (proto v${testResult.protocol_version}) · ${testResult.latency_ms}ms · peers ${testResult.online_peers}/${testResult.total_peers}${
                    !snapshot?.connected
                      ? " · 아직 미연결(하단 Save Settings를 눌러 적용하세요)"
                      : ""
                  }`
                : `FAIL · ${testResult.error}`}
            </div>
          )}
        </div>

        {/* Section 2: Ephemeral Worker AI / Model / Fallback & Concurrency Caps */}
        <div
          className="rounded-2xl p-3.5 space-y-3"
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
          }}
        >
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--accent)" }} />
            <span
              className="font-bold text-xs"
              style={{ color: "var(--text-primary)" }}
            >
              2. 자동 리뷰 일꾼 AI / 한도 초과 Fallback & 동시 상한
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                1순위 리뷰 AI CLI
              </span>
              <select
                value={team.primary_agent}
                onChange={(e) => patchTeam({ primary_agent: e.target.value })}
                className="jjdr-input w-full px-3 py-1.5 rounded-xl text-xs"
              >
                <option value="">프로젝트 기본 AI 상속</option>
                {AGENT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                1순위 모델 플래그 (선택 · `--model`)
              </span>
              <input
                type="text"
                value={team.primary_model}
                onChange={(e) => patchTeam({ primary_model: e.target.value })}
                placeholder="비우면 CLI 기본 모델"
                className="jjdr-input w-full px-3 py-1.5 rounded-xl font-mono-code text-xs"
              />
            </label>

            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                2순위 Fallback AI (429/한도 초과 시 자동 전환)
              </span>
              <select
                value={team.fallback_agent}
                onChange={(e) => patchTeam({ fallback_agent: e.target.value })}
                className="jjdr-input w-full px-3 py-1.5 rounded-xl text-xs"
              >
                <option value="">사용 안 함 (한도 초과 시 중단)</option>
                {AGENT_OPTIONS.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                2순위 Fallback 모델 플래그 (선택)
              </span>
              <input
                type="text"
                value={team.fallback_model}
                onChange={(e) => patchTeam({ fallback_model: e.target.value })}
                placeholder="예: gemini-2.5-pro"
                className="jjdr-input w-full px-3 py-1.5 rounded-xl font-mono-code text-xs"
              />
            </label>
          </div>

          <div className="grid grid-cols-3 gap-3 pt-1">
            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                PC 전체 동시 상한 (1~5)
              </span>
              <input
                type="number"
                min={1}
                max={5}
                value={team.global_max_auto_review_workers}
                onChange={(e) =>
                  patchTeam({
                    global_max_auto_review_workers: Number(e.target.value),
                  })
                }
                className="jjdr-input w-full px-3 py-1.5 rounded-xl font-mono-code text-xs"
              />
            </label>

            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                프로젝트당 동시 상한 (1~3)
              </span>
              <input
                type="number"
                min={1}
                max={3}
                value={team.per_project_max_workers}
                onChange={(e) =>
                  patchTeam({ per_project_max_workers: Number(e.target.value) })
                }
                className="jjdr-input w-full px-3 py-1.5 rounded-xl font-mono-code text-xs"
              />
            </label>

            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                임시 Worktree 자동 삭제 시점
              </span>
              <select
                value={team.ack_teardown_mode}
                onChange={(e) =>
                  patchTeam({
                    ack_teardown_mode:
                      e.target.value === "immediate" ? "immediate" : "on_ack",
                  })
                }
                className="jjdr-input w-full px-3 py-1.5 rounded-xl text-xs"
              >
                <option value="on_ack">Zen 도장(Ack) 시 삭제 (추천)</option>
                <option value="immediate">AI 완료 즉시 삭제</option>
              </select>
            </label>
          </div>
        </div>

        {/* Section 3: Pre-defined Review Prompt */}
        <div
          className="rounded-2xl p-3.5 space-y-2.5"
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div>
              <span
                className="font-bold text-xs"
                style={{ color: "var(--text-primary)" }}
              >
                3. Pre-defined 자동 리뷰 프롬프트 (스킬 호출 포함)
              </span>
              <p
                className="text-[11px] mt-0.5"
                style={{ color: "var(--text-muted)" }}
              >
                GHE PR 코멘트 등록과 `{"{{review_report_path}}"}` 저장 지침을 포함하면
                완료 후 내장 Markdown 뷰어로 1클릭 열람할 수 있습니다.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                patchTeam({ review_prompt_template: DEFAULT_AUTO_REVIEW_PROMPT })
              }
              className="jjdr-pill inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 cursor-pointer"
              style={{ color: "var(--text-secondary)" }}
            >
              <RotateCcw className="w-3 h-3" />
              기본값 복원
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {REVIEW_PROMPT_VARIABLES.map((v) => (
              <button
                key={v.token}
                type="button"
                onClick={() => appendPromptToken(v.token)}
                title={`${v.desc} 삽입`}
                className="px-2 py-0.5 rounded-full text-[10px] font-mono-code cursor-pointer"
                style={{
                  background: "var(--pill-bg)",
                  color: "var(--accent)",
                  border: "1px solid var(--pill-border)",
                }}
              >
                {v.token}
              </button>
            ))}
          </div>

          <textarea
            rows={6}
            value={team.review_prompt_template}
            onChange={(e) =>
              patchTeam({ review_prompt_template: e.target.value })
            }
            className="jjdr-input w-full px-3 py-2 rounded-xl font-mono-code text-[11px] leading-relaxed resize-y"
          />
        </div>

        {/* Section 4: Layer-2 Local Reject Rules */}
        <div
          className="rounded-2xl p-3.5 space-y-3"
          style={{
            background: "var(--input-bg)",
            border: "1px solid var(--input-border)",
          }}
        >
          <div className="flex items-center gap-1.5">
            <ShieldAlert
              className="w-3.5 h-3.5"
              style={{ color: "var(--warn-fg)" }}
            />
            <span
              className="font-bold text-xs"
              style={{ color: "var(--text-primary)" }}
            >
              4. 리뷰 요청 Reject 조건 (Layer-2 로컬 정책)
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                제외 라벨 (콤마 구분)
              </span>
              <input
                type="text"
                value={labelsText}
                onChange={(e) => {
                  setLabelsText(e.target.value);
                  patchTeam({
                    reject_excluded_labels: parseCsvTokens(e.target.value),
                  });
                }}
                placeholder="wip, no-ai-review, chore"
                className="jjdr-input w-full px-3 py-1.5 rounded-xl font-mono-code text-xs"
              />
            </label>

            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                제외 브랜치 패턴 (콤마 구분)
              </span>
              <input
                type="text"
                value={branchesText}
                onChange={(e) => {
                  setBranchesText(e.target.value);
                  patchTeam({
                    reject_excluded_branches: parseCsvTokens(e.target.value),
                  });
                }}
                placeholder="release/*, dependabot/*"
                className="jjdr-input w-full px-3 py-1.5 rounded-xl font-mono-code text-xs"
              />
            </label>

            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                허용 작성자 화이트리스트 (비우면 팀 전체 허용)
              </span>
              <input
                type="text"
                value={allowedText}
                onChange={(e) => {
                  setAllowedText(e.target.value);
                  patchTeam({
                    reject_allowed_authors: parseCsvTokens(e.target.value),
                  });
                }}
                placeholder="alice, bob (선택)"
                className="jjdr-input w-full px-3 py-1.5 rounded-xl font-mono-code text-xs"
              />
            </label>

            <label className="space-y-1">
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                차단 작성자 목록 (콤마 구분)
              </span>
              <input
                type="text"
                value={blockedText}
                onChange={(e) => {
                  setBlockedText(e.target.value);
                  patchTeam({
                    reject_blocked_authors: parseCsvTokens(e.target.value),
                  });
                }}
                placeholder="bot-user (선택)"
                className="jjdr-input w-full px-3 py-1.5 rounded-xl font-mono-code text-xs"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span
              className="text-[11px]"
              style={{ color: "var(--text-secondary)" }}
            >
              로컬 FIFO 대기열 최대치 (초과 시 자동 `queue_full` Reject)
            </span>
            <input
              type="number"
              min={1}
              max={20}
              value={team.reject_max_queue_size}
              onChange={(e) =>
                patchTeam({ reject_max_queue_size: Number(e.target.value) })
              }
              className="jjdr-input w-20 px-3 py-1 rounded-full text-right font-mono-code text-xs"
            />
          </div>

          {projects.length > 0 && (
            <div
              className="pt-2.5 space-y-1.5"
              style={{ borderTop: "1px solid var(--divider)" }}
            >
              <span
                className="text-[11px] font-medium"
                style={{ color: "var(--text-secondary)" }}
              >
                프로젝트별 자동 리뷰 수신 ON / OFF
              </span>
              <div className="flex flex-wrap gap-2">
                {projects.map((p) => {
                  const disabled = team.reject_disabled_project_ids.includes(
                    p.id
                  );
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleDisabledProject(p.id)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
                      style={{
                        background: disabled
                          ? "var(--pill-bg)"
                          : "var(--accent-soft)",
                        color: disabled
                          ? "var(--text-muted)"
                          : "var(--text-primary)",
                        border: `1px solid ${
                          disabled ? "var(--pill-border)" : "var(--accent)"
                        }`,
                        opacity: disabled ? 0.65 : 1,
                      }}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: p.color }}
                      />
                      <span>{p.name}</span>
                      <span className="text-[10px] opacity-80">
                        {disabled ? "OFF" : "ON"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);
