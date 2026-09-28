import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  CloudCog,
  CreditCard,
  Database,
  HardDrive,
  Mail,
  RefreshCw,
  Server,
  ShoppingCart,
  Users,
  Webhook,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SystemStatus = {
  status: "ok" | "degraded";
  checkedAt: string;
  responseMs?: number;
  error?: string;
  deployment?: {
    platform?: string;
    environment?: string;
    service?: string;
    hostname?: string | null;
  };
  runtime?: {
    node: string;
    uptimeSeconds: number;
    memory: {
      rssBytes: number;
      heapUsedBytes: number;
      heapTotalBytes: number;
    };
  };
  database?: {
    connected: boolean;
    name?: string;
    user?: string;
    serverVersion?: string;
    sizeBytes?: number;
    serverTime?: string;
    counts?: {
      orders: number;
      products: number;
      users: number;
      subscribers: number;
    };
  };
  integrations?: {
    woocommerce: { configured: boolean; storeUrl: string | null };
    smtp: { configured: boolean; host: string | null; from: string | null };
    stripe: { configured: boolean; mode: string };
    webhooks: {
      wooCommerceConfigured: boolean;
      stripeSubscriberConfigured: boolean;
    };
  };
  sync?: {
    enabled: boolean;
    intervalMinutes: number;
    inProgress: boolean;
    subscriberSyncInProgress: boolean;
    geocodeInProgress: boolean;
    lastStartedAt: string | null;
    lastCompletedAt: string | null;
    lastError: string | null;
    lastSummary: {
      imported: number;
      updated: number;
      total: number;
    } | null;
  };
};

function formatBytes(bytes?: number) {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i];
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

function formatUptime(seconds?: number) {
  if (seconds == null) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDate(value?: string | null) {
  if (!value) return "Not yet recorded";
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

function StatePill({ ok, text }: { ok: boolean; text?: string }) {
  return (
    <span
      className={
        ok
          ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
          : "inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
      }
    >
      {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {text || (ok ? "Operational" : "Needs attention")}
    </span>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof Activity;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

export default function SystemStatusPage() {
  const { data, error, isLoading, isFetching, refetch } = useQuery<SystemStatus>({
    queryKey: ["/api/system/status"],
    queryFn: async () => {
      const response = await fetch("/api/system/status", { credentials: "include" });
      const body = (await response.json()) as SystemStatus;
      if (!response.ok && response.status !== 503) {
        throw new Error(body.error || `Status check failed (${response.status})`);
      }
      return body;
    },
    refetchInterval: 15_000,
    staleTime: 0,
  });

  const healthy = data?.status === "ok" && data.database?.connected !== false;
  const counts = data?.database?.counts;

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <RefreshCw className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">System Status</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Live application, database and integration health for the Simple Kitchen Admin platform.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {error && !data ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="flex items-start gap-3 p-5">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <p className="font-semibold text-destructive">Status endpoint unavailable</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "The status endpoint could not be reached."}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card
            className={
              healthy
                ? "overflow-hidden border-emerald-300 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20"
                : "overflow-hidden border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20"
            }
          >
            <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
              <div className="flex items-center gap-3">
                <div
                  className={
                    healthy
                      ? "flex h-11 w-11 items-center justify-center rounded-full bg-emerald-600 text-white"
                      : "flex h-11 w-11 items-center justify-center rounded-full bg-amber-500 text-white"
                  }
                >
                  {healthy ? <CheckCircle2 className="h-6 w-6" /> : <AlertTriangle className="h-6 w-6" />}
                </div>
                <div>
                  <p className="text-lg font-semibold">
                    {healthy ? "All core systems operational" : "System needs attention"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {data?.deployment?.service || "Simple Kitchen Admin"} ·{" "}
                    <strong>{data?.deployment?.platform || "Plesk / Docker"}</strong>
                  </p>
                </div>
              </div>
              <div className="text-right text-xs text-muted-foreground">
                <div>Checked {formatDate(data?.checkedAt)}</div>
                {data?.responseMs != null && <div>{data.responseMs} ms server check</div>}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Server className="h-4 w-4" />
                  Deployment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <StatePill ok={healthy} text={data?.deployment?.platform || "Plesk / Docker"} />
                <div className="grid grid-cols-[100px_1fr] gap-1 text-xs">
                  <span className="text-muted-foreground">Environment</span>
                  <span className="font-medium">{data?.deployment?.environment || "—"}</span>
                  <span className="text-muted-foreground">Container</span>
                  <span className="truncate font-mono">{data?.deployment?.hostname || "—"}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Database className="h-4 w-4" />
                  PostgreSQL
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <StatePill ok={Boolean(data?.database?.connected)} />
                <div className="grid grid-cols-[100px_1fr] gap-1 text-xs">
                  <span className="text-muted-foreground">Version</span>
                  <span>{data?.database?.serverVersion || "—"}</span>
                  <span className="text-muted-foreground">Database</span>
                  <span>{data?.database?.name || "—"}</span>
                  <span className="text-muted-foreground">Size</span>
                  <span>{formatBytes(data?.database?.sizeBytes)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <CloudCog className="h-4 w-4" />
                  Application
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <StatePill ok={Boolean(data?.runtime)} />
                <div className="grid grid-cols-[100px_1fr] gap-1 text-xs">
                  <span className="text-muted-foreground">Node</span>
                  <span>{data?.runtime?.node || "—"}</span>
                  <span className="text-muted-foreground">Uptime</span>
                  <span>{formatUptime(data?.runtime?.uptimeSeconds)}</span>
                  <span className="text-muted-foreground">Memory RSS</span>
                  <span>{formatBytes(data?.runtime?.memory.rssBytes)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <RefreshCw className="h-4 w-4" />
                  Order Sync
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <StatePill
                  ok={Boolean(data?.sync?.enabled && !data?.sync?.lastError)}
                  text={
                    data?.sync?.inProgress
                      ? "Syncing now"
                      : data?.sync?.enabled
                        ? `Every ${data.sync.intervalMinutes} min`
                        : "Disabled"
                  }
                />
                <div className="space-y-1 text-xs">
                  <div className="text-muted-foreground">Last completed</div>
                  <div>{formatDate(data?.sync?.lastCompletedAt)}</div>
                  {data?.sync?.lastSummary && (
                    <div className="text-muted-foreground">
                      {data.sync.lastSummary.imported} imported · {data.sync.lastSummary.updated} updated ·{" "}
                      {data.sync.lastSummary.total} checked
                    </div>
                  )}
                  {data?.sync?.lastError && <div className="font-medium text-destructive">{data.sync.lastError}</div>}
                </div>
              </CardContent>
            </Card>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Live data</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Orders" value={counts?.orders ?? "—"} icon={ShoppingCart} />
              <Metric label="Products" value={counts?.products ?? "—"} icon={HardDrive} />
              <Metric label="Portal users" value={counts?.users ?? "—"} icon={Users} />
              <Metric label="Subscribers" value={counts?.subscribers ?? "—"} icon={Users} />
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Integrations</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <ShoppingCart className="h-4 w-4" /> WooCommerce
                  </span>
                  <StatePill ok={Boolean(data?.integrations?.woocommerce.configured)} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {data?.integrations?.woocommerce.storeUrl || "Store credentials not configured"}
                </p>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Mail className="h-4 w-4" /> SMTP
                  </span>
                  <StatePill ok={Boolean(data?.integrations?.smtp.configured)} />
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {data?.integrations?.smtp.host || "Mail server not configured"}
                </p>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <CreditCard className="h-4 w-4" /> Stripe
                  </span>
                  <StatePill
                    ok={Boolean(data?.integrations?.stripe.configured)}
                    text={data?.integrations?.stripe.configured ? `${data.integrations.stripe.mode} mode` : "Not configured"}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Keys are checked for presence only and are never displayed.</p>
              </div>

              <div className="rounded-lg border p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <Webhook className="h-4 w-4" /> Webhooks
                  </span>
                  <StatePill
                    ok={Boolean(
                      data?.integrations?.webhooks.wooCommerceConfigured &&
                        data?.integrations?.webhooks.stripeSubscriberConfigured,
                    )}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  WooCommerce {data?.integrations?.webhooks.wooCommerceConfigured ? "✓" : "—"} · Stripe{" "}
                  {data?.integrations?.webhooks.stripeSubscriberConfigured ? "✓" : "—"}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Clock3 className="h-3.5 w-3.5" />
              Auto-refreshes every 15 seconds
            </span>
            <span>
              Public monitor endpoint: <code className="rounded bg-muted px-1 py-0.5">/healthz</code>
            </span>
          </div>
        </>
      )}
    </div>
  );
}
