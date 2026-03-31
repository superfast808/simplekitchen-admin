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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Save, RefreshCw, Upload, Trash2, Image, UserPlus, X, CalendarDays, Mail, CreditCard, Package } from "lucide-react";

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
  const [emailSubject, setEmailSubject] = useState("Choose Your Meals This Week - Simple Kitchen Prep");
  const [emailBody, setEmailBody] = useState("");
  const [portalUrl, setPortalUrl] = useState("https://admin.simplekitchenprep.com");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [testSmtpEmail, setTestSmtpEmail] = useState("");
  const [stripeMode, setStripeMode] = useState<"test" | "live">("test");
  const [stripeTestSecretKey, setStripeTestSecretKey] = useState("");
  const [stripeTestPublishableKey, setStripeTestPublishableKey] = useState("");
  const [stripeLiveSecretKey, setStripeLiveSecretKey] = useState("");
  const [stripeLivePublishableKey, setStripeLivePublishableKey] = useState("");
  const [packagingCost, setPackagingCost] = useState("0");

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
      if (settings.subscription_email_subject) setEmailSubject(settings.subscription_email_subject);
      if (settings.subscription_email_body) setEmailBody(settings.subscription_email_body);
      if (settings.portal_url) setPortalUrl(settings.portal_url);
      if (settings.smtp_host) setSmtpHost(settings.smtp_host);
      if (settings.smtp_port) setSmtpPort(settings.smtp_port);
      if (settings.smtp_user) setSmtpUser(settings.smtp_user);
      if (settings.smtp_pass && settings.smtp_pass !== "••••••••") setSmtpPass(settings.smtp_pass);
      if (settings.smtp_from) setSmtpFrom(settings.smtp_from);
      if (settings.stripe_mode === "live" || settings.stripe_mode === "test") setStripeMode(settings.stripe_mode);
      if (settings.stripe_test_publishable_key) setStripeTestPublishableKey(settings.stripe_test_publishable_key);
      if (settings.stripe_live_publishable_key) setStripeLivePublishableKey(settings.stripe_live_publishable_key);
      if (settings.packaging_cost != null) setPackagingCost(settings.packaging_cost);
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

  const testSmtpMutation = useMutation({
    mutationFn: async (to: string) => {
      const res = await apiRequest("POST", "/api/settings/test-smtp", { to });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Failed to send test email");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Test email sent!", description: `A test email was delivered to ${data.to}. Check your inbox.` });
    },
    onError: (error: Error) => {
      toast({ title: "Test failed", description: error.message, variant: "destructive" });
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
      subscription_email_subject: emailSubject,
      subscription_email_body: emailBody,
      portal_url: portalUrl,
      smtp_host: smtpHost,
      smtp_port: smtpPort,
      smtp_user: smtpUser,
      smtp_from: smtpFrom,
    };
    if (smtpPass) data.smtp_pass = smtpPass;
    data.stripe_mode = stripeMode;
    data.stripe_test_publishable_key = stripeTestPublishableKey;
    data.stripe_live_publishable_key = stripeLivePublishableKey;
    if (stripeTestSecretKey) data.stripe_test_secret_key = stripeTestSecretKey;
    if (stripeLiveSecretKey) data.stripe_live_secret_key = stripeLiveSecretKey;
    if (week1ReferenceDate) {
      data.week1ReferenceDate = new Date(week1ReferenceDate).toISOString();
    }
    data.packaging_cost = packagingCost || "0";
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
            <Package className="w-4 h-4" />
            Costs
          </CardTitle>
          <CardDescription>Operational costs applied to ingredient and stats calculations</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="packaging-cost">Packaging cost per meal (£)</Label>
            <Input
              id="packaging-cost"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={packagingCost}
              onChange={e => setPackagingCost(e.target.value)}
              className="max-w-[180px]"
              data-testid="input-packaging-cost"
            />
            <p className="text-xs text-muted-foreground">
              Added to ingredient cost-per-meal on the Ingredients page and used in Weekly Stats to show total packaging spend.
            </p>
          </div>
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

      <Card>
        <CardHeader>
          <CardTitle>Portal URL</CardTitle>
          <CardDescription>The public domain of this portal — used in subscription email links sent to customers</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={portalUrl}
            onChange={(e) => setPortalUrl(e.target.value)}
            placeholder="https://admin.simplekitchenprep.com"
            data-testid="input-portal-url"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Customers clicking their meal-selection link will be directed to this domain.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            SMTP Email Settings
          </CardTitle>
          <CardDescription>Configure the outgoing mail server used to send subscription invite emails</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="smtp-host">SMTP Host</Label>
              <Input
                id="smtp-host"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com"
                data-testid="input-smtp-host"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value)}
                placeholder="587"
                data-testid="input-smtp-port"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="smtp-from">From Address</Label>
            <Input
              id="smtp-from"
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              placeholder="noreply@simplekitchenprep.com"
              data-testid="input-smtp-from"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="smtp-user">Username</Label>
              <Input
                id="smtp-user"
                value={smtpUser}
                onChange={(e) => setSmtpUser(e.target.value)}
                placeholder="your@email.com"
                data-testid="input-smtp-user"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="smtp-pass">Password</Label>
              <Input
                id="smtp-pass"
                type="password"
                value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)}
                placeholder="Leave blank to keep existing"
                data-testid="input-smtp-pass"
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            These settings override any environment-variable SMTP configuration. Leave password blank if you only want to update other fields.
          </p>
          <div className="border-t pt-4 space-y-3">
            <p className="text-sm font-medium">Send a test email</p>
            <div className="flex gap-2">
              <Input
                type="email"
                value={testSmtpEmail}
                onChange={(e) => setTestSmtpEmail(e.target.value)}
                placeholder="recipient@example.com"
                className="flex-1"
                data-testid="input-test-smtp-email"
              />
              <Button
                variant="outline"
                onClick={() => testSmtpMutation.mutate(testSmtpEmail)}
                disabled={testSmtpMutation.isPending || !testSmtpEmail.trim()}
                data-testid="button-test-smtp"
              >
                {testSmtpMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4 mr-2" />
                )}
                {testSmtpMutation.isPending ? "Sending…" : "Send Test"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Save your SMTP settings first, then enter any address here to verify the connection works.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Subscription Email Template
          </CardTitle>
          <CardDescription>
            Customise the email sent when subscription meal selection links are issued. Available variables: <code className="text-xs bg-muted px-1 py-0.5 rounded">{"{{firstName}}"}</code> <code className="text-xs bg-muted px-1 py-0.5 rounded">{"{{fullName}}"}</code> <code className="text-xs bg-muted px-1 py-0.5 rounded">{"{{qty}}"}</code> <code className="text-xs bg-muted px-1 py-0.5 rounded">{"{{url}}"}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email-subject">Subject line</Label>
            <Input
              id="email-subject"
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Email subject"
              data-testid="input-email-subject"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email-body">Email body (HTML)</Label>
            <Textarea
              id="email-body"
              value={emailBody}
              onChange={(e) => setEmailBody(e.target.value)}
              rows={12}
              className="font-mono text-xs"
              placeholder="Enter HTML email body here…"
              data-testid="textarea-email-body"
            />
            <p className="text-xs text-muted-foreground">
              This HTML is wrapped in a centred 600px container before sending. Use <code className="bg-muted px-0.5 rounded">{"{{url}}"}</code> wherever you want the selection link to appear (in href attributes or as visible text).
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            Stripe Payments
          </CardTitle>
          <CardDescription>
            Configure Stripe to charge customers for add-on extras. Secret keys are stored securely and never displayed after saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-3">
            <Label className="w-32 shrink-0">Mode</Label>
            <Select value={stripeMode} onValueChange={(v) => setStripeMode(v as "test" | "live")}>
              <SelectTrigger className="w-40" data-testid="select-stripe-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="test">Test mode</SelectItem>
                <SelectItem value="live">Live mode</SelectItem>
              </SelectContent>
            </Select>
            {stripeMode === "live" && (
              <span className="text-xs font-medium text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/20 px-2 py-1 rounded">
                Live payments active
              </span>
            )}
          </div>

          <div className="space-y-4">
            <p className="text-sm font-medium text-muted-foreground">Test keys (pk_test_ / sk_test_)</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="stripe-test-pk">Publishable key</Label>
                <Input
                  id="stripe-test-pk"
                  value={stripeTestPublishableKey}
                  onChange={(e) => setStripeTestPublishableKey(e.target.value)}
                  placeholder="pk_test_…"
                  data-testid="input-stripe-test-publishable-key"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="stripe-test-sk">Secret key</Label>
                <Input
                  id="stripe-test-sk"
                  type="password"
                  value={stripeTestSecretKey}
                  onChange={(e) => setStripeTestSecretKey(e.target.value)}
                  placeholder={settings?.stripe_test_secret_key ? "••••••••  (saved)" : "sk_test_…"}
                  data-testid="input-stripe-test-secret-key"
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm font-medium text-muted-foreground">Live keys (pk_live_ / sk_live_)</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="stripe-live-pk">Publishable key</Label>
                <Input
                  id="stripe-live-pk"
                  value={stripeLivePublishableKey}
                  onChange={(e) => setStripeLivePublishableKey(e.target.value)}
                  placeholder="pk_live_…"
                  data-testid="input-stripe-live-publishable-key"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="stripe-live-sk">Secret key</Label>
                <Input
                  id="stripe-live-sk"
                  type="password"
                  value={stripeLiveSecretKey}
                  onChange={(e) => setStripeLiveSecretKey(e.target.value)}
                  placeholder={settings?.stripe_live_secret_key ? "••••••••  (saved)" : "sk_live_…"}
                  data-testid="input-stripe-live-secret-key"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Leave secret key fields blank to keep the existing saved key. The active mode's keys will be used for all Stripe requests.
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
