import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, addDays } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft, ChevronRight, UtensilsCrossed, PoundSterling, Receipt,
  Truck, UserPlus, UserCheck, TrendingUp, TrendingDown, Globe, Stamp, Package,
  Banknote, CreditCard, ShoppingBag,
} from "lucide-react";
import { DeliveryDatePills } from "@/components/date-filter";

type OrderItem = { productName: string; quantity: number; price: string };
type OrderWithItems = {
  id: number;
  customerName: string;
  customerEmail: string | null;
  fulfillmentType: string;
  isManual: boolean;
  isTuesday: boolean;
  cashAmount: string | null;
  paymentMethod: string | null;
  shippingTotal: string | null;
  items: OrderItem[];
};
type GroupStats = {
  orderCount: number;
  mealsSold: number;
  packagableMeals: number;
  revenue: number;
  avgOrderValue: number;
  deliveryStops: number;
  mealCounts: Record<string, number>;
};

function getWeekRange(offset: number): { from: Date; to: Date; isCurrent: boolean } {
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const dayOfWeek = ukNow.getDay();

  let saturdayDate: Date;
  if (dayOfWeek === 6) {
    saturdayDate = new Date(ukNow);
  } else {
    const daysBack = dayOfWeek === 0 ? 1 : dayOfWeek + 1;
    saturdayDate = subDays(ukNow, daysBack);
  }
  if (offset !== 0) saturdayDate = addDays(saturdayDate, offset * 7);

  const from = new Date(saturdayDate);
  from.setHours(0, 0, 0, 0);
  const wednesday = addDays(saturdayDate, 4);
  const to = new Date(wednesday);
  to.setHours(23, 59, 59, 999);
  return { from, to, isCurrent: offset === 0 };
}

function isVisibleCurrentWeek(): boolean {
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const day = ukNow.getDay();
  const hour = ukNow.getHours();
  if (day === 6 && hour >= 12) return false;
  return day !== 6 || hour < 12;
}

function filterItems(
  items: OrderItem[],
  hideAddons: boolean,
  hideAddDelivery: boolean,
  hideSubscriptionBase: boolean,
): OrderItem[] {
  return items.filter(item => {
    const name = item.productName.toLowerCase();
    const price = parseFloat(item.price || "0");
    if (hideAddDelivery && /add.*delivery/i.test(name)) return false;
    if (hideSubscriptionBase && /meal\s+subscription/i.test(item.productName)) return false;
    if (hideAddons && price > 0 && price <= 4.05) return false;
    return true;
  });
}

const SUB_RE = /meal\s+subscription/i;
const NO_PACKAGING_RE = /oat|porridge|overnight|soup/i;

function computeGroup(
  orders: OrderWithItems[],
  hideAddons: boolean,
  hideAddDelivery: boolean,
  hideSubscriptionBase: boolean,
  allOrders?: OrderWithItems[],
  includeDelivery = true,
): GroupStats {
  // Customers who have a WooCommerce subscription order in this period —
  // their manual recurring orders are operational records only; actual payment
  // (including delivery) is captured in the WooCommerce subscription order.
  const subCustomers = new Set(
    (allOrders ?? orders)
      .filter(o => !o.isManual && o.items.some(i => SUB_RE.test(i.productName)))
      .map(o => o.customerName)
  );

  let mealsSold = 0, packagableMeals = 0, revenue = 0, deliveryStops = 0;
  const mealCounts: Record<string, number> = {};
  for (const order of orders) {
    const items = filterItems(order.items, hideAddons, hideAddDelivery, hideSubscriptionBase);
    if (order.fulfillmentType === "delivery") deliveryStops++;

    const cashAmount = parseFloat(order.cashAmount || "0");
    if (cashAmount > 0) {
      // Cash/bank amount entered — use it directly (delivery already included in what they paid)
      revenue += cashAmount;
    } else if (order.isManual && subCustomers.has(order.customerName)) {
      // Subscription customer: their revenue + delivery is in the WooCommerce sub order — skip
    } else {
      // WooCommerce order or B2B manual order without cashAmount yet
      if (includeDelivery) revenue += parseFloat(order.shippingTotal || "0");
      for (const item of items) {
        const unitPrice = parseFloat(item.price || "0");
        revenue += order.isManual ? unitPrice * item.quantity : unitPrice;
      }
    }

    for (const item of items) {
      mealsSold += item.quantity;
      if (!NO_PACKAGING_RE.test(item.productName)) packagableMeals += item.quantity;
      mealCounts[item.productName] = (mealCounts[item.productName] || 0) + item.quantity;
    }
  }
  const orderCount = orders.length;
  return { orderCount, mealsSold, packagableMeals, revenue, avgOrderValue: orderCount > 0 ? revenue / orderCount : 0, deliveryStops, mealCounts };
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

export default function WeeklyStatsPage() {
  const [offset, setOffset] = useState(0);
  const [hideAddons, setHideAddons] = useState(false);
  const [hideAddDelivery, setHideAddDelivery] = useState(false);
  const [hideSubscriptionBase, setHideSubscriptionBase] = useState(false);
  const [includeDelivery, setIncludeDelivery] = useState(true);

  const { from, to, isCurrent } = getWeekRange(offset);
  const canViewCurrent = isVisibleCurrentWeek();
  const effectiveRange = isCurrent && !canViewCurrent ? getWeekRange(-1) : { from, to };
  const displayRange = effectiveRange;

  const { data: rawOrders, isLoading } = useQuery<OrderWithItems[]>({
    queryKey: ["/api/orders", `?from=${effectiveRange.from.toISOString()}&to=${effectiveRange.to.toISOString()}`],
  });

  const { data: legacyStats } = useQuery<{ newCustomers: number; returningCustomers: number }>({
    queryKey: ["/api/weekly-stats", effectiveRange.from.toISOString(), effectiveRange.to.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: effectiveRange.from.toISOString(),
        to: effectiveRange.to.toISOString(),
      });
      const res = await fetch(`/api/weekly-stats?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
  });

  const packagingCost = parseFloat(settings?.packaging_cost || "0") || 0;

  const computed = useMemo(() => {
    if (!rawOrders) return null;
    const webOrders = rawOrders.filter(o => !o.isManual);
    const manualOrders = rawOrders.filter(o => o.isManual);
    const all = computeGroup(rawOrders, hideAddons, hideAddDelivery, hideSubscriptionBase, rawOrders, includeDelivery);
    const web = computeGroup(webOrders, hideAddons, hideAddDelivery, hideSubscriptionBase, rawOrders, includeDelivery);
    const manual = computeGroup(manualOrders, hideAddons, hideAddDelivery, hideSubscriptionBase, rawOrders, includeDelivery);
    const entries = Object.entries(all.mealCounts).sort((a, b) => b[1] - a[1]);
    const topSeller = entries.length > 0 ? `${entries[0][0]} (${entries[0][1]})` : "—";
    const worstSeller = entries.length > 0 ? `${entries[entries.length - 1][0]} (${entries[entries.length - 1][1]})` : "—";

    // Three-bucket revenue breakdown
    const subCustomers = new Set(
      rawOrders
        .filter(o => !o.isManual && o.items.some(i => SUB_RE.test(i.productName)))
        .map(o => o.customerName)
    );
    let cashRevenue = 0, bankRevenue = 0, onlineSubsRevenue = 0, onlineOtherRevenue = 0;
    for (const o of rawOrders) {
      const cash = parseFloat(o.cashAmount || "0");
      if (o.isManual) {
        if (cash > 0) {
          if (o.paymentMethod === "cash") cashRevenue += cash;
          else if (o.paymentMethod === "bank_transfer") bankRevenue += cash;
          else bankRevenue += cash; // default untagged manual payments to bank
        }
        // Manual without cashAmount & subscription customer → £0 (already in WooCommerce sub)
      } else {
        const items = filterItems(o.items, hideAddons, hideAddDelivery, hideSubscriptionBase);
        const shipping = includeDelivery ? parseFloat(o.shippingTotal || "0") : 0;
        const itemRev = items.reduce((s, i) => s + parseFloat(i.price || "0"), 0);
        const orderRev = itemRev + shipping;
        if (o.items.some(i => SUB_RE.test(i.productName))) onlineSubsRevenue += orderRev;
        else onlineOtherRevenue += orderRev;
      }
    }

    return { all, web, manual, topSeller, worstSeller, cashRevenue, bankRevenue, onlineSubsRevenue, onlineOtherRevenue };
  }, [rawOrders, hideAddons, hideAddDelivery, hideSubscriptionBase, includeDelivery]);

  const filters = [
    { id: "hideAddons", label: "Hide addons (≤ £4 items)", checked: hideAddons, onChange: setHideAddons },
    { id: "hideAddDelivery", label: "Hide Add Delivery (£4.99)", checked: hideAddDelivery, onChange: setHideAddDelivery },
    { id: "hideSubscriptionBase", label: "Hide subscription base orders", checked: hideSubscriptionBase, onChange: setHideSubscriptionBase },
    { id: "includeDelivery", label: "Include delivery in revenue", checked: includeDelivery, onChange: setIncludeDelivery },
  ];

  const totalPackagingCost = computed ? packagingCost * computed.all.packagableMeals : 0;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-weekly-stats-title">Weekly Stats</h1>
          <p className="text-sm text-muted-foreground" data-testid="text-weekly-stats-range">
            {format(displayRange.from, "EEE, MMM d")} – {format(displayRange.to, "EEE, MMM d, yyyy")}
          </p>
          <DeliveryDatePills weekStart={displayRange.from} />
          {isCurrent && !canViewCurrent && offset === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" data-testid="text-stats-cutoff-notice">
              Current week stats hidden after Saturday noon — showing previous week
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setOffset(o => o - 1)} data-testid="button-stats-prev">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOffset(0)} data-testid="button-stats-current">
            {canViewCurrent ? "This Week" : "Latest"}
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setOffset(o => o + 1)} disabled={offset >= 0} data-testid="button-stats-next">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap gap-x-6 gap-y-2 items-center">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Filters</span>
            {filters.map(f => (
              <div key={f.id} className="flex items-center gap-2">
                <Checkbox
                  id={f.id}
                  checked={f.checked}
                  onCheckedChange={(v) => f.onChange(!!v)}
                  data-testid={`checkbox-filter-${f.id}`}
                />
                <Label htmlFor={f.id} className="text-sm cursor-pointer">{f.label}</Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <div className="h-4 w-20 bg-muted animate-pulse rounded mb-3" />
                <div className="h-8 w-16 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : computed ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {([
              { key: "mealsSold", label: "Meals Sold", note: "", icon: UtensilsCrossed, color: "border-l-orange-500", iconColor: "text-orange-500", bgColor: "bg-orange-50 dark:bg-orange-950/30", fmt: (v: number) => String(v) },
              { key: "revenue", label: "Revenue", note: "cash/bank if entered, else item prices", icon: PoundSterling, color: "border-l-emerald-500", iconColor: "text-emerald-500", bgColor: "bg-emerald-50 dark:bg-emerald-950/30", fmt: (v: number) => `£${v.toFixed(2)}` },
              { key: "avgOrderValue", label: "Avg Order", note: "", icon: Receipt, color: "border-l-blue-500", iconColor: "text-blue-500", bgColor: "bg-blue-50 dark:bg-blue-950/30", fmt: (v: number) => `£${v.toFixed(2)}` },
              { key: "deliveryStops", label: "Delivery Stops", note: "", icon: Truck, color: "border-l-violet-500", iconColor: "text-violet-500", bgColor: "bg-violet-50 dark:bg-violet-950/30", fmt: (v: number) => String(v) },
            ] as const).map(card => {
              const value = computed.all[card.key as keyof typeof computed.all] as number;
              const Icon = card.icon;
              return (
                <Card key={card.key} className={`border-l-4 ${card.color} ${card.bgColor}`} data-testid={`card-stat-${card.key}`}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-4 h-4 ${card.iconColor}`} />
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</span>
                    </div>
                    <p className="text-2xl font-bold tabular-nums" data-testid={`text-stat-${card.key}`}>{card.fmt(value)}</p>
                    {card.note ? <p className="text-[10px] text-muted-foreground mt-0.5">{card.note}</p> : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="border-l-4 border-l-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" data-testid="card-revenue-breakdown">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <PoundSterling className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue Breakdown</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  = £{computed.all.revenue.toFixed(2)} total
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex flex-col gap-1" data-testid="stat-revenue-cash">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Banknote className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-xs font-medium uppercase tracking-wide">Cash</span>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-green-700 dark:text-green-400">£{computed.cashRevenue.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">Manual orders marked cash</p>
                </div>
                <div className="flex flex-col gap-1" data-testid="stat-revenue-bank">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <CreditCard className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-medium uppercase tracking-wide">Bank Transfer</span>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-blue-700 dark:text-blue-400">£{computed.bankRevenue.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">B2B / store orders</p>
                </div>
                <div className="flex flex-col gap-1" data-testid="stat-revenue-online-subs">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <ShoppingBag className="w-3.5 h-3.5 text-violet-600" />
                    <span className="text-xs font-medium uppercase tracking-wide">Subscriptions</span>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-violet-700 dark:text-violet-400">£{computed.onlineSubsRevenue.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">WooCommerce subscription payments{includeDelivery ? " incl. delivery" : ""}</p>
                </div>
                <div className="flex flex-col gap-1" data-testid="stat-revenue-online-other">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Globe className="w-3.5 h-3.5 text-sky-600" />
                    <span className="text-xs font-medium uppercase tracking-wide">Website Orders + Extras</span>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-sky-700 dark:text-sky-400">£{computed.onlineOtherRevenue.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">Website orders & optional subscriber extras{includeDelivery ? " incl. delivery" : ""}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {packagingCost > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="border-l-4 border-l-slate-500 bg-slate-50 dark:bg-slate-950/30" data-testid="card-stat-packagingCostPerMeal">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Packaging / Meal</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums" data-testid="text-stat-packagingCostPerMeal">
                    £{packagingCost.toFixed(2)}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-slate-400 bg-slate-50 dark:bg-slate-950/30" data-testid="card-stat-totalPackagingCost">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Packaging</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums" data-testid="text-stat-totalPackagingCost">
                    £{totalPackagingCost.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{computed.all.packagableMeals} meals × £{packagingCost.toFixed(2)} (excl. oats &amp; soups)</p>
                </CardContent>
              </Card>
              <Card className="col-span-2 border-l-4 border-l-rose-500 bg-rose-50 dark:bg-rose-950/30" data-testid="card-stat-revenueAfterPackaging">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <PoundSterling className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue After Packaging</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums" data-testid="text-stat-revenueAfterPackaging">
                    £{(computed.all.revenue - totalPackagingCost).toFixed(2)}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Revenue £{computed.all.revenue.toFixed(2)} − Packaging £{totalPackagingCost.toFixed(2)}</p>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-l-4 border-l-sky-500 bg-sky-50 dark:bg-sky-950/30" data-testid="card-stat-web">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Globe className="w-4 h-4 text-sky-500" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Web Orders</span>
                  <span className="ml-auto text-sm font-semibold tabular-nums">{computed.web.orderCount} orders</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <StatMini label="Meals" value={String(computed.web.mealsSold)} />
                  <StatMini label="Revenue" value={`£${computed.web.revenue.toFixed(2)}`} />
                  <StatMini label="Deliveries" value={String(computed.web.deliveryStops)} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 text-center">Cash/bank amount used where entered</p>
              </CardContent>
            </Card>

            <Card className="border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/30" data-testid="card-stat-manual">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Stamp className="w-4 h-4 text-amber-500" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Consistent / Manual</span>
                  <span className="ml-auto text-sm font-semibold tabular-nums">{computed.manual.orderCount} orders</span>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <StatMini label="Meals" value={String(computed.manual.mealsSold)} />
                  <StatMini label="Revenue" value={`£${computed.manual.revenue.toFixed(2)}`} />
                  <StatMini label="Deliveries" value={String(computed.manual.deliveryStops)} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-2 text-center">Cash/bank amount used where entered</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="border-l-4 border-l-cyan-500 bg-cyan-50 dark:bg-cyan-950/30" data-testid="card-stat-newCustomers">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <UserPlus className="w-4 h-4 text-cyan-500" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">New Customers</span>
                </div>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-stat-newCustomers">
                  {legacyStats?.newCustomers ?? "—"}
                </p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-pink-500 bg-pink-50 dark:bg-pink-950/30" data-testid="card-stat-returningCustomers">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <UserCheck className="w-4 h-4 text-pink-500" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Returning</span>
                </div>
                <p className="text-2xl font-bold tabular-nums" data-testid="text-stat-returningCustomers">
                  {legacyStats?.returningCustomers ?? "—"}
                </p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-green-500 bg-green-50 dark:bg-green-950/30 col-span-2" data-testid="card-stat-topSeller">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="w-4 h-4 text-green-500" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Top Seller</span>
                </div>
                <p className="text-lg font-bold" data-testid="text-stat-topSeller">{computed.topSeller}</p>
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-red-500 bg-red-50 dark:bg-red-950/30 col-span-2" data-testid="card-stat-worstSeller">
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Worst Seller</span>
                </div>
                <p className="text-lg font-bold" data-testid="text-stat-worstSeller">{computed.worstSeller}</p>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
