import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Save, RefreshCw } from "lucide-react";

const DAYS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "2", label: "Tuesday" },
  { value: "3", label: "Wednesday" },
  { value: "4", label: "Thursday" },
  { value: "5", label: "Friday" },
  { value: "6", label: "Saturday" },
];

const HOURS = Array.from({ length: 25 }, (_, i) => ({
  value: String(i),
  label: i === 24 ? "Midnight (end of day)" : i === 0 ? "12:00 AM" : i === 12 ? "12:00 PM" : i < 12 ? `${i}:00 AM` : `${i - 12}:00 PM`,
}));

export default function SettingsPage() {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
  });

  const [syncEnabled, setSyncEnabled] = useState(true);
  const [syncInterval, setSyncInterval] = useState("60");
  const [openDay, setOpenDay] = useState("6");
  const [openHour, setOpenHour] = useState("12");
  const [closeDay, setCloseDay] = useState("3");
  const [closeHour, setCloseHour] = useState("24");

  useEffect(() => {
    if (settings) {
      setSyncEnabled(settings.sync_enabled !== "false");
      setSyncInterval(settings.sync_interval_minutes || "60");
      setOpenDay(settings.order_window_open_day || "6");
      setOpenHour(settings.order_window_open_hour || "12");
      setCloseDay(settings.order_window_close_day || "3");
      setCloseHour(settings.order_window_close_hour || "24");
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) => apiRequest("POST", "/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved", description: "Auto-sync schedule updated." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const syncNowMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/woo/sync-products");
      return apiRequest("POST", "/api/woo/sync-orders");
    },
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Sync complete", description: `Orders: imported=${data.imported}, updated=${data.updated}` });
    },
    onError: (error: Error) => {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    saveMutation.mutate({
      sync_enabled: String(syncEnabled),
      sync_interval_minutes: syncInterval,
      order_window_open_day: openDay,
      order_window_open_hour: openHour,
      order_window_close_day: closeDay,
      order_window_close_hour: closeHour,
    });
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure sync schedule and order window</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Auto-Sync</CardTitle>
          <CardDescription>Automatically sync orders and products from WooCommerce</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="sync-enabled">Enable Auto-Sync</Label>
            <Switch
              id="sync-enabled"
              checked={syncEnabled}
              onCheckedChange={setSyncEnabled}
              data-testid="switch-sync-enabled"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sync-interval">Sync Interval (minutes)</Label>
            <Input
              id="sync-interval"
              type="number"
              min={5}
              max={1440}
              value={syncInterval}
              onChange={(e) => setSyncInterval(e.target.value)}
              disabled={!syncEnabled}
              data-testid="input-sync-interval"
            />
            <p className="text-xs text-muted-foreground">
              How often to sync orders from WooCommerce (default: 60 minutes)
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => syncNowMutation.mutate()}
            disabled={syncNowMutation.isPending}
            data-testid="button-sync-now"
          >
            <RefreshCw className={`w-4 h-4 mr-1 ${syncNowMutation.isPending ? "animate-spin" : ""}`} />
            {syncNowMutation.isPending ? "Syncing..." : "Sync Now"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Order Window</CardTitle>
          <CardDescription>Define when the order window opens and closes each week</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Opens On</Label>
              <Select value={openDay} onValueChange={setOpenDay}>
                <SelectTrigger data-testid="select-open-day">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Opens At</Label>
              <Select value={openHour} onValueChange={setOpenHour}>
                <SelectTrigger data-testid="select-open-hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.filter(h => h.value !== "24").map(h => (
                    <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Closes On</Label>
              <Select value={closeDay} onValueChange={setCloseDay}>
                <SelectTrigger data-testid="select-close-day">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DAYS.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Closes At</Label>
              <Select value={closeHour} onValueChange={setCloseHour}>
                <SelectTrigger data-testid="select-close-hour">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map(h => (
                    <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            Current: {DAYS.find(d => d.value === openDay)?.label} at {HOURS.find(h => h.value === openHour)?.label} to {DAYS.find(d => d.value === closeDay)?.label} at {HOURS.find(h => h.value === closeHour)?.label}
          </p>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-settings">
        <Save className="w-4 h-4 mr-1" />
        {saveMutation.isPending ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
