const SFX_STORAGE_KEY = "jjdr.zen_sfx_enabled";

let sharedAudioCtx: AudioContext | null = null;

export function readStoredZenSfxEnabled(): boolean {
  try {
    const raw = window.localStorage.getItem(SFX_STORAGE_KEY);
    if (raw === "false") return false;
    if (raw === "true") return true;
  } catch {
    // ignore storage errors
  }
  return true;
}

export function writeStoredZenSfxEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(SFX_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // ignore storage errors
  }
}

function getLazyAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return null;
  if (!sharedAudioCtx) {
    try {
      sharedAudioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }
  if (sharedAudioCtx.state === "suspended") {
    void sharedAudioCtx.resume().catch(() => {});
  }
  return sharedAudioCtx;
}

function playTone(
  ctx: AudioContext,
  opts: {
    type: OscillatorType;
    startFreq: number;
    endFreq: number;
    startAt: number;
    duration: number;
    gain: number;
  }
) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.startFreq, opts.startAt);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(20, opts.endFreq),
    opts.startAt + opts.duration
  );

  gainNode.gain.setValueAtTime(0.0001, opts.startAt);
  gainNode.gain.linearRampToValueAtTime(opts.gain, opts.startAt + 0.008);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, opts.startAt + opts.duration);

  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.onended = () => {
    osc.disconnect();
    gainNode.disconnect();
  };
  osc.start(opts.startAt);
  osc.stop(opts.startAt + opts.duration + 0.01);
}

/** Tactile heavy stamp thump ("THUNK!") for CLEARED / APPROVED / HIRED! */
export function playZenStampSfx(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getLazyAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  playTone(ctx, {
    type: "sine",
    startFreq: 165,
    endFreq: 48,
    startAt: t,
    duration: 0.11,
    gain: 0.14,
  });
  playTone(ctx, {
    type: "triangle",
    startFreq: 680,
    endFreq: 210,
    startAt: t,
    duration: 0.045,
    gain: 0.06,
  });
}

/** Crisp arcade mechanical click ("CLACK!") for lever pull / gacha turn / next worker */
export function playZenLeverSfx(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getLazyAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  playTone(ctx, {
    type: "triangle",
    startFreq: 860,
    endFreq: 380,
    startAt: t,
    duration: 0.036,
    gain: 0.07,
  });
  playTone(ctx, {
    type: "sine",
    startFreq: 1240,
    endFreq: 960,
    startAt: t + 0.042,
    duration: 0.03,
    gain: 0.05,
  });
}

/** Upbeat two-note deploy chime for DISPATCHED! / HIRED! */
export function playZenDeploySfx(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getLazyAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  playTone(ctx, {
    type: "sine",
    startFreq: 523.25,
    endFreq: 523.25,
    startAt: t,
    duration: 0.09,
    gain: 0.08,
  });
  playTone(ctx, {
    type: "sine",
    startFreq: 783.99,
    endFreq: 880,
    startAt: t + 0.075,
    duration: 0.14,
    gain: 0.09,
  });
}

/** Calm 3-note chime when reaching Zen All Clear */
export function playZenAllClearSfx(enabled: boolean): void {
  if (!enabled) return;
  const ctx = getLazyAudioContext();
  if (!ctx) return;
  const t = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99];
  notes.forEach((freq, i) => {
    playTone(ctx, {
      type: "sine",
      startFreq: freq,
      endFreq: freq,
      startAt: t + i * 0.08,
      duration: 0.22,
      gain: 0.07,
    });
  });
}

/** Formats combo float text for consecutive Zen Inbox clears */
export function formatZenComboLabel(
  combo: number,
  isApproval: boolean
): string {
  if (combo >= 5) return `${combo}x ON FIRE!`;
  if (combo >= 3) return `${combo}x STREAK!`;
  if (combo === 2) return "2x COMBO!";
  return isApproval ? "+1 Approved!" : "+1 Cleared!";
}
