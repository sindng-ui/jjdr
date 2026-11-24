import React from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";

interface ProjectAdvancedSectionProps {
  open: boolean;
  onToggle: () => void;
  envOptions: string[];
  selectedEnvFiles: string[];
  onToggleEnvFile: (file: string) => void;
  setupCommand: string;
  setupChoices: string[];
  onChangeSetupCommand: (cmd: string) => void;
  verifyCommand: string;
  verifyChoices: string[];
  onChangeVerifyCommand: (cmd: string) => void;
}

export const ProjectAdvancedSection = React.memo(
  function ProjectAdvancedSection({
    open,
    onToggle,
    envOptions,
    selectedEnvFiles,
    onToggleEnvFile,
    setupCommand,
    setupChoices,
    onChangeSetupCommand,
    verifyCommand,
    verifyChoices,
    onChangeVerifyCommand,
  }: ProjectAdvancedSectionProps) {
    return (
      <div
        className="pt-3"
        style={{ borderTop: "1px solid var(--divider)" }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer"
          style={{ color: "var(--text-muted)" }}
        >
          {open ? (
            <ChevronDown className="w-3.5 h-3.5" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5" />
          )}
          Advanced Options (Auto-detected bootstrap & verify)
        </button>

        {open && (
          <div className="mt-3 space-y-3 pl-1">
            {envOptions.length > 0 && (
              <div>
                <div
                  className="mb-1.5"
                  style={{ color: "var(--text-secondary)" }}
                >
                  Copy files into new worktree
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {envOptions.map((f) => {
                    const checked = selectedEnvFiles.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => onToggleEnvFile(f)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-mono-code text-[11px] cursor-pointer"
                        style={{
                          background: checked
                            ? "var(--ready-soft)"
                            : "var(--input-bg)",
                          border: `1px solid ${
                            checked
                              ? "var(--ready-border)"
                              : "var(--input-border)"
                          }`,
                          color: checked
                            ? "var(--ready-fg)"
                            : "var(--text-muted)",
                        }}
                      >
                        {checked && <Check className="w-3 h-3" />}
                        {f}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div>
              <label
                className="block mb-1"
                style={{ color: "var(--text-secondary)" }}
              >
                Post-create Setup Command
              </label>
              <select
                value={setupCommand}
                onChange={(e) => onChangeSetupCommand(e.target.value)}
                className="jjdr-input w-full px-3.5 py-2 rounded-full font-mono-code"
              >
                <option value="">None (fastest)</option>
                {setupChoices.map((cmd) => (
                  <option key={cmd} value={cmd}>
                    {cmd}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                className="block mb-1"
                style={{ color: "var(--text-secondary)" }}
              >
                One-Click Verify Command
              </label>
              <select
                value={verifyCommand}
                onChange={(e) => onChangeVerifyCommand(e.target.value)}
                className="jjdr-input w-full px-3.5 py-2 rounded-full font-mono-code"
              >
                <option value="">None</option>
                {verifyChoices.map((cmd) => (
                  <option key={cmd} value={cmd}>
                    {cmd}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
      </div>
    );
  }
);
