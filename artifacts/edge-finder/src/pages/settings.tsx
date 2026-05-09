import { useState, useEffect } from "react";
import { useTheme } from "next-themes";
import { useSubscribeAlerts, useGetVapidPublicKey } from "@workspace/api-client-react";
import { Moon, Sun, Bell, BellOff, Shield, AlertTriangle, Flame, CheckCircle2, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AlertStatus = "idle" | "pending" | "granted" | "denied" | "unsupported";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [minEdge, setMinEdge] = useState("3");
  const [bankroll, setBankroll] = useState("1000");
  const [alertStatus, setAlertStatus] = useState<AlertStatus>("idle");
  const [currentEndpoint, setCurrentEndpoint] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/auth/user", { credentials: "include" })
      .then((r) => r.json())
      .then((d: any) => setUserId(d.id || null))
      .catch(() => {});
  }, []);

  function copyId() {
    if (!userId) return;
    navigator.clipboard.writeText(userId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const subscribeAlerts = useSubscribeAlerts();
  const { data: vapidData } = useGetVapidPublicKey();

  // Detect if browser already granted push permission
  useEffect(() => {
    if (!("Notification" in window)) {
      setAlertStatus("unsupported");
      return;
    }
    if (Notification.permission === "granted") {
      // Check if we have a push subscription active
      navigator.serviceWorker.ready.then((reg) => {
        reg.pushManager.getSubscription().then((sub) => {
          if (sub) {
            setCurrentEndpoint(sub.endpoint);
            setAlertStatus("granted");
          }
        });
      }).catch(() => {});
    } else if (Notification.permission === "denied") {
      setAlertStatus("denied");
    }
  }, []);

  async function enableSteamAlerts() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setAlertStatus("unsupported");
      return;
    }

    if (!vapidData?.publicKey) {
      setAlertStatus("denied");
      return;
    }

    setAlertStatus("pending");

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setAlertStatus("denied");
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
      });

      const json = sub.toJSON();
      await subscribeAlerts.mutateAsync({
        data: {
          endpoint: sub.endpoint,
          keys: {
            p256dh: json.keys?.p256dh ?? "",
            auth: json.keys?.auth ?? "",
          },
          minEdge: parseFloat(minEdge) || 3,
          sports: [],
        },
      });

      setCurrentEndpoint(sub.endpoint);
      setAlertStatus("granted");
    } catch {
      setAlertStatus("denied");
    }
  }

  async function disableSteamAlerts() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/alerts/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setCurrentEndpoint(null);
      setAlertStatus("idle");
    } catch {
      // best effort
      setAlertStatus("idle");
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-5 pb-20 md:pb-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Configure your BJ's Pro Picks preferences</p>
      </div>

      {/* Appearance */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Appearance</h2>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Dark Mode</Label>
              <p className="text-xs text-muted-foreground mt-0.5">High-contrast dark theme for extended use</p>
            </div>
            <div className="flex items-center gap-2">
              <Sun className="h-4 w-4 text-muted-foreground" />
              <Switch
                checked={theme === "dark"}
                onCheckedChange={(v) => setTheme(v ? "dark" : "light")}
                data-testid="switch-dark-mode"
              />
              <Moon className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </div>
      </div>

      {/* Steam Move Alerts */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">Steam Move Alerts</h2>
          </div>
        </div>
        <div className="px-4 py-4 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Receive a push notification the moment <strong className="text-foreground">2 or more bookmakers</strong> simultaneously move the same line in the same direction — a classic signal of sharp money entering the market.
          </p>

          {alertStatus === "unsupported" && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
              Push notifications are not supported in this browser.
            </div>
          )}

          {alertStatus === "denied" && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
              Notifications are blocked. Enable them in your browser settings and reload.
            </div>
          )}

          {alertStatus === "granted" && (
            <div className="flex items-center gap-2 text-xs text-primary bg-primary/10 rounded-md px-3 py-2">
              <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />
              Steam move alerts are active. You'll be notified within 5 minutes of a detected move.
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">
                {alertStatus === "granted" ? "Alerts Active" : "Enable Steam Alerts"}
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Browser push · updates every 5 min · no account required
              </p>
            </div>
            {alertStatus === "granted" ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={disableSteamAlerts}
                data-testid="button-disable-alerts"
              >
                <BellOff className="h-3.5 w-3.5 mr-1.5" />
                Disable
              </Button>
            ) : (
              <Button
                variant={alertStatus === "denied" || alertStatus === "unsupported" ? "outline" : "default"}
                size="sm"
                onClick={enableSteamAlerts}
                disabled={alertStatus === "pending" || alertStatus === "denied" || alertStatus === "unsupported" || !vapidData}
                data-testid="button-enable-alerts"
              >
                {alertStatus === "pending"
                  ? "Requesting…"
                  : <><Bell className="h-3.5 w-3.5 mr-1.5" />Enable</>}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Preferences */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Preferences</h2>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Min Edge Threshold (%)</Label>
              <Input
                type="number"
                min="0"
                max="20"
                step="0.5"
                value={minEdge}
                onChange={(e) => setMinEdge(e.target.value)}
                className="font-mono"
                data-testid="input-min-edge"
              />
              <p className="text-[10px] text-muted-foreground">Only show value bets above this edge</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Starting Bankroll ($)</Label>
              <Input
                type="number"
                min="0"
                step="50"
                value={bankroll}
                onChange={(e) => setBankroll(e.target.value)}
                className="font-mono"
                data-testid="input-bankroll"
              />
              <p className="text-[10px] text-muted-foreground">Used for Kelly Criterion sizing</p>
            </div>
          </div>

          <Button size="sm" onClick={() => {}} data-testid="button-save-settings">
            Save Preferences
          </Button>
        </div>
      </div>

      {/* API Configuration */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">API Configuration</h2>
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">The Odds API Key</Label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Enter your API key to fetch real odds"
                className="font-mono text-xs"
                data-testid="input-odds-api-key"
              />
              <Button variant="outline" size="sm" data-testid="button-save-api-key">Save</Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Get a key at <a href="https://the-odds-api.com" target="_blank" rel="noreferrer" className="text-primary hover:underline">the-odds-api.com</a> to fetch live odds from DraftKings, FanDuel, BetMGM, and more.
            </p>
          </div>
        </div>
      </div>

      {/* Account Info */}
      {userId && (
        <div className="bg-card border border-border rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold">Your Account</h2>
          <div>
            <p className="text-xs text-muted-foreground mb-1.5">User ID — share with the site owner to request admin access</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs font-mono bg-muted/50 px-3 py-2 rounded border border-border truncate">
                {userId}
              </code>
              <button
                onClick={copyId}
                className="flex items-center gap-1.5 text-xs px-3 py-2 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors flex-shrink-0"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-4">
        <div className="flex gap-3">
          <AlertTriangle className="h-4 w-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Shield className="h-3.5 w-3.5 text-yellow-400" />
              <span className="text-sm font-semibold text-yellow-400">For Entertainment Only</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              BJ's Pro Picks is for entertainment and educational purposes only. The predictions and edge calculations shown are based on statistical models and do not guarantee winning outcomes. Gambling involves risk. Please bet responsibly and within your means. If you or someone you know has a gambling problem, call the National Problem Gambling Helpline at <strong className="text-foreground">1-800-522-4700</strong>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
