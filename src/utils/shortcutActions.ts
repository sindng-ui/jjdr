import { useAppStore } from "../store/useAppStore";
import { useUiStore } from "../store/useUiStore";
import { launchSession } from "../services/tauriBridge";
import { normalizePath } from "../workers/dashboardLogic";
import {
  findNextCardInDirection,
  type CardRect,
  type NavDirection,
} from "./spatialNav";
import { swapIds } from "../hooks/usePointerReorder";
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
      ui.requestTerminalFocus();
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
  syncAttachedPane: boolean,
  focusTerminalPane = false
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

  const drawerOpen = ui.terminalDrawerOpen || Boolean(ui.attachedAddress);
  const shouldSync = syncAttachedPane && (drawerOpen || focusTerminalPane);

  if (shouldSync) {
    if (nextCard.addr) {
      const term = useAppStore.getState().terminals[nextCard.addr];
      if (term && term.state === "live") {
        ui.setAttachedAddress(nextCard.addr);
        if (focusTerminalPane) {
          ui.requestTerminalFocus();
        }
        return;
      }
    }
    if (drawerOpen) {
      // Instant 0ms empty drawer state when passing over empty cards (#11, #13)
      ui.detachToEmptyDrawer();
    }
  }
}

export interface ActionableCardItem {
  cardKey: string;
  projectId: string | null;
  address: string;
  bucket: "needs_you" | "ready";
  isLive: boolean;
}

/**
 * Collect deduplicated actionable items at Worktree-card granularity in a stable
 * deterministic order (needs_you -> ready, preserving board lane/cell order).
 */
export function buildActionableCardList(): ActionableCardItem[] {
  const { matrixLanes, unassignedSessions, allSessions } =
    useAppStore.getState().computed;

  const seenCardKeys = new Set<string>();
  const items: ActionableCardItem[] = [];

  for (const lane of matrixLanes) {
    for (const cell of lane.cells) {
      if (cell.topBucket !== "needs_you" && cell.topBucket !== "ready") {
        continue;
      }
      const primary =
        cell.sessions.find((s) => s.bucket === cell.topBucket && s.terminal.state === "live") ??
        cell.sessions.find((s) => s.bucket === cell.topBucket) ??
        cell.sessions[0];
      if (!primary) continue;
      const cardKey = `wt::${lane.project.id}::${normalizePath(cell.worktree.path)}`;
      if (seenCardKeys.has(cardKey)) continue;
      seenCardKeys.add(cardKey);
      items.push({
        cardKey,
        projectId: lane.project.id,
        address: primary.address,
        bucket: cell.topBucket,
        isLive: primary.terminal.state === "live",
      });
    }
  }

  for (const s of unassignedSessions) {
    if (s.bucket !== "needs_you" && s.bucket !== "ready") continue;
    const cardKey = `ext::${s.address}`;
    if (seenCardKeys.has(cardKey)) continue;
    seenCardKeys.add(cardKey);
    items.push({
      cardKey,
      projectId: null,
      address: s.address,
      bucket: s.bucket,
      isLive: s.terminal.state === "live",
    });
  }

  // Fallback when current filter hides actionable sessions in other projects
  if (items.length === 0) {
    for (const s of allSessions) {
      if (s.bucket !== "needs_you" && s.bucket !== "ready") continue;
      const cardKey = s.projectId
        ? `wt::${s.projectId}::${normalizePath(s.worktreePath)}`
        : `ext::${s.address}`;
      if (seenCardKeys.has(cardKey)) continue;
      seenCardKeys.add(cardKey);
      items.push({
        cardKey,
        projectId: s.projectId,
        address: s.address,
        bucket: s.bucket,
        isLive: s.terminal.state === "live",
      });
    }
  }

  // Stable sort: needs_you first, preserving existing board order within same bucket
  const needs = items.filter((i) => i.bucket === "needs_you");
  const ready = items.filter((i) => i.bucket === "ready");
  return [...needs, ...ready];
}

export function jumpToNextActionable(delta: 1 | -1 = 1) {
  const actionable = buildActionableCardList();
  if (actionable.length === 0) {
    useUiStore.getState().showToast("확인할 작업이 없습니다!", "success");
    return;
  }

  const ui = useUiStore.getState();
  const curIdx = actionable.findIndex(
    (item) =>
      (ui.selectedCardKey && item.cardKey === ui.selectedCardKey) ||
      (ui.selectedAddress && item.address === ui.selectedAddress)
  );

  if (actionable.length === 1 && curIdx === 0) {
    const only = actionable[0];
    if (only.isLive && (ui.terminalDrawerOpen || ui.attachedAddress)) {
      ui.setAttachedAddress(only.address);
      ui.requestTerminalFocus();
    }
    ui.showToast("확인 필요한 카드가 현재 1개뿐입니다.", "info", 1800);
    return;
  }

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
  ui.setSelectedCardKey(next.cardKey);
  ui.setSelectedAddress(next.address);

  if (ui.viewMode === "radar") {
    const syncRadarCard = () => {
      const cards = readBoardCards();
      const match =
        cards.find((c) => c.key === next.cardKey) ??
        cards.find((c) => c.addr === next.address);
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
  if ((ui.terminalDrawerOpen || ui.attachedAddress) && next.isLive) {
    ui.setAttachedAddress(next.address);
    ui.requestTerminalFocus();
  }
}

export function moveQueueSelection(
  delta: number,
  syncAttachedPane: boolean,
  focusTerminalPane = false
) {
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
  ui.setSelectedCardKey(cardKeyForSession(next));
  ui.setSelectedAddress(next.address);

  const drawerOpen = ui.terminalDrawerOpen || Boolean(ui.attachedAddress);
  if (
    syncAttachedPane &&
    (drawerOpen || focusTerminalPane) &&
    next.terminal.state === "live"
  ) {
    ui.setAttachedAddress(next.address);
    if (focusTerminalPane) {
      ui.requestTerminalFocus();
    }
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

/**
 * Keyboard card grab-and-swap (Ctrl+Shift+Alt+Arrow):
 * First press grabs the selected worktree card and previews the neighbor in `dir` within the same project.
 * Subsequent arrow presses while holding modifiers keep moving the target slot.
 */
export function stepKeyboardCardGrab(dir: NavDirection): boolean {
  const ui = useUiStore.getState();
  if (ui.viewMode !== "radar") return false;

  const allCards = readBoardCards();
  if (allCards.length === 0) return false;

  const existing = ui.cardGrabState;

  if (!existing) {
    const source =
      allCards.find((c) => c.key === ui.selectedCardKey) ?? allCards[0] ?? null;
    if (!source || !source.projectId || !source.worktreePath) return false;

    const projectCards = allCards.filter(
      (c) => c.projectId === source.projectId && Boolean(c.worktreePath)
    );
    if (projectCards.length <= 1) return false;

    const nextKey = findNextCardInDirection(projectCards, source.key, dir);
    const target =
      (nextKey ? projectCards.find((c) => c.key === nextKey) : null) ?? source;

    ui.setCardGrabState({
      projectId: source.projectId,
      sourceKey: source.key,
      sourceNormPath: normalizePath(source.worktreePath),
      targetKey: target.key,
      targetNormPath: normalizePath(target.worktreePath!),
    });
    target.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return true;
  }

  const projectCards = allCards.filter(
    (c) => c.projectId === existing.projectId && Boolean(c.worktreePath)
  );
  if (projectCards.length <= 1) return false;

  const nextKey = findNextCardInDirection(projectCards, existing.targetKey, dir);
  if (!nextKey) return true;

  const target = projectCards.find((c) => c.key === nextKey);
  if (!target || !target.worktreePath) return true;

  ui.setCardGrabState({
    ...existing,
    targetKey: target.key,
    targetNormPath: normalizePath(target.worktreePath),
  });
  target.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  return true;
}

/**
 * Commit the 1:1 card swap when the user releases Ctrl/Shift/Alt after keyboard grabbing.
 */
export function commitKeyboardCardGrab(): boolean {
  const ui = useUiStore.getState();
  const grab = ui.cardGrabState;
  if (!grab) return false;

  ui.setCardGrabState(null);

  if (grab.sourceNormPath === grab.targetNormPath) {
    return false;
  }

  const app = useAppStore.getState();
  const lane = app.computed.matrixLanes.find(
    (l) => l.project.id === grab.projectId
  );
  if (!lane) return false;

  const currentNormPaths = lane.cells.map((c) =>
    normalizePath(c.worktree.path)
  );
  const swapped = swapIds(
    currentNormPaths,
    grab.sourceNormPath,
    grab.targetNormPath
  );
  app.setProjectWorktreeOrder(grab.projectId, swapped);
  ui.setSelectedCardKey(grab.sourceKey);
  ui.showToast("카드 위치 1:1 교환됨", "success", 1300);
  return true;
}

export function cancelKeyboardCardGrab() {
  if (useUiStore.getState().cardGrabState) {
    useUiStore.getState().setCardGrabState(null);
  }
}
