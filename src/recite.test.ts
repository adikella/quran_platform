import { describe, expect, it } from "vitest";
import { compareRecitation, finalVowel, normalizeAr, similarity, SAME_WORD } from "./recite";

// Аль-Фатиха, 2–3 по мусхафу (усманский текст с огласовкой).
const FATIHA = "ٱلۡحَمۡدُ لِلَّهِ رَبِّ ٱلۡعَٰلَمِينَ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ".split(" ");

describe("normalizeAr", () => {
  it("убирает огласовку и приводит алифы", () => {
    expect(normalizeAr("ٱلۡحَمۡدُ")).toBe("الحمد");
    expect(normalizeAr("الحمد")).toBe("الحمد");
  });
});

describe("similarity", () => {
  it("одно слово в разной орфографии считается одним", () => {
    expect(similarity("ٱلۡعَٰلَمِينَ", "العالمين")).toBeGreaterThanOrEqual(SAME_WORD);
    expect(similarity("ٱلرَّحۡمَٰنِ", "الرحمن")).toBeGreaterThanOrEqual(SAME_WORD);
  });
  it("разные слова различаются", () => {
    expect(similarity("ٱلرَّحِيمِ", "العالمين")).toBeLessThan(SAME_WORD);
  });
});

describe("compareRecitation", () => {
  it("чистое чтение без ошибок", () => {
    const r = compareRecitation(FATIHA, "الحمد لله رب العالمين الرحمن الرحيم");
    expect(r.words.every((w) => w.status === "ok")).toBe(true);
    expect(r.extra).toBe(0);
  });
  it("пропущенное слово", () => {
    const r = compareRecitation(FATIHA, "الحمد لله العالمين الرحمن الرحيم");
    expect(r.words.map((w) => w.status)).toEqual(["ok", "ok", "missed", "ok", "ok", "ok"]);
  });
  it("заменённое слово", () => {
    const r = compareRecitation(FATIHA, "الحمد لله رب العالمين الكريم الرحيم");
    expect(r.words[4]).toEqual({ status: "wrong", heard: "الكريم" });
    expect(r.words.filter((w) => w.status !== "ok")).toHaveLength(1);
  });
  it("запнулся и начал заново: не ошибка", () => {
    const r = compareRecitation(FATIHA, "الحمد لله رب الحمد لله رب العالمين الرحمن الرحيم");
    expect(r.words.every((w) => w.status === "ok")).toBe(true);
    expect(r.extra).toBe(3);
  });
});

describe("огласовка конца слова", () => {
  it("находит касру вместо даммы", () => {
    expect(finalVowel("ٱلۡحَمۡدُ")).toBe("u");
    expect(finalVowel("الْحَمْدِ")).toBe("i");
    expect(finalVowel("رَبِّ")).toBe("i");
    expect(finalVowel("ٱلۡعَٰلَمِينَ")).toBe("a");
    const r = compareRecitation(FATIHA, "الْحَمْدِ لِلَّهِ رَبِّ الْعَالَمِينَ الرَّحْمَنِ الرَّحِيمِ", [false, false, false, true, false, true]);
    expect(r.words[0]).toEqual({ status: "vowel", heard: "الْحَمْدِ" });
    expect(r.words.slice(1).every((w) => w.status === "ok")).toBe(true);
  });
  it("в конце аята огласовку не сверяет", () => {
    const r = compareRecitation(FATIHA, "الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينْ الرَّحْمَنِ الرَّحِيمْ", [false, false, false, true, false, true]);
    expect(r.words.every((w) => w.status === "ok")).toBe(true);
  });
});

describe("орфография мусхафа и обычная", () => {
  it.each([
    ["هَٰذَا", "هذا"],
    ["ٱلصَّلَوٰةَ", "الصلاة"],
    ["ٱلسَّمَٰوَٰتِ", "السماوات"],
    ["يَـُٔودُهُۥ", "يئوده"],
    ["عَلَىٰ", "على"],
  ])("%s и %s одно слово", (a, b) => expect(similarity(a, b)).toBeGreaterThanOrEqual(SAME_WORD));
  it.each([
    ["هُوَ", "هي"],
    ["قَالَ", "قيل"],
    ["وَلَا", "لا"],
    ["مَا", "من"],
  ])("%s и %s разные слова", (a, b) => expect(similarity(a, b)).toBeLessThan(SAME_WORD));
  it("слитно и раздельно", () => {
    const r = compareRecitation(["يَٰٓأَيُّهَا", "ٱلنَّاسُ"], "يا أيها الناس");
    expect(r.words.every((w) => w.status === "ok")).toBe(true);
    expect(r.extra).toBe(0);
  });
  it("слияние не прячет пропущенное слово", () => {
    const r = compareRecitation(["ٱلَّذِينَ", "هُمۡ", "فِي"], "الذين في");
    expect(r.words.map((w) => w.status)).toEqual(["ok", "missed", "ok"]);
  });
});

describe("васль", () => {
  it("لَا ٱنفِصَامَ, услышанное как «لن فصام», не ошибка", () => {
    const r = compareRecitation(["ٱلۡوُثۡقَىٰ", "لَا", "ٱنفِصَامَ", "لَهَاۗ"], "الْوُثْقَى لَنْ فِصَامَ لَهَا");
    expect(r.words.every((w) => w.status === "ok")).toBe(true);
  });
  it("другое слово перед васлем остаётся ошибкой", () => {
    const r = compareRecitation(["قَالَ", "ٱللَّهُ"], "قل الله");
    expect(r.words[0].status).toBe("wrong");
  });
});
