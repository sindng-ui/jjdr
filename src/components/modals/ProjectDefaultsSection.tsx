import React from "react";
import { Check, Plus } from "lucide-react";
import type { TemplateInfo } from "../../types/domain";
import { AGENT_OPTIONS } from "../../utils/agents";

interface ProjectDefaultsSectionProps {
  defaultAgent: string;
  customAgentMode: boolean;
  templates: TemplateInfo[];
  onSelectAgent: (cmd: string) => void;
  onEnableCustomAgent: () => void;
  onChangeCustomAgent: (val: string) => void;
  group: string;
  groupChoices: string[];
  addingGroup: boolean;
  newGroupDraft: string;
  onSelectGroup: (g: string) => void;
  onStartAddGroup: () => void;
  onChangeNewGroupDraft: (val: string) => void;
  onConfirmNewGroup: () => void;
}

const chipStyle = (active: boolean): React.CSSProperties => ({
  background: active ? "var(--accent-soft)" : "var(--input-bg)",
  border: `1px solid ${active ? "var(--accent)" : "var(--input-border)"}`,
  color: active ? "var(--text-primary)" : "var(--text-secondary)",
});

export const ProjectDefaultsSection = React.memo(
  function ProjectDefaultsSection({
    defaultAgent,
    customAgentMode,
    templates,
    onSelectAgent,
    onEnableCustomAgent,
    onChangeCustomAgent,
    group,
    groupChoices,
    addingGroup,
    newGroupDraft,
    onSelectGroup,
    onStartAddGroup,
    onChangeNewGroupDraft,
    onConfirmNewGroup,
  }: ProjectDefaultsSectionProps) {
    return (
      <>
        {/* Step 4: Default AI CLI */}
        <div>
          <label
            className="block mb-1.5 font-semibold"
            style={{ color: "var(--text-secondary)" }}
          >
            4. Default AI CLI
          </label>
          <div className="flex flex-wrap gap-1.5">
            {AGENT_OPTIONS.map((a) => {
              const active = !customAgentMode && defaultAgent === a.cmd;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelectAgent(a.cmd)}
                  style={chipStyle(active)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer"
                >
                  {active && <Check className="w-3 h-3" />}
                  {a.label}
                </button>
              );
            })}
            {templates.map((tpl) => {
              const active = !customAgentMode && defaultAgent === tpl.name;
              return (
                <button
                  key={tpl.name}
                  type="button"
                  onClick={() => onSelectAgent(tpl.name)}
                  title={tpl.description}
                  style={chipStyle(active)}
                  className="px-3 py-1.5 rounded-full text-xs cursor-pointer"
                >
                  tpl:{tpl.name}
                </button>
              );
            })}
            <button
              type="button"
              onClick={onEnableCustomAgent}
              style={chipStyle(customAgentMode)}
              className="px-3 py-1.5 rounded-full text-xs cursor-pointer"
            >
              Custom…
            </button>
          </div>
          {customAgentMode && (
            <input
              type="text"
              value={defaultAgent}
              onChange={(e) => onChangeCustomAgent(e.target.value)}
              placeholder="Custom CLI command"
              className="jjdr-input mt-2 w-full px-3.5 py-2 rounded-full font-mono-code"
            />
          )}
        </div>

        {/* Step 5: Group */}
        <div>
          <label
            className="block mb-1.5 font-semibold"
            style={{ color: "var(--text-secondary)" }}
          >
            5. Group
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            {groupChoices.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onSelectGroup(g)}
                style={chipStyle(group === g)}
                className="px-3 py-1 rounded-full text-xs font-medium cursor-pointer"
              >
                {g}
              </button>
            ))}
            {addingGroup ? (
              <div className="inline-flex items-center gap-1.5">
                <input
                  type="text"
                  autoFocus
                  value={newGroupDraft}
                  onChange={(e) => onChangeNewGroupDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onConfirmNewGroup();
                    }
                  }}
                  placeholder="Group name"
                  className="jjdr-input w-28 px-3 py-1 rounded-full text-xs"
                />
                <button
                  type="button"
                  onClick={onConfirmNewGroup}
                  className="jjdr-primary-btn px-3 py-1 rounded-full text-[11px] font-semibold cursor-pointer"
                >
                  OK
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onStartAddGroup}
                className="inline-flex items-center gap-0.5 px-3 py-1 rounded-full text-xs border border-dashed cursor-pointer"
                style={{
                  borderColor: "var(--input-border)",
                  color: "var(--text-muted)",
                }}
              >
                <Plus className="w-3 h-3" />
                New
              </button>
            )}
          </div>
        </div>
      </>
    );
  }
);
