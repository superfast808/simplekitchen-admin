import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Save, RefreshCw, Upload, Trash2, Image, UserPlus, X, CalendarDays } from "lucide-react";

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

function UserManagementCard() {
  const { toast } = useToast();
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const { data: usersList, isLoading: usersLoading } = useQuery<Array<{ id: string; username: string }>>({
    queryKey: ["/api/users"],
  });

  const createUserMutation = useMutation({
    mutationFn: (data: { username: string; password: string }) =>
      apiRequest("POST", "/api/users", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setNewUsername("");
      setNewPassword("");
      toast({ title: "User created", description: "New user has been added." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create user", description: error.message, variant: "destructive" });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete user", description: error.message, variant: "destructive" });
    },
  });

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) return;
    createUserMutation.mutate({ username: newUsername.trim(), password: newPassword });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>User Management</CardTitle>
        <CardDescription>Manage users who can access this portal</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {usersLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : (
          <div className="space-y-2">
            {usersList?.map(user => (
              <div key={user.id} className="flex items-center justify-between p-2 rounded-md border" data-testid={`row-user-${user.id}`}>
                <span className="text-sm font-medium" data-testid={`text-username-${user.id}`}>{user.username}</span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => deleteUserMutation.mutate(user.id)}
                  disabled={deleteUserMutation.isPending || (usersList?.length || 0) <= 1}
                  data-testid={`button-delete-user-${user.id}`}
                  title="Delete user"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleAddUser} className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="new-username">Username</Label>
            <Input
              id="new-username"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              placeholder="New username"
              data-testid="input-new-username"
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="new-password">Password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="Password"
              data-testid="input-new-password"
            />
          </div>
          <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-add-user">
            <UserPlus className="w-4 h-4 mr-1" />
            Add
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

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
  const [week1ReferenceDate, setWeek1ReferenceDate] = useState("");

  const { data: currentWeek } = useQuery<{ weekNumber: number; categoryName: string; week1ReferenceDate: string | null }>({
    queryKey: ["/api/current-week"],
  });

  useEffect(() => {
    if (settings) {
      setSyncEnabled(settings.sync_enabled !== "false");
      setSyncInterval(settings.sync_interval_minutes || "60");
      setOpenDay(settings.order_window_open_day || "6");
      setOpenHour(settings.order_window_open_hour || "12");
      setCloseDay(settings.order_window_close_day || "3");
      setCloseHour(settings.order_window_close_hour || "24");
      if (settings.week1ReferenceDate) {
        const d = new Date(settings.week1ReferenceDate);
        const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        setWeek1ReferenceDate(local);
      }
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
    const data: Record<string, string> = {
      sync_enabled: String(syncEnabled),
      sync_interval_minutes: syncInterval,
      order_window_open_day: openDay,
      order_window_open_hour: openHour,
      order_window_close_day: closeDay,
      order_window_close_hour: closeHour,
    };
    if (week1ReferenceDate) {
      data.week1ReferenceDate = new Date(week1ReferenceDate).toISOString();
    }
    saveMutation.mutate(data);
  };

  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: logoData } = useQuery<{ logo: string }>({
    queryKey: ["/api/settings/logo"],
    retry: false,
  });

  const uploadLogoMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("logo", file);
      const res = await fetch("/api/settings/logo", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/logo"] });
      toast({ title: "Logo uploaded", description: "Your logo has been saved." });
    },
    onError: (error: Error) => {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    },
  });

  const removeLogoMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/settings/logo"),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/logo"] });
      toast({ title: "Logo removed", description: "Default icon will be shown." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove logo", description: error.message, variant: "destructive" });
    },
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadLogoMutation.mutate(file);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-2xl">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const hasLogo = logoData?.logo && logoData.logo.length > 0;

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">Settings</h1>
        <p className="text-sm text-muted-foreground">Configure sync schedule and order window</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Branding</CardTitle>
          <CardDescription>Upload a logo to display in the sidebar</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {hasLogo ? (
              <div className="flex items-center justify-center w-16 h-16 rounded-md border overflow-hidden">
                <img
                  src={logoData.logo}
                  alt="Logo"
                  className="w-full h-full object-contain"
                  data-testid="img-logo-preview"
                />
              </div>
            ) : (
              <div className="flex items-center justify-center w-16 h-16 rounded-md border bg-muted">
                <Image className="w-6 h-6 text-muted-foreground" />
              </div>
            )}
            <div className="space-y-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
                data-testid="input-logo-upload"
              />
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadLogoMutation.isPending}
                  data-testid="button-upload-logo"
                >
                  <Upload className="w-4 h-4 mr-1" />
                  {uploadLogoMutation.isPending ? "Uploading..." : "Upload Logo"}
                </Button>
                {hasLogo && (
                  <Button
                    variant="outline"
                    onClick={() => removeLogoMutation.mutate()}
                    disabled={removeLogoMutation.isPending}
                    data-testid="button-remove-logo"
                  >
                    <Trash2 className="w-4 h-4 mr-1" />
                    Remove
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Recommended: Square image, max 5MB
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <UserManagementCard />

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4" />
            Week Rotation
          </CardTitle>
          <CardDescription>
            Products are categorised by week (Week 1–6) in WooCommerce. Set when Week 1 last started so the portal knows which week's meals to show.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {currentWeek && (
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted">
              <div>
                <p className="text-sm font-medium">Current week</p>
                <p className="text-2xl font-bold">Week {currentWeek.weekNumber}</p>
                {!currentWeek.week1ReferenceDate && (
                  <p className="text-xs text-muted-foreground mt-0.5">Set a reference date below to enable automatic rotation</p>
                )}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="week1-ref-date">Week 1 started on (date &amp; time)</Label>
            <Input
              id="week1-ref-date"
              type="datetime-local"
              value={week1ReferenceDate}
              onChange={(e) => setWeek1ReferenceDate(e.target.value)}
              data-testid="input-week1-reference-date"
            />
            <p className="text-xs text-muted-foreground">
              The Saturday noon when Week 1 last started. The week number advances every 7 days from this date, cycling 1→2→3→4→5→6→1.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-settings">
        <Save className="w-4 h-4 mr-1" />
        {saveMutation.isPending ? "Saving..." : "Save Settings"}
      </Button>
    </div>
  );
}
