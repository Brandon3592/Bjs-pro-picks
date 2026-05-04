import { useState } from "react";
import { useTheme } from "next-themes";
import { useSubscribeAlerts } from "@workspace/api-client-react";
import { Moon, Sun, Bell, BellOff, Shield, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [minEdge, setMinEdge] = useState("3");
  const [bankroll, setBankroll] = useState("1000");
  const [notifStatus, setNotifStatus] = useState<"idle" | "pending" | "granted" | "denied">("idle");

  const subscribeAlerts = useSubscribeAlerts();

  async function enablePushAlerts() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setNotifStatus("denied");
      return;
    }

    setNotifStatus("pending");
    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      setNotifStatus("denied");
      return;
    }

    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
      });

      const json = sub.toJSON();
      subscribeAlerts.mutate({
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

      setNotifStatus("granted");
    } catch {
      setNotifStatus("denied");
    }
  }

  return (
    <div className="p-4 md:p-6 space-y-5 pb-20 md:pb-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">Configure your EdgeFinder preferences</p>
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

      {/* Alerts */}
      <div className="bg-card border border-card-border rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Push Alerts</h2>
        </div>
        <div className="px-4 py-4 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label className="text-sm font-medium">Edge Alerts</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Get notified when new value bets appear or odds shift significantly</p>
            </div>
            <Button
              variant={notifStatus === "granted" ? "secondary" : "outline"}
              size="sm"
              onClick={enablePushAlerts}
              disabled={notifStatus === "pending" || notifStatus === "granted" || notifStatus === "denied"}
              data-testid="button-enable-alerts"
            >
              {notifStatus === "idle" && <><Bell className="h-3.5 w-3.5 mr-1.5" />Enable</>}
              {notifStatus === "pending" && "Requesting..."}
              {notifStatus === "granted" && <><Bell className="h-3.5 w-3.5 mr-1.5" />Active</>}
              {notifStatus === "denied" && <><BellOff className="h-3.5 w-3.5 mr-1.5" />Blocked</>}
            </Button>
          </div>
          {notifStatus === "denied" && (
            <p className="text-xs text-destructive">Notifications blocked. Please enable them in your browser settings.</p>
          )}
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

      {/* API Keys */}
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
              EdgeFinder is for entertainment and educational purposes only. The predictions and edge calculations shown are based on statistical models and do not guarantee winning outcomes. Gambling involves risk. Please bet responsibly and within your means. If you or someone you know has a gambling problem, call the National Problem Gambling Helpline at <strong className="text-foreground">1-800-522-4700</strong>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
