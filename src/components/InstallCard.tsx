import { useEffect, useState } from "react";
import { useT } from "../hooks";
import { promptInstall, useInstallWay } from "../install";
import { exportJson } from "../store";
import { haptic, tg } from "../telegram";

const HIDE = "quran-install-hidden";

function hidden() {
  try {
    return localStorage.getItem(HIDE) === "1";
  } catch {
    return false;
  }
}

/** Значок приложения на экране. `dismissible`: карточку на главном экране можно скрыть, в настройках она есть всегда. */
export function InstallCard({ dismissible }: { dismissible?: boolean }) {
  const t = useT();
  const way = useInstallWay();
  const [gone, setGone] = useState(hidden);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);

  useEffect(() => {
    const onFail = () => setFailed(true);
    tg?.onEvent?.("homeScreenFailed", onFail);
    return () => tg?.offEvent?.("homeScreenFailed", onFail);
  }, []);

  if (way === "done" || (dismissible && gone)) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportJson());
      setCopied("ok");
      haptic("success");
    } catch {
      setCopied("fail");
    }
  };
  const inTg = way === "telegram" || way === "telegram-desktop";
  const viaBrowser = way === "telegram-desktop" || failed;

  return (
    <section className="card install">
      <h3>{t("install_title")}</h3>
      {way === "telegram" && !failed && (
        <>
          <p className="muted">{t("install_tg")}</p>
          <button onClick={() => tg?.addToHomeScreen?.()}>{t("install_button")}</button>
        </>
      )}
      {way === "prompt" && (
        <>
          <p className="muted">{t("install_prompt")}</p>
          <button onClick={promptInstall}>{t("install_button")}</button>
        </>
      )}
      {way === "ios" && <p>{t("install_ios")}</p>}
      {way === "mac-safari" && <p>{t("install_mac")}</p>}
      {way === "manual" && <p>{t("install_manual")}</p>}
      {inTg && (
        <details open={viaBrowser}>
          <summary>{t("install_computer")}</summary>
          <p className="muted">{t("install_transfer")}</p>
          <div className="row">
            <button className="ghost" onClick={copy}>
              {t("install_copy")}
            </button>
            <button className="ghost" onClick={() => tg?.openLink?.(location.origin + location.pathname)}>
              {t("install_open")}
            </button>
          </div>
          {copied && <p role="status">{t(copied === "ok" ? "install_copied" : "install_copyFail")}</p>}
        </details>
      )}
      {dismissible && (
        <button
          className="link"
          onClick={() => {
            try {
              localStorage.setItem(HIDE, "1");
            } catch {
              /* хранилище недоступно: карточка вернётся в следующий раз */
            }
            setGone(true);
          }}
        >
          {t("install_hide")}
        </button>
      )}
    </section>
  );
}
