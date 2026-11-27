import { describe, expect, it } from "vitest";
import {
  createDefaultTeamSettings,
  formatCsvTokens,
  normalizeTeamSettings,
  parseCsvTokens,
  validateTeamSettings,
} from "./teamSettings";

describe("teamSettings utilities", () => {
  it("normalizes missing or legacy partial team settings safely", () => {
    const norm = normalizeTeamSettings({
      enabled: true,
      global_max_auto_review_workers: 99,
      per_project_max_workers: 0,
      reject_max_queue_size: -3,
      review_prompt_template: "   ",
    });
    expect(norm.enabled).toBe(true);
    expect(norm.bypass_proxy).toBe(true);
    expect(norm.global_max_auto_review_workers).toBe(5);
    expect(norm.per_project_max_workers).toBe(1);
    expect(norm.reject_max_queue_size).toBe(1);
    expect(norm.ack_teardown_mode).toBe("on_ack");
    expect(norm.review_prompt_template).toContain("{{review_report_path}}");
    expect(norm.reject_excluded_labels).toEqual(["wip", "no-ai-review"]);
  });

  it("parses and deduplicates CSV tokens case-insensitively", () => {
    expect(parseCsvTokens(" wip, NO-AI-REVIEW , WIP,\nchore  ")).toEqual([
      "wip",
      "NO-AI-REVIEW",
      "chore",
    ]);
    expect(formatCsvTokens(["wip", "chore"])).toBe("wip, chore");
  });

  it("validates enabled settings require relay_url and team_key", () => {
    const def = createDefaultTeamSettings();
    expect(validateTeamSettings(def)).toBeNull();
    expect(validateTeamSettings({ ...def, enabled: true })).toContain("Relay");
    expect(
      validateTeamSettings({
        ...def,
        enabled: true,
        relay_url: "http://10.0.0.1:8787",
      })
    ).toContain("Team Key");
    expect(
      validateTeamSettings({
        ...def,
        enabled: true,
        relay_url: "http://10.0.0.1:8787",
        team_key: "secret",
      })
    ).toBeNull();
  });
});
