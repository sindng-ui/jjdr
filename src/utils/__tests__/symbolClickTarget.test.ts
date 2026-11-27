import { describe, expect, it } from "vitest";
import { extractSymbolClickTarget } from "../symbolClickTarget";

describe("extractSymbolClickTarget", () => {
  it("extracts simple identifier without qualifier", () => {
    const line = "    PlayerController ctrl = new PlayerController();";
    const col = line.indexOf("PlayerController") + 4;
    expect(extractSymbolClickTarget(line, col)).toEqual({
      kind: "symbol",
      token: "PlayerController",
      qualifier: null,
      startCol: 4,
      endCol: 20,
    });
  });

  it("extracts C++ qualified symbol with :: scope", () => {
    const line = "void Engine::Inventory::AddItem(int id) {";
    const col = line.indexOf("AddItem") + 2;
    expect(extractSymbolClickTarget(line, col)).toEqual({
      kind: "symbol",
      token: "AddItem",
      qualifier: "Inventory",
      startCol: line.indexOf("AddItem"),
      endCol: line.indexOf("AddItem") + "AddItem".length,
    });
  });

  it("extracts C# member call with dot and generic receiver", () => {
    const line = "var result = Repository<Order>.FindById(orderId);";
    const col = line.indexOf("FindById") + 3;
    expect(extractSymbolClickTarget(line, col)).toEqual({
      kind: "symbol",
      token: "FindById",
      qualifier: "Repository",
      startCol: line.indexOf("FindById"),
      endCol: line.indexOf("FindById") + "FindById".length,
    });
  });

  it("extracts C++ pointer arrow member call", () => {
    const line = "    playerPtr->TakeDamage(25);";
    const col = line.indexOf("TakeDamage") + 1;
    expect(extractSymbolClickTarget(line, col)).toEqual({
      kind: "symbol",
      token: "TakeDamage",
      qualifier: "playerPtr",
      startCol: line.indexOf("TakeDamage"),
      endCol: line.indexOf("TakeDamage") + "TakeDamage".length,
    });
  });

  it("ignores this/self/base qualifiers", () => {
    const line = "    this.HandleTick(dt);";
    const col = line.indexOf("HandleTick") + 1;
    const res = extractSymbolClickTarget(line, col);
    expect(res?.token).toBe("HandleTick");
    expect(res?.qualifier).toBeNull();
  });

  it("ignores language keywords and numbers", () => {
    const line = "return 42;";
    expect(extractSymbolClickTarget(line, 2)).toBeNull();
    expect(extractSymbolClickTarget(line, 8)).toBeNull();
  });

  it("extracts #include quoted and angled paths", () => {
    const line1 = '#include "core/Player.h"';
    expect(extractSymbolClickTarget(line1, 14)).toEqual({
      kind: "include",
      token: "core/Player.h",
      qualifier: null,
      startCol: 10,
      endCol: 23,
    });

    const line2 = "#include <engine/Math.hpp>";
    expect(extractSymbolClickTarget(line2, 16)).toEqual({
      kind: "include",
      token: "engine/Math.hpp",
      qualifier: null,
      startCol: 10,
      endCol: 25,
    });
  });
});
