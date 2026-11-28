// Украшения страницы мусхафа: рамка начала суры и знак конца аята, как в приложении мединского мусхафа
// (с разрешения). Картинки в public/orn: рамка разрезана на левый край, середину и правый край,
// середина растягивается по ширине строки.

import type { ReactNode } from "react";
import { arabicDigits } from "../mushaf";

const ORN = `${import.meta.env.BASE_URL}orn/`;

/** Рамка с названием суры. */
export function SurahFrame({ children }: { children: ReactNode }) {
  return (
    <div className="surah-frame" dir="ltr">
      <img className="orn-end" src={`${ORN}frame-left.png`} alt="" aria-hidden="true" />
      <div className="orn-mid" style={{ backgroundImage: `url(${ORN}frame-mid.png)` }}>
        <span className="surah-name" dir="rtl">
          {children}
        </span>
      </div>
      <img className="orn-end" src={`${ORN}frame-right.png`} alt="" aria-hidden="true" />
    </div>
  );
}

/** Знак конца аята: розетка с номером. */
export function AyahMark({ n }: { n: number }) {
  return (
    <span className={`ayah-mark ${n > 99 ? "n3" : n > 9 ? "n2" : ""}`} style={{ backgroundImage: `url(${ORN}ayah.png)` }} role="img" aria-label={String(n)}>
      <span className="ayah-num">{arabicDigits(n)}</span>
    </span>
  );
}
