import { describe, expect, it } from "vitest";
import { ayahRuns } from "./surahapp";

describe("материалы «Суры»", () => {
  it("аяты страницы группируются по сурам", () => {
    expect(ayahRuns(["11:6", "11:7", "11:8"])).toEqual([[11, 6, 8]]);
    expect(ayahRuns(["103:1", "103:2", "103:3", "104:1", "104:9", "105:1"])).toEqual([
      [103, 1, 3],
      [104, 1, 9],
      [105, 1, 1],
    ]);
  });
});
