import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCircle2, Clipboard, Download, Share2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isStandaloneApp() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function platformLabel(userAgent: string) {
  const isiOS = /iphone|ipad|ipod/i.test(userAgent);
  const isAndroid = /android/i.test(userAgent);
  if (isiOS) return "ios";
  if (isAndroid) return "android";
  return "desktop";
}

export function PhoneSetupCard({ className, compact = false }: { className?: string; compact?: boolean }) {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [copied, setCopied] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");
  const appUrl = "https://diamond-sealing-operations.onrender.com";

  useEffect(() => {
    setInstalled(isStandaloneApp());
    setPlatform(platformLabel(navigator.userAgent));

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const primaryStep = useMemo(() => {
    if (installed) return "SealFlow is already installed on this phone.";
    if (platform === "ios") return "Open in Safari, tap Share, then Add to Home Screen.";
    if (platform === "android") return "Open in Chrome, then tap Install app or Add to Home screen.";
    return "Copy the phone link and open it in Safari on iPhone or Chrome on Android.";
  }, [installed, platform]);

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstalled(true);
    setInstallPrompt(null);
  }

  async function copyLink() {
    await navigator.clipboard?.writeText(appUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <Card className={cn("border-orange-200 bg-orange-50 text-orange-950 shadow-sm dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-100", className)}>
      <CardContent className={cn("space-y-3", compact ? "p-3" : "p-4")}>
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-orange-500 text-white">
            {installed ? <CheckCircle2 className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Phone setup</p>
            <p className="mt-0.5 text-xs text-orange-800 dark:text-orange-200">{primaryStep}</p>
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {installPrompt && !installed ? (
            <Button type="button" size="sm" onClick={installApp} className="justify-start">
              <Download className="h-4 w-4" />
              Install SealFlow
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={copyLink} className="justify-start bg-white/60 dark:bg-black/20">
              <Clipboard className="h-4 w-4" />
              {copied ? "Link copied" : "Copy phone link"}
            </Button>
          )}
          <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-white/60 px-3 py-2 text-xs dark:border-orange-900 dark:bg-black/20">
            {platform === "ios" ? <Share2 className="h-4 w-4 shrink-0" /> : <Bell className="h-4 w-4 shrink-0" />}
            <span>Notifications need the employee to tap Allow after opening Field View.</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
