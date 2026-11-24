import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import { launchSession } from "../services/tauriBridge";
import { normalizePath } from "../workers/dashboardLogic";
import {
  findNextCardInDirection,
  type CardRect,
  type NavDirection,
} from "./spatialNav";
import {
  cardKeyForSession,
  countWorktreeLiveShells,
  getCycledSession,
  getWorktreeLiveSessions,
  MAX_SHELLS_PER_WORKTREE,
} from "./worktreeSessions";

export interface DomBoardCard extends CardRect {
  el: HTMLElement;
  addr: string | null;
  projectId: string | null;
  worktreePath: string | null;
  branch: string | null;
}

export function readBoardCards(): DomBoardCard[] {
  const nodes = Array.from(
    document.querySelectorAll<HTMLElement>("[data-jjdr-card]")
  );
  return nodes
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        key: el.dataset.jjdrCard || "",
        addr: el.dataset.jjdrSessionAddr || null,
        projectId: el.dataset.jjdrProjectId || null,
        worktreePath: el.dataset.jjdrWorktreePath || null,
        branch: el.dataset.jjdrBranch || null,
        el,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
      };
    })
    .filter((c) => c.key && c.right > c.left && c.bottom > c.top);
}

export async function openOrLaunchCard(
  card: DomBoardCard | null,
  fallbackAddr: string | null
) {
  const ui = useUiStore.getState();
  const app = useAppStore.getState();

  const addr = card?.addr ?? fallbackAddr;
  if (addr) {
    const term = app.terminals[addr];
    if (term && term.state === "live") {
      ui.setSelectedAddress(addr);
      ui.setAttachedAddress(addr);
      return;
    }
  }

  if (card?.projectId && card.worktreePath) {
    const proj = app.projects.find((p) => p.id === card.projectId);
    if (!proj) return;
    try {
      const defaultCmd = proj.default_agent || "agy";
      const argv = defaultCmd.split(/\s+/).filter(Boolean);
      const newAddr = await launchSession({
        project_id: proj.id,
        cwd: card.worktreePath,
        branch: card.branch ?? undefined,
        argv,
        name: `${proj.name}-${card.branch || "main"}`,
        autonomous: true,
      });
      app.recordLastAgent(normalizePath(card.worktreePath), argv);
      if (newAddr) {
        ui.setSelectedCardKey(card.key);
        ui.setSelectedAddress(newAddr);
        ui.setAttachedAddress(newAddr);
        ui.rememberCardSession(card.key, newAddr);
      }
    } catch (err) {
      ui.showToast(`AI 시작 실패: ${String(err)}`, "error");
    }
  }
}

export async function toggleSelectedTerminal(fromXterm: boolean) {
  const ui = useUiStore.getState();

  if (fromXterm && (ui.terminalDrawerOpen || ui.attachedAddress)) {
    ui.closeTerminalDrawer();
    (document.activeElement as HTMLElement | null)?.blur();
    return;
  }

  let currentCard: DomBoardCard | null = null;
  let targetAddr: string | null = ui.selectedAddress;

  if (ui.viewMode === "radar") {
    const cards = readBoardCards();
    currentCard =
      cards.find((c) => c.key === ui.selectedCardKey) ?? cards[0] ?? null;
    if (currentCard) {
      ui.setSelectedCardKey(currentCard.key);
      targetAddr = currentCard.addr;
      ui.setSelectedAddress(targetAddr);
    }
  }

  if (
    (ui.terminalDrawerOpen || ui.attachedAddress) &&
    (!targetAddr || ui.attachedAddress === targetAddr)
  ) {
    ui.closeTerminalDrawer();
    (document.activeElement as HTMLElement | null)?.blur();
    return;
  }

  await openOrLaunchCard(currentCard, targetAddr);
}

export function moveRadarSpatial(
  dir: NavDirection,
  syncAttachedPane: boolean
) {
  const cards = readBoardCards();
  if (cards.length === 0) return;

  const ui = useUiStore.getState();
  const nextKey = findNextCardInDirection(cards, ui.selectedCardKey, dir);
  if (!nextKey) return;

  const nextCard = cards.find((c) => c.key === nextKey);
  if (!nextCard) return;

  ui.setSelectedCardKey(nextCard.key);
  ui.setSelectedAddress(nextCard.addr);
  nextCard.el.scrollIntoView({ block: "nearest", behavior: "smooth" });

  if (syncAttachedPane && (ui.terminalDrawerOpen || ui.attachedAddress)) {
    if (nextCard.addr) {
      const term = useAppStore.getState().terminals[nextCard.addr];
      if (term && term.state === "live") {
        ui.setAttachedAddress(nextCard.addr);
        return;
      }
    }
    // Instant 0ms empty drawer state when passing over empty cards (#11, #13)
    ui.detachToEmptyDrawer();
  }
}

export function jumpToNextActionable(delta: 1 | -1 = 1) {
  const { allSessions } = useAppStore.getState().computed;
  const actionable = allSessions.filter(
    (s) => s.bucket === "needs_you" || s.bucket === "ready"
  );
  if (actionable.length === 0) {
    useUiStore.getState().showToast("확인할 작업이 없습니다!", "success");
    return;
  }
  const ui = useUiStore.getState();
  const curIdx = actionable.findIndex((s) => s.address === ui.selectedAddress);
  const nextIdx =
    curIdx === -1
      ? delta > 0
        ? 0
        : actionable.length - 1
      : (curIdx + delta + actionable.length) % actionable.length;
  const next = actionable[nextIdx];
  if (ui.selectedProjectId && next.projectId !== ui.selectedProjectId) {
    ui.setSelectedProjectId(null);
  }
  ui.setSelectedAddress(next.address);
  if (ui.viewMode === "radar" && next.projectId) {
    const syncRadarCard = () => {
      const cards = readBoardCards();
      const match = cards.find((c) => c.addr === next.address);
      if (match) {
        useUiStore.getState().setSelectedCardKey(match.key);
        match.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        return true;
      }
      return false;
    };
    if (!syncRadarCard()) {
      requestAnimationFrame(() => {
        syncRadarCard();
      });
    }
  }
  if ((ui.terminalDrawerOpen || ui.attachedAddress) && next.terminal.state === "live") {
    ui.setAttachedAddress(next.address);
  }
}

export function moveQueueSelection(delta: number, syncAttachedPane: boolean) {
  const sessions = useAppStore.getState().computed.sessions;
  if (sessions.length === 0) return;
  const ui = useUiStore.getState();
  const curIdx = sessions.findIndex((s) => s.address === ui.selectedAddress);
  const nextIdx =
    curIdx === -1
      ? delta > 0
        ? 0
        : sessions.length - 1
      : (curIdx + delta + sessions.length) % sessions.length;
  const next = sessions[nextIdx];
  ui.setSelectedAddress(next.address);

  if (
    syncAttachedPane &&
    (ui.terminalDrawerOpen || ui.attachedAddress) &&
    next.terminal.state === "live"
  ) {
    ui.setAttachedAddress(next.address);
  }
}

export function cycleCurrentWorktreeTab(delta: 1 | -1) {
  const ui = useUiStore.getState();
  if (!ui.attachedAddress) return;
  const allSessions = useAppStore.getState().computed.allSessions;
  const current =
    allSessions.find((s) => s.address === ui.attachedAddress) ?? null;
  if (!current) return;

  const tabs = getWorktreeLiveSessions(allSessions, current);
  const next = getCycledSession(tabs, ui.attachedAddress, delta);
  if (next) {
    ui.setSelectedAddress(next.address);
    ui.setAttachedAddress(next.address);
    ui.rememberCardSession(cardKeyForSession(next), next.address);
  } else if (current.projectId) {
    ui.showToast("열린 탭이 1개입니다 · Ctrl+Shift+T로 Shell 탭 추가", "info");
  }
}

let spawningShortcutShell = false;

export async function spawnShellTabInAttachedWorktree() {
  if (spawningShortcutShell) return;
  const ui = useUiStore.getState();
  const allSessions = useAppStore.getState().computed.allSessions;
  const current = ui.attachedAddress
    ? allSessions.find((s) => s.address === ui.attachedAddress) ?? null
    : null;

  let projectId = current?.projectId ?? undefined;
  let cwd = current?.worktreePath ?? "";
  let branch = current?.branch ?? undefined;
  let projectName = current?.projectName ?? "";
  let cardKey = current ? cardKeyForSession(current) : ui.selectedCardKey;

  if (!cwd && ui.selectedCardKey) {
    const card = readBoardCards().find((c) => c.key === ui.selectedCardKey);
    if (card?.worktreePath) {
      projectId = card.projectId ?? undefined;
      cwd = card.worktreePath;
      branch = card.branch ?? undefined;
      projectName =
        useAppStore.getState().projects.find((p) => p.id === card.projectId)
          ?.name ?? "";
    }
  }
  if (!cwd) return;

  const curShells = countWorktreeLiveShells(allSessions, cwd, projectId);
  if (curShells >= MAX_SHELLS_PER_WORKTREE) {
    ui.showToast(
      `한 Worktree당 PowerShell은 최대 ${MAX_SHELLS_PER_WORKTREE}개까지 열 수 있습니다.`,
      "info"
    );
    return;
  }

  spawningShortcutShell = true;
  try {
    const newAddr = await launchSession({
      project_id: projectId,
      cwd,
      branch,
      argv: [],
      name: projectName ? `${projectName}-${branch || "main"}-sh` : undefined,
    });
    if (newAddr) {
      ui.setSelectedAddress(newAddr);
      ui.setAttachedAddress(newAddr);
      if (cardKey) ui.rememberCardSession(cardKey, newAddr);
    }
  } catch (err) {
    ui.showToast(`PowerShell 탭 추가 실패: ${String(err)}`, "error");
  } finally {
    spawningShortcutShell = false;
  }
}

export function openAiLauncherForAttachedWorktree() {
  const ui = useUiStore.getState();
  const app = useAppStore.getState();
  const current = ui.attachedAddress
    ? app.computed.allSessions.find((s) => s.address === ui.attachedAddress) ??
      null
    : null;

  if (current?.worktreePath) {
    const proj = current.projectId
      ? app.projects.find((p) => p.id === current.projectId)
      : undefined;
    ui.setLaunchTarget({
      projectId: current.projectId ?? undefined,
      cwd: current.worktreePath,
      branch: current.branch || undefined,
      defaultAgent: proj?.default_agent,
    });
    return;
  }

  if (ui.selectedCardKey) {
    const card = readBoardCards().find((c) => c.key === ui.selectedCardKey);
    if (card?.worktreePath) {
      const proj = card.projectId
        ? app.projects.find((p) => p.id === card.projectId)
        : undefined;
      ui.setLaunchTarget({
        projectId: card.projectId ?? undefined,
        cwd: card.worktreePath,
        branch: card.branch ?? undefined,
        defaultAgent: proj?.default_agent,
      });
    }
  }
}

export function openContextMenuForSelectedCard(): boolean {
  const ui = useUiStore.getState();
  const app = useAppStore.getState();

  let preferredKey = ui.selectedCardKey;
  if (ui.attachedAddress) {
    const attachedSession = app.computed.allSessions.find(
      (s) => s.address === ui.attachedAddress
    );
    if (attachedSession?.projectId) {
      preferredKey = cardKeyForSession(attachedSession);
    }
  }

  const cards = readBoardCards();
  const targetCard =
    cards.find((c) => c.key === preferredKey) ??
    cards.find((c) => c.key === ui.selectedCardKey) ??
    cards[0] ??
    null;

  if (targetCard && targetCard.projectId && targetCard.worktreePath) {
    const normPath = normalizePath(targetCard.worktreePath);
    for (const lane of app.computed.matrixLanes) {
      if (lane.project.id !== targetCard.projectId) continue;
      const cell = lane.cells.find(
        (c) => normalizePath(c.worktree.path) === normPath
      );
      if (cell) {
        const r = targetCard.el.getBoundingClientRect();
        ui.setSelectedCardKey(targetCard.key);
        ui.setSelectedAddress(targetCard.addr);
        ui.setContextMenu({
          x: Math.round(r.left + Math.min(r.width * 0.45, 140)),
          y: Math.round(r.top + Math.min(r.height * 0.7, 52)),
          cardKey: targetCard.key,
          project: lane.project,
          worktree: cell.worktree,
          sessions: cell.sessions,
        });
        return true;
      }
    }
  }

  // Fallback for Queue view when working inside the right terminal pane
  if (ui.attachedAddress) {
    const sess = app.computed.allSessions.find(
      (s) => s.address === ui.attachedAddress
    );
    if (sess?.projectId) {
      const lane = app.computed.matrixLanes.find(
        (l) => l.project.id === sess.projectId
      );
      const normWt = normalizePath(sess.worktreePath);
      const cell = lane?.cells.find(
        (c) => normalizePath(c.worktree.path) === normWt
      );
      if (lane && cell) {
        ui.setContextMenu({
          x: Math.round(window.innerWidth * 0.4),
          y: 120,
          cardKey: cardKeyForSession(sess),
          project: lane.project,
          worktree: cell.worktree,
          sessions: cell.sessions,
        });
        return true;
      }
    }
  }
  return false;
}
