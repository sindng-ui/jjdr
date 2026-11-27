import { useCallback, useState } from "react";
import {
  readStoredChillBackdrop,
  writeStoredChillBackdrop,
  type ChillBackdropConfig,
} from "../utils/zenChillBackdrop";

/**
 * Manages Zen Chill / All Clear backdrop config persistence, pure scenery view toggle,
 * and custom photo revision counter so ZenModeView stays slim and focused.
 */
export function useZenChillBackdrop() {
  const [chillConfig, setChillConfig] = useState<ChillBackdropConfig>(() =>
    readStoredChillBackdrop()
  );
  const [peekSceneryOnly, setPeekSceneryOnly] = useState(false);
  const [photoVersion, setPhotoVersion] = useState(0);

  const handleChangeChillConfig = useCallback((next: ChillBackdropConfig) => {
    setChillConfig(next);
    writeStoredChillBackdrop(next);
    if (next.scene === "none") {
      setPeekSceneryOnly(false);
    }
  }, []);

  const handleTogglePeekScenery = useCallback(() => {
    setPeekSceneryOnly((prev) => !prev);
  }, []);

  const handlePhotoChanged = useCallback(() => {
    setPhotoVersion((n) => n + 1);
  }, []);

  return {
    chillConfig,
    peekSceneryOnly,
    photoVersion,
    handleChangeChillConfig,
    handleTogglePeekScenery,
    handlePhotoChanged,
  };
}
