import { useEffect, useState } from "react";
import { DownloadSimple, X } from "@phosphor-icons/react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mq = window.matchMedia("(display-mode: standalone)").matches;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mq || ios;
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/**
 * Shows Install when the browser fires beforeinstallprompt (Chrome/Edge/Android).
 * On iOS Safari, shows short "Add to Home Screen" instructions.
 */
export default function InstallAppBanner() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    setStandalone(isStandalone());
    try {
      if (sessionStorage.getItem("cv-install-dismissed") === "1") setDismissed(true);
    } catch {
      /* ignore */
    }

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  if (standalone || dismissed) return null;

  const showIosHint = isIos() && !deferred;
  const showChromeInstall = Boolean(deferred);

  if (!showChromeInstall && !showIosHint) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem("cv-install-dismissed", "1");
    } catch {
      /* ignore */
    }
  };

  const install = async () => {
    if (!deferred) return;
    await deferred.prompt();
    try {
      await deferred.userChoice;
    } catch {
      /* ignore */
    }
    setDeferred(null);
  };

  return (
    <div className="fixed bottom-4 left-3 right-3 z-[90] mx-auto max-w-md rounded-2xl border border-emerald-500/40 bg-slate-900/95 p-3 shadow-xl shadow-black/40 backdrop-blur sm:left-auto sm:right-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
          <DownloadSimple size={22} weight="bold" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-white">Install ChamaVault</p>
          {showChromeInstall ? (
            <p className="mt-0.5 text-xs text-slate-300">
              Add to your home screen for quick access like an app.
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-slate-300">
              On iPhone: Safari → Share → <strong className="text-white">Add to Home Screen</strong>
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {showChromeInstall && (
              <button
                type="button"
                onClick={() => void install()}
                className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white"
              >
                Install app
              </button>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="rounded-xl border border-slate-600 px-3 py-1.5 text-xs font-semibold text-slate-300"
            >
              Not now
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1 text-slate-500 hover:text-white"
          aria-label="Dismiss"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
