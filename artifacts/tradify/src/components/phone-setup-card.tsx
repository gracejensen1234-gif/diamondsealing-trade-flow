import { useEffect, useMemo, useState } from "react";
import { Bell, CheckCircle2, Clipboard, Download, Share2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [installHelpOpen, setInstallHelpOpen] = useState(false);
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
    if (installPrompt) return "Tap Add to Home Screen to install SealFlow on this device.";
    if (platform === "ios") return "Tap Add to Home Screen for the quick iPhone steps.";
    if (platform === "android") return "Tap Add to Home Screen. Chrome will install directly when available.";
    return "Copy the phone link and open it in Safari on iPhone or Chrome on Android.";
  }, [installPrompt, installed, platform]);

  async function addToHomeScreen() {
    if (!installPrompt) {
      setInstallHelpOpen(true);
      return;
    }
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
    <>
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
            <Button type="button" size="sm" onClick={addToHomeScreen} className="justify-start" disabled={installed}>
              {installed ? <CheckCircle2 className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              {installed ? "Added to Home Screen" : "Add to Home Screen"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={copyLink} className="justify-start bg-white/60 dark:bg-black/20">
              <Clipboard className="h-4 w-4" />
              {copied ? "Link copied" : "Copy phone link"}
            </Button>
            <div className="flex items-center gap-2 rounded-md border border-orange-200 bg-white/60 px-3 py-2 text-xs dark:border-orange-900 dark:bg-black/20 sm:col-span-2">
              {platform === "ios" ? <Share2 className="h-4 w-4 shrink-0" /> : <Bell className="h-4 w-4 shrink-0" />}
              <span>Notifications need the employee to tap Enable notifications, then Allow.</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={installHelpOpen} onOpenChange={setInstallHelpOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-md bg-orange-500 text-white">
              <Smartphone className="h-5 w-5" />
            </div>
            <DialogTitle>Add SealFlow to Home Screen</DialogTitle>
            <DialogDescription>
              {platform === "ios"
                ? "iPhone requires this final step through Safari."
                : "If your browser does not show an install prompt, use these quick steps."}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border bg-muted/40 px-3 py-3 text-sm">
            {platform === "ios" ? (
              <ol className="list-decimal space-y-1 pl-4">
                <li>Open this link in Safari.</li>
                <li>Tap the Share button.</li>
                <li>Tap Add to Home Screen.</li>
                <li>Tap Add.</li>
              </ol>
            ) : (
              <ol className="list-decimal space-y-1 pl-4">
                <li>Open this link in Chrome.</li>
                <li>Tap the menu button.</li>
                <li>Tap Install app or Add to Home screen.</li>
              </ol>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={copyLink}>
              {copied ? "Link copied" : "Copy link"}
            </Button>
            <Button type="button" onClick={() => setInstallHelpOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
