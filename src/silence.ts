// Следит за громкостью во время сдачи: если ученик долго молчит, один раз предлагает подсказку.

/** Сколько секунд тишины до подсказки. */
export const SILENCE_SECONDS = 5;
/** На сколько секунд открывается текст. */
export const PEEK_SECONDS = 4;

/** Столько секунд голоса подряд считается чтением, а не щелчком или вздохом. */
const VOICE_SECONDS = 0.4;
const GAP_SECONDS = 0.3;

export class SilenceWatch {
  private floor = 0.003;
  private peak = 0;
  private quiet = 0;
  private voice = 0;
  private gap = 0;
  /** Подсказку можно предложить: после использованной подсказки сначала надо продолжить чтение. */
  private armed = true;

  /** Громкость очередного отрезка (RMS) и его длина в секундах. Возвращает, показывать ли подсказку. */
  push(rms: number, dt: number): boolean {
    this.peak = Math.max(this.peak * Math.pow(0.98, dt), rms);
    this.floor = rms < this.floor ? rms : this.floor + (rms - this.floor) * Math.min(1, 0.05 * dt);
    // Порог подстраивается под шум комнаты и громкость чтеца.
    const threshold = Math.max(0.008, Math.min(this.floor * 2.5, this.peak * 0.5), this.peak * 0.12);
    this.quiet += dt;
    if (rms > threshold) {
      this.voice += dt;
      this.gap = 0;
      if (this.voice >= VOICE_SECONDS) {
        this.quiet = 0;
        this.armed = true;
      }
    } else {
      this.gap += dt;
      if (this.gap >= GAP_SECONDS) this.voice = 0;
    }
    return this.armed && this.quiet >= SILENCE_SECONDS;
  }

  /** Подсказкой воспользовались: следующая только после того, как чтение продолжится. */
  used() {
    this.armed = false;
    this.quiet = 0;
    this.voice = 0;
  }
}
