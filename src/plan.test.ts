import { describe, expect, it } from "vitest";
import chunk0 from "../public/data/madani/p0.json";
import chunk29 from "../public/data/madani/p29.json";
import surahs from "../public/data/surahs.json";
import { DEFAULT_METHOD } from "./method";
import { makePlan, pagesText, partialPages, versesText, type Names } from "./plan";
import { madani } from "./testMeta";
import { translate } from "./i18n";
import type { PageData, Student, Surah } from "./types";

const pages = new Map<number, PageData>([...(chunk0 as PageData[]), ...(chunk29 as PageData[])].map((p) => [p.p, p]));
const names: Names = { surahs: surahs as Surah[], pages };
const t = (k: Parameters<typeof translate>[1], v?: Record<string, string | number>) => translate("ru", k, v);

const student = (hifz: Partial<Student["hifz"]>, o: Partial<Student> = {}) =>
  ({
    id: "s",
    stage: "hifz",
    direction: -1,
    volume: "half",
    submissions: [],
    method: { ...DEFAULT_METHOD },
    hifz: { memorized: [], parts: {}, cur: { page: 1, line: 0 }, pending: null, lesson: null, manzilCursor: 0, ...hifz },
    ...o,
  }) as unknown as Student;

// Как у ученика на сервере: снизу вверх, отмечены начало 30 джуза и суры с конца.
const marked = student({
  memorized: [604, 603, 602, 601, 600, 585, 583, 584, 582],
  parts: { 586: [[0, 1]], 599: [[9, 11]] },
  cur: { page: 599, line: 0 },
});

describe("напоминание сурами, аятами и страницами", () => {
  it("недавнее: подряд идущие суры сливаются, целые суры без номеров аятов", () => {
    const p = makePlan(marked, madani, "ru", "Asia/Almaty", names);
    expect(p.sabki?.text).toBe("Недавнее\nAn-Naba – 'Abasa; Al-'Adiyat – An-Nas\nстр. 582–586, 599–604");
  });
  it("давнее: джуз, суры и аяты, страницы", () => {
    const s = student({ memorized: Array.from({ length: 50 }, (_, i) => i + 1), cur: { page: 51, line: 0 } }, { direction: 1 });
    const p = makePlan(s, madani, "ru", "Asia/Almaty", names);
    expect(p.manzil?.text).toBe("Давнее\nДжуз 1: Al-Fatihah – Al-Baqarah 141\nстр. 1–21\nДжуз 2: Al-Baqarah 142–252\nстр. 22–41");
  });
  it("отрывок посреди суры с номерами аятов", () => {
    expect(versesText([{ page: 3, from: 0, to: 6 }], madani, names, "ru")).toBe("Al-Baqarah 6–10");
    expect(versesText([{ page: 2, from: 0, to: 6 }, { page: 3, from: 0, to: 15 }], madani, names, "ru")).toBe("Al-Baqarah 1–16");
  });
  it("без сети остаются страницы", () => {
    const p = makePlan(marked, madani, "ru", "Asia/Almaty");
    expect(p.sabki?.text).toBe("Недавнее\nстр. 582–586, 599–604");
  });
  it("грузятся только страницы, где отрывок начинается или кончается посреди страницы", () => {
    expect(partialPages([{ page: 586, from: 0, to: 1 }, { page: 600, from: 0, to: 11 }], madani)).toEqual([586]);
    expect(pagesText([{ page: 5, from: 0, to: 2 }], t)).toBe("стр. 5");
  });
});
