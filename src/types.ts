export type MushafId = "madani" | "indopak";
export type Lang = "ru" | "kk" | "en" | "ar";
export type Stage = "nazira" | "hifz";
/** Объём урока на день: 2 строки, полстраницы или страница. */
export type Volume = "lines2" | "half" | "page";
export type SubmissionKind = "nazira" | "sabak" | "sabki" | "manzil";
export type TimeCategory = SubmissionKind;

/** Числа методики. Все настраиваются, потому что у разных устазов свой стандарт. */
export interface Method {
  /** Перед заучиванием прочитать всю страницу, глядя в мусхаф. */
  readFirst: number;
  /** Кусок (2 строки): прочитать, глядя. */
  look: number;
  /** Кусок: рассказать, не глядя. */
  blind: number;
  /** Кусок: рассказать наизусть. */
  heart: number;
  /** Разбить «наизусть» пополам: половина по мусхафу, половина наизусть. */
  heartSplit: boolean;
  /** Соединение предыдущего куска с новым. */
  join: number;
  /** В конце прочитать весь урок. */
  whole: number;
  /** Дневная норма повторений (сабак + сабки + манзиль). */
  dailyTarget: number;
  /** Больше стольких явных ошибок — пересдача. */
  maxErrors: number;
  /** Сколько последних страниц считаются сабки. */
  sabkiPages: number;
  /** Сколько джузов манзиля сдавать за утро. */
  manzilJuz: number;
  /** Назира: сколько джузов прочитать до начала заучивания. */
  naziraJuz: number;
  /** Утренний блок сабки и манзиля. */
  morningStart: string;
  morningEnd: string;
}

/** Строки одной страницы: [from, to) — индексы текстовых строк страницы (с 0). */
export interface LineRange {
  page: number;
  from: number;
  to: number;
}

export type StepKind = "readFirst" | "look" | "blind" | "heart" | "join" | "whole";

export interface Step {
  kind: StepKind;
  /** Какие строки страницы показывать в этом шаге. */
  range: LineRange;
  /** true — текст скрыт (наизусть). */
  hidden: boolean;
  reps: number;
  /** Номер куска (с 0), к которому относится шаг. */
  chunk: number;
}

export interface LessonProgress {
  range: LineRange;
  step: number;
  done: number;
}

export interface Submission {
  id: string;
  date: string;
  kind: SubmissionKind;
  ranges: LineRange[];
  /** Первый и последний аят всех проверенных строк, например "2:142". */
  fromVerse: string;
  toVerse: string;
  errors: number;
  notes: number;
  grade: number;
  passed: boolean;
  seconds: number;
}

export interface DayStats {
  reps: number;
  seconds: Partial<Record<TimeCategory, number>>;
  /** Уроки, выученные за день (сабак). */
  learned: { range: LineRange; fromVerse: string; toVerse: string }[];
}

export interface Student {
  id: string;
  name: string;
  mushaf: MushafId;
  stage: Stage;
  volume: Volume;
  /** 1 — от начала мусхафа вперёд, -1 — от конца назад (например, с джуза Амма). */
  direction: 1 | -1;
  method: Method;
  nazira: { next: number; read: number[] };
  hifz: {
    /** Полностью выученные страницы в порядке заучивания. */
    memorized: number[];
    /** Страница, которая учится сейчас, и сколько её строк уже сдано. */
    cur: { page: number; line: number };
    /** Выученный урок, который ждёт сдачи устазу. */
    pending: LineRange | null;
    /** Урок, который учится прямо сейчас. */
    lesson: LessonProgress | null;
    /** Номер следующей группы манзиля (по кругу). */
    manzilCursor: number;
  };
  submissions: Submission[];
  days: Record<string, DayStats>;
}

export interface AppState {
  version: 1;
  lang: Lang;
  students: Student[];
  activeId: string | null;
}

export interface PageLine {
  n: number;
  /** Индекс в v аята, с которого начинается строка. */
  f: number;
  /** Слова; число — знак конца аята с этим номером. */
  w: (string | number)[];
}

export interface PageData {
  p: number;
  j: number;
  v: string[];
  l: PageLine[];
}

export interface MushafMeta {
  mushaf: MushafId;
  pages: number;
  chunk: number;
  /** [джуз, первый аят, последний аят, число текстовых строк] для каждой страницы. */
  page: [number, string, string, number][];
}

export interface Surah {
  n: number;
  ar: string;
  tr: string;
  ayahs: number;
  basmala: boolean;
  t: Record<Lang, string>;
}
