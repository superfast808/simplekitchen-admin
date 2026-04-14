import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, endOfMonth, subMonths, addMonths } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft, ChevronRight, UtensilsCrossed, PoundSterling, Receipt,
  Truck, TrendingUp, Globe, Stamp, Package,
  Banknote, CreditCard, ShoppingBag, RefreshCw, CalendarDays,
} from "lucide-react";

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

const SUB_RE = /meal\s+subscription/i;
const OAT_RE = /oat|porridge|overnight/i;
const SOUP_RE = /soup/i;

function filterItems(items: OrderItem[], hideAddons: boolean, hideAddDelivery: boolean, hideSubscriptionBase: boolean): OrderItem[] {
  return items.filter(item => {
    const name = item.productName.toLowerCase();
    const price = parseFloat(item.price || "0");
    if (hideAddDelivery && /add.*delivery/i.test(name)) return false;
    if (hideSubscriptionBase && SUB_RE.test(item.productName)) return false;
    if (hideAddons && price > 0 && price <= 4.50) return false;
    return true;
  });
}

function computeGroup(
  orders: OrderWithItems[],
  hideAddons: boolean,
  hideAddDelivery: boolean,
  hideSubscriptionBase: boolean,
  allOrders?: OrderWithItems[],
  includeDelivery = true,
) {
  const subCustomers = new Set(
    (allOrders ?? orders)
      .filter(o => !o.isManual && o.items.some(i => SUB_RE.test(i.productName)))
      .map(o => o.customerName)
  );

  let mealsSold = 0, revenue = 0, deliveryStops = 0;
  const mealCounts: Record<string, number> = {};

  for (const order of orders) {
    const items = filterItems(order.items, hideAddons, hideAddDelivery, hideSubscriptionBase);
    if (order.fulfillmentType === "delivery") deliveryStops++;

    const cashAmount = parseFloat(order.cashAmount || "0");
    if (cashAmount > 0) {
      revenue += cashAmount;
    } else if (order.isManual && subCustomers.has(order.customerName)) {
      // skip
    } else {
      if (includeDelivery) revenue += parseFloat(order.shippingTotal || "0");
      for (const item of items) {
        const unitPrice = parseFloat(item.price || "0");
        revenue += order.isManual ? unitPrice * item.quantity : unitPrice;
      }
    }

    for (const item of items) {
      if (/meal\s+subscription/i.test(item.productName)) continue;
      if (/add.*delivery/i.test(item.productName)) continue;
      mealsSold += item.quantity;
      mealCounts[item.productName] = (mealCounts[item.productName] || 0) + item.quantity;
    }
  }

  let numMeals = 0, numOats = 0, numSoups = 0, numSnacks = 0;
  for (const order of orders) {
    const items = filterItems(order.items, hideAddons, hideAddDelivery, hideSubscriptionBase);
    for (const item of items) {
      if (/meal\s+subscription/i.test(item.productName)) continue;
      if (/add.*delivery/i.test(item.productName)) continue;
      if (OAT_RE.test(item.productName)) { numOats += item.quantity; continue; }
      if (SOUP_RE.test(item.productName)) { numSoups += item.quantity; continue; }
      const price = parseFloat(item.price || "0");
      if (price > 0 && price <= 4.50) numSnacks += item.quantity;
      else numMeals += item.quantity;
    }
  }

  const orderCount = orders.length;
  return { orderCount, mealsSold, numMeals, numOats, numSoups, numSnacks, revenue, avgOrderValue: orderCount > 0 ? revenue / orderCount : 0, deliveryStops, mealCounts };
}

function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-xl font-bold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}

function getMonthRange(monthOffset: number): { from: Date; to: Date; label: string; isCurrent: boolean } {
  const now = new Date();
  const base = monthOffset === 0 ? now : addMonths(startOfMonth(now), monthOffset);
  const from = startOfMonth(base);
  const to = monthOffset === 0 ? now : endOfMonth(base);
  const label = format(from, "MMMM yyyy");
  return { from, to, label, isCurrent: monthOffset === 0 };
}

export default function MonthlyStatsPage() {
  const [monthOffset, setMonthOffset] = useState(0);
  const [hideAddons, setHideAddons] = useState(false);
  const [hideAddDelivery, setHideAddDelivery] = useState(false);
  const [hideSubscriptionBase, setHideSubscriptionBase] = useState(false);
  const [includeDelivery, setIncludeDelivery] = useState(true);

  const { from, to, label, isCurrent } = getMonthRange(monthOffset);

  const { data: rawOrders, isLoading, isFetching } = useQuery<OrderWithItems[]>({
    queryKey: ["/api/orders", `?from=${from.toISOString()}&to=${to.toISOString()}`],
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
          else bankRevenue += cash;
        }
      } else {
        const items = filterItems(o.items, hideAddons, hideAddDelivery, hideSubscriptionBase);
        const shipping = includeDelivery ? parseFloat(o.shippingTotal || "0") : 0;
        const itemRev = items.reduce((s, i) => s + parseFloat(i.price || "0"), 0);
        const orderRev = itemRev + shipping;
        if (o.items.some(i => SUB_RE.test(i.productName))) onlineSubsRevenue += orderRev;
        else onlineOtherRevenue += orderRev;
      }
    }

    const totalWeeks = Math.ceil((to.getTime() - from.getTime()) / (7 * 24 * 60 * 60 * 1000));
    const packagableMeals = all.numMeals;

    return { all, web, manual, topSeller, cashRevenue, bankRevenue, onlineSubsRevenue, onlineOtherRevenue, totalWeeks, packagableMeals };
  }, [rawOrders, hideAddons, hideAddDelivery, hideSubscriptionBase, includeDelivery, from, to]);

  const totalPackagingCost = computed ? packagingCost * computed.packagableMeals : 0;

  const filters = [
    { id: "hideAddons", label: "Hide addons (≤ £4.50 items)", checked: hideAddons, onChange: setHideAddons },
    { id: "hideAddDelivery", label: "Hide Add Delivery (£5.49)", checked: hideAddDelivery, onChange: setHideAddDelivery },
    { id: "hideSubscriptionBase", label: "Hide subscription base orders", checked: hideSubscriptionBase, onChange: setHideSubscriptionBase },
    { id: "includeDelivery", label: "Include delivery in revenue", checked: includeDelivery, onChange: setIncludeDelivery },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="w-6 h-6" />
            Monthly Stats
          </h1>
          <p className="text-sm text-muted-foreground">
            {label}{isCurrent ? ` — MTD (up to ${format(to, "EEE d MMM")})` : ` (full month)`}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setMonthOffset(o => o - 1)} data-testid="button-month-prev">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setMonthOffset(0)} data-testid="button-month-current">
            This Month
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setMonthOffset(o => o + 1)} disabled={monthOffset >= 0} data-testid="button-month-next">
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
                <Checkbox id={`m-${f.id}`} checked={f.checked} onCheckedChange={(v) => f.onChange(!!v)} data-testid={`checkbox-month-filter-${f.id}`} />
                <Label htmlFor={`m-${f.id}`} className="text-sm cursor-pointer">{f.label}</Label>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><div className="h-4 w-20 bg-muted animate-pulse rounded mb-3" /><div className="h-8 w-16 bg-muted animate-pulse rounded" /></CardContent></Card>
          ))}
        </div>
      ) : computed ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {([
              { key: "mealsSold", label: "Meals Sold", icon: UtensilsCrossed, color: "border-l-orange-500", iconColor: "text-orange-500", bgColor: "bg-orange-50 dark:bg-orange-950/30", fmt: (v: number) => String(v) },
              { key: "revenue", label: "Revenue MTD", icon: PoundSterling, color: "border-l-emerald-500", iconColor: "text-emerald-500", bgColor: "bg-emerald-50 dark:bg-emerald-950/30", fmt: (v: number) => `£${v.toFixed(2)}` },
              { key: "avgOrderValue", label: "Avg Order", icon: Receipt, color: "border-l-blue-500", iconColor: "text-blue-500", bgColor: "bg-blue-50 dark:bg-blue-950/30", fmt: (v: number) => `£${v.toFixed(2)}` },
              { key: "deliveryStops", label: "Delivery Stops", icon: Truck, color: "border-l-violet-500", iconColor: "text-violet-500", bgColor: "bg-violet-50 dark:bg-violet-950/30", fmt: (v: number) => String(v) },
            ] as const).map(card => {
              const value = computed.all[card.key as keyof typeof computed.all] as number;
              const Icon = card.icon;
              return (
                <Card key={card.key} className={`border-l-4 ${card.color} ${card.bgColor}`} data-testid={`card-month-stat-${card.key}`}>
                  <CardContent className="p-5">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-4 h-4 ${card.iconColor}`} />
                      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{card.label}</span>
                    </div>
                    <p className="text-2xl font-bold tabular-nums inline-flex items-center gap-1.5">
                      {card.fmt(value)}
                      {isFetching && !isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="border-l-4 border-l-orange-400 bg-orange-50 dark:bg-orange-950/30" data-testid="card-month-product-breakdown">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <UtensilsCrossed className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Product Breakdown</span>
                <span className="ml-auto text-[10px] text-muted-foreground">= {computed.all.mealsSold} total sold</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Meals</span>
                  <p className="text-2xl font-bold tabular-nums">{computed.all.numMeals}</p>
                  <p className="text-[10px] text-muted-foreground">Main meal boxes</p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Oats</span>
                  <p className="text-2xl font-bold tabular-nums">{computed.all.numOats}</p>
                  <p className="text-[10px] text-muted-foreground">Overnight oats / porridge</p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Soups</span>
                  <p className="text-2xl font-bold tabular-nums">{computed.all.numSoups}</p>
                  <p className="text-[10px] text-muted-foreground">Soups</p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Snacks</span>
                  <p className="text-2xl font-bold tabular-nums">{computed.all.numSnacks}</p>
                  <p className="text-[10px] text-muted-foreground">Extras ≤ £4.50</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-emerald-400 bg-emerald-50 dark:bg-emerald-950/30" data-testid="card-month-revenue-breakdown">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <PoundSterling className="w-4 h-4 text-emerald-500" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue Breakdown</span>
                <span className="ml-auto text-[10px] text-muted-foreground">= £{computed.all.revenue.toFixed(2)} total</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Banknote className="w-3.5 h-3.5 text-green-600" />
                    <span className="text-xs font-medium uppercase tracking-wide">Cash</span>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-green-700 dark:text-green-400">£{computed.cashRevenue.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">Manual orders marked cash</p>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <CreditCard className="w-3.5 h-3.5 text-blue-600" />
                    <span className="text-xs font-medium uppercase tracking-wide">Bank Transfer</span>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-blue-700 dark:text-blue-400">£{computed.bankRevenue.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">B2B / store orders</p>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <ShoppingBag className="w-3.5 h-3.5 text-violet-600" />
                    <span className="text-xs font-medium uppercase tracking-wide">Subscriptions</span>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-violet-700 dark:text-violet-400">£{computed.onlineSubsRevenue.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">WooCommerce subscription payments{includeDelivery ? " incl. delivery" : ""}</p>
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Globe className="w-3.5 h-3.5 text-sky-600" />
                    <span className="text-xs font-medium uppercase tracking-wide">Website Orders</span>
                  </div>
                  <p className="text-xl font-bold tabular-nums text-sky-700 dark:text-sky-400">£{computed.onlineOtherRevenue.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">Website orders & extras{includeDelivery ? " incl. delivery" : ""}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {packagingCost > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <Card className="border-l-4 border-l-slate-500 bg-slate-50 dark:bg-slate-950/30">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-4 h-4 text-slate-500" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Packaging / Meal</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">£{packagingCost.toFixed(2)}</p>
                </CardContent>
              </Card>
              <Card className="border-l-4 border-l-slate-400 bg-slate-50 dark:bg-slate-950/30">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-4 h-4 text-slate-400" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Total Packaging</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">£{totalPackagingCost.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{computed.packagableMeals} meals × £{packagingCost.toFixed(2)}</p>
                </CardContent>
              </Card>
              <Card className="col-span-2 border-l-4 border-l-rose-500 bg-rose-50 dark:bg-rose-950/30">
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <PoundSterling className="w-4 h-4 text-rose-500" />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Revenue After Packaging</span>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">£{(computed.all.revenue - totalPackagingCost).toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">Revenue £{computed.all.revenue.toFixed(2)} − Packaging £{totalPackagingCost.toFixed(2)}</p>
                </CardContent>
              </Card>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-l-4 border-l-sky-500 bg-sky-50 dark:bg-sky-950/30">
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
              </CardContent>
            </Card>
            <Card className="border-l-4 border-l-amber-500 bg-amber-50 dark:bg-amber-950/30">
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
              </CardContent>
            </Card>
          </div>

          {Object.keys(computed.all.mealCounts).length > 0 && (
            <Card>
              <CardContent className="p-5">
                <div className="flex items-center gap-2 mb-4">
                  <TrendingUp className="w-4 h-4 text-muted-foreground" />
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Top Products This Month</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(computed.all.mealCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([name, count]) => (
                      <div key={name} className="flex items-center gap-1.5 bg-muted rounded-full px-3 py-1">
                        <span className="text-xs font-medium">{name}</span>
                        <span className="text-xs font-bold tabular-nums text-muted-foreground">{count}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
