import { describe, expect, it } from "vitest";
import old11 from "../public/data/madani/p11.json";
import new11 from "../public/data/madani1441/p11.json";
import meta1441 from "../public/data/madani1441/meta.json";
import { lineAt, moveLine, pagesToMove, switchEdition } from "./edition";
import { DEFAULT_METHOD } from "./method";
import { madani } from "./testMeta";
import type { MushafMeta, PageData, Student } from "./types";

const m1441 = meta1441 as unknown as MushafMeta;
const page = (chunk: unknown, p: number) => (chunk as PageData[]).find((x) => x.p === p)!;
const a222 = page(old11, 222);
const b222 = page(new11, 222);

const student = (hifz: Partial<Student["hifz"]>) =>
  ({
    id: "s",
    name: "Тест",
    mushaf: "madani",
    stage: "hifz",
    direction: 1,
    volume: "half",
    submissions: [],
    method: { ...DEFAULT_METHOD },
    hifz: { memorized: [], parts: {}, cur: { page: 1, line: 0 }, pending: null, lesson: null, manzilCursor: 0, ...hifz },
  }) as unknown as Student;

describe("издания мединского мусхафа", () => {
  it("на стр. 222 в 1441 номер аята 8 в конце 8-й строки, как в печатном", () => {
    const line8 = b222.l[7].w;
    expect(line8[line8.length - 1]).toBe(8);
    expect(a222.l[8].w[0]).toBe(8);
  });
  it("граница строки переносится к ближайшей по словам", () => {
    expect(moveLine(8, a222, b222)).toBe(8);
    expect(moveLine(0, a222, b222)).toBe(0);
    expect(moveLine(15, a222, b222)).toBe(15);
    expect(lineAt(b222, 0)).toBe(0);
  });
  it("переход: целые страницы остаются целыми, начатая переносится по словам, место урока тоже", () => {
    const s = student({ memorized: [220, 221], parts: { 222: [[0, 8]] }, cur: { page: 222, line: 8 } });
    expect(pagesToMove(s, madani)).toEqual([222]);
    const next = switchEdition(s, "madani1441", madani, m1441, new Map([[222, a222]]), new Map([[222, b222]]));
    expect(next.mushaf).toBe("madani1441");
    expect(next.hifz.memorized).toEqual([220, 221]);
    expect(next.hifz.parts).toEqual({ 222: [[0, 8]] });
    expect(next.hifz.cur).toEqual({ page: 222, line: 8 });
  });
});
