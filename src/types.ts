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
  /** Сколько джузов манзиля сдавать за утро; 0.5: половина джуза. */
  manzilJuz: number;
  /** Куда идёт круг манзиля: 1 от первого джуза к тридцатому, -1 наоборот. Не задано: как заучивание. */
  manzilDir?: 1 | -1;
  /** Когда бот напоминает о сабки и манзиле ("HH:MM"), пусто: не напоминать. */
  remindAt: string;
  /** Назира: сколько джузов прочитать до начала заучивания. */
  naziraJuz: number;
  /** Таймер занятия: сколько минут отведено (0: считать время вперёд). */
  sessionMinutes: number;
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

export type StepKind = "readFirst" | "look" | "blind" | "heart" | "join" | "whole" | "repeat";

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
  /** Сколько раз повторён этот урок (счётчик до нормы 200). */
  reps?: number;
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
  /** Сколько раз подсмотрел при долгом молчании (в оценку не идёт). */
  peeks?: number;
  grade: number;
  passed: boolean;
  seconds: number;
  /** Принимал учитель или напарник. */
  by?: "teacher" | "partner";
  /** Отметки учителя по словам: ключ «страница:строка:слово», 1 ошибка, 2 таджвид. */
  marks?: Record<string, 1 | 2>;
  comment?: string;
}

export interface DayStats {
  reps: number;
  seconds: Partial<Record<TimeCategory, number>>;
  /** Уроки, выученные за день (сабак). */
  learned: { range: LineRange; fromVerse: string; toVerse: string; reps?: number }[];
}

export interface Student {
  id: string;
  name: string;
  mushaf: MushafId;
  stage: Stage;
  volume: Volume;
  /** 1: от начала мусхафа вперёд. -1: снизу вверх, 30-й джуз сурами от «Ан-Нас», дальше джузы 29, 28. */
  direction: 1 | -1;
  method: Method;
  nazira: { next: number; read: number[] };
  hifz: {
    /** Полностью выученные страницы в порядке заучивания. */
    memorized: number[];
    /** Выученные строки страниц, которые выучены не целиком: страница и отрезки [от, до). */
    parts?: Record<string, [number, number][]>;
    /** Страница, которая учится сейчас, и сколько её строк уже сдано. */
    cur: { page: number; line: number };
    /** Выученный урок, который ждёт сдачи устазу. */
    pending: LineRange | null;
    /** Урок, который учится прямо сейчас. */
    lesson: LessonProgress | null;
    /** Сколько групп манзиля сдано всего (по нему шёл круг, пока не было manzilAt). */
    manzilCursor: number;
    /** Последняя сданная страница манзиля: круг идёт со следующей за ней группы. */
    manzilAt?: number;
  };
  submissions: Submission[];
  /** Страница, отмеченная закладкой в мусхафе. */
  bookmark?: number;
  /** Когда ученика меняли в последний раз (мс): по этому числу видно, что надо отправить на сервер. */
  updatedAt?: number;
  days: Record<string, DayStats>;
}

export type Theme = "auto" | "light" | "dark";

export interface AppState {
  version: 1;
  /** Номер последней правки методики, применённой к сохранённым ученикам. */
  methodRev?: number;
  lang: Lang;
  /** Оформление: как в системе или в Telegram (auto), светлое или тёмное. */
  theme?: Theme;
  /** Чем сейчас занят человек: учится или ведёт группу. */
  role?: "student" | "teacher";
  students: Student[];
  activeId: string | null;
}

export interface PageLine {
  n: number;
  /** Индекс в v аята, с которого начинается строка. */
  f: number;
  /** Слова; число — знак конца аята с этим номером. */
  w: (string | number)[];
  /** Мединский мусхаф: коды глифов шрифта QCF страницы, по одному на каждый элемент w. */
  c?: string[];
}

export interface PageData {
  p: number;
  j: number;
  /** Номер четверти хизба (1–240), с которой начинается страница; в джузе их 8. */
  r?: number;
  v: string[];
  l: PageLine[];
}

export interface MushafMeta {
  mushaf: MushafId;
  pages: number;
  chunk: number;
  /**
   * [джуз, первый аят, последний аят, число текстовых строк, концы аятов] для каждой страницы.
   * Концы аятов: по символу на строку, "2" строка кончается концом аята, "1" аят кончается посреди строки, "0" нет.
   */
  page: [number, string, string, number, string?][];
  /** Где начинается каждая сура: [страница, строка]. */
  surah: [number, number][];
}

export interface Surah {
  n: number;
  ar: string;
  tr: string;
  ayahs: number;
  basmala: boolean;
  t: Record<Lang, string>;
}
