import { describe, expect, it } from "vitest";
import { SILENCE_SECONDS, SilenceWatch } from "./silence";

const DT = 0.1;
/** Прогоняет секунды с заданной громкостью; возвращает, предлагается ли подсказка в конце. */
function run(w: SilenceWatch, seconds: number, rms: number) {
  let offered = false;
  for (let i = 0; i < Math.round(seconds / DT); i++) offered = w.push(rms, DT);
  return offered;
}

describe("подсказка при долгом молчании", () => {
  it("пока читает и после короткой паузы подсказки нет", () => {
    const w = new SilenceWatch();
    for (let i = 0; i < 10; i++) {
      expect(run(w, 4, 0.1)).toBe(false);
      expect(run(w, 1.5, 0.002)).toBe(false);
    }
  });
  it("после долгого молчания предлагается и пропадает, когда чтение продолжилось", () => {
    const w = new SilenceWatch();
    run(w, 5, 0.1);
    expect(run(w, SILENCE_SECONDS + 0.5, 0.002)).toBe(true);
    expect(run(w, 1, 0.1)).toBe(false);
  });
  it("второй раз подряд подсмотреть нельзя: сначала надо продолжить чтение", () => {
    const w = new SilenceWatch();
    run(w, 5, 0.1);
    run(w, SILENCE_SECONDS + 1, 0.002);
    w.used();
    expect(run(w, 30, 0.002)).toBe(false);
    run(w, 2, 0.1);
    expect(run(w, SILENCE_SECONDS + 0.5, 0.002)).toBe(true);
  });
  it("короткий щелчок не считается чтением", () => {
    const w = new SilenceWatch();
    run(w, 5, 0.1);
    run(w, 3, 0.002);
    run(w, 0.2, 0.1);
    expect(run(w, 2.5, 0.002)).toBe(true);
  });
  it("ровный шум комнаты не принимается за чтение", () => {
    const w = new SilenceWatch();
    for (let i = 0; i < 5; i++) {
      run(w, 4, 0.12);
      run(w, 0.6, 0.012);
    }
    expect(run(w, SILENCE_SECONDS + 1, 0.013)).toBe(true);
  });
});
