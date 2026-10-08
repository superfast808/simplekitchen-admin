import { DebugExportButton } from "@/components/debug-export-button";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  ChevronLeft, ChevronRight, UtensilsCrossed, PoundSterling, Receipt,
  Truck, UserPlus, UserCheck, TrendingUp, TrendingDown, Globe, Stamp, Package,
  Banknote, CreditCard, ShoppingBag, RefreshCw,
} from "lucide-react";
import { DeliveryDatePills, getOrderWindow } from "@/components/date-filter";

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
type VerifyResult = {
  checkedAt:string;orderCount:number;totalUnits:number;
  products:{productName:string;quantity:number;orders:{orderId:number;customerName:string;quantity:number}[]}[];
  duplicates:{first:number;second:number;customerName:string;reason:string}[];
  orders:{id:number;wooId:number|null;customerName:string;isTuesday:boolean;items:{name:string;quantity:number}[]}[];
};
type GroupStats = {
  orderCount: number;
  mealsSold: number;
  packagableMeals: number;
  numMeals: number;
  numOats: number;
  numSoups: number;
  numSnacks: number;
  revenue: number;
  avgOrderValue: number;
  deliveryStops: number;
  mealCounts: Record<string, number>;
};

function getWeekRange(offset: number): { from: Date; to: Date; isCurrent: boolean } {
  const { from, to } = getOrderWindow(offset);
  return { from, to, isCurrent: offset === 0 };
}

/** True after Thursday 07:00 UK — the production cutoff when this week's meal count is locked. */
function isWeekFinalized(): boolean {
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const day = ukNow.getDay(); // 4 = Thursday
  const hour = ukNow.getHours();
  // Thursday 7am or later (but before Saturday when the new week starts)
  return (day === 4 && hour >= 7) || day === 5; // Thu≥7am or Friday
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
    if (hideAddons && price > 0 && price <= 4.50) return false;
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

  let mealsSold = 0, packagableMeals = 0, numOats = 0, numSoups = 0, revenue = 0, deliveryStops = 0;
  const mealCounts: Record<string, number> = {};
  const OAT_RE = /oat|porridge|overnight/i;
  const SOUP_RE = /soup/i;
  for (const order of orders) {
    const items = filterItems(order.items, hideAddons, hideAddDelivery, hideSubscriptionBase);
    if (order.fulfillmentType === "delivery") deliveryStops++;

    const cashAmount = parseFloat(order.cashAmount || "0");
    if (cashAmount > 0) {
      revenue += cashAmount;
    } else if (order.isManual && subCustomers.has(order.customerName)) {
      // Subscription customer: revenue is in the WooCommerce sub order — skip
    } else {
      if (includeDelivery) revenue += parseFloat(order.shippingTotal || "0");
      for (const item of items) {
        const unitPrice = parseFloat(item.price || "0");
        revenue += order.isManual ? unitPrice * item.quantity : unitPrice;
      }
    }

    for (const item of items) {
      const isSubBase = /meal\s+subscription/i.test(item.productName);
      const isDelivery = /add.*delivery/i.test(item.productName);
      if (!isSubBase && !isDelivery) {
        mealsSold += item.quantity;
        if (OAT_RE.test(item.productName)) {
          numOats += item.quantity;
        } else if (SOUP_RE.test(item.productName)) {
          numSoups += item.quantity;
        } else {
          packagableMeals += item.quantity;
        }
        mealCounts[item.productName] = (mealCounts[item.productName] || 0) + item.quantity;
      }
    }
  }
  const orderCount = orders.length;
  // numSnacks = small-priced extras that aren't oats/soups/main meals
  // Since we track oats+soups separately, packagableMeals now = only main meals + snacks combined.
  // Separate snacks: items in packagableMeals group priced ≤ £4.50
  let numMeals = 0, numSnacks = 0;
  for (const order of orders) {
    const items = filterItems(order.items, hideAddons, hideAddDelivery, hideSubscriptionBase);
    for (const item of items) {
      if (/meal\s+subscription/i.test(item.productName)) continue;
      if (/add.*delivery/i.test(item.productName)) continue;
      if (OAT_RE.test(item.productName)) continue;
      if (SOUP_RE.test(item.productName)) continue;
      const price = parseFloat(item.price || "0");
      if (price > 0 && price <= 4.50) numSnacks += item.quantity;
      else numMeals += item.quantity;
    }
  }
  return { orderCount, mealsSold, packagableMeals, numMeals, numOats, numSoups, numSnacks, revenue, avgOrderValue: orderCount > 0 ? revenue / orderCount : 0, deliveryStops, mealCounts };
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
  const [verifyVisible,setVerifyVisible] = useState(false);
  const [expandedProduct,setExpandedProduct] = useState<string|null>(null);
  const [hideAddons, setHideAddons] = useState(false);
  const [hideAddDelivery, setHideAddDelivery] = useState(false);
  const [hideSubscriptionBase, setHideSubscriptionBase] = useState(false);
  const [includeDelivery, setIncludeDelivery] = useState(true);

  const { from, to, isCurrent } = getWeekRange(offset);
  const weekFinalized = isCurrent && isWeekFinalized();
  const verifyQuery = useQuery<VerifyResult>({
    queryKey:["/api/weekly-verify",from.toISOString(),to.toISOString()],
    enabled:verifyVisible,
    staleTime:0,
    queryFn:async()=>{
      const q=new URLSearchParams({from:from.toISOString(),to:to.toISOString()});
      const response=await fetch("/api/weekly-verify?"+q,{credentials:"include",cache:"no-store"});
      const payload=await response.json();
      if(!response.ok)throw Error(payload.message||"Verification failed");
      return payload;
    },
  });


  const { data: rawOrders, isLoading, isFetching } = useQuery<OrderWithItems[]>({
    queryKey: ["/api/orders", `?from=${from.toISOString()}&to=${to.toISOString()}`],
  });

  const { data: legacyStats } = useQuery<{ newCustomers: number; returningCustomers: number }>({
    queryKey: ["/api/weekly-stats", from.toISOString(), to.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: from.toISOString(),
        to: to.toISOString(),
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
    { id: "hideAddons", label: "Hide addons (≤ £4.50 items)", checked: hideAddons, onChange: setHideAddons },
    { id: "hideAddDelivery", label: "Hide Add Delivery (£5.49)", checked: hideAddDelivery, onChange: setHideAddDelivery },
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
            {format(from, "EEE, MMM d")} – {format(to, "EEE d MMM, yyyy")} 07:00
          </p>
          <DeliveryDatePills weekStart={from} /><DebugExportButton page="weekly-stats" from={from} to={to}/>
          {weekFinalized && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1 font-medium" data-testid="text-stats-cutoff-notice">
              ✓ Meals finalised — orders locked as of Thu 7am
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setOffset(o => o - 1)} data-testid="button-stats-prev">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setOffset(0)} data-testid="button-stats-current">
            This Week
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setOffset(o => o + 1)} disabled={offset >= 0} data-testid="button-stats-next">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div><h2 className="font-semibold">Verify weekly totals against orders</h2>
              <p className="text-xs text-muted-foreground">Independent read-only recount of individual customer order lines, excluding Christmas and cancelled orders.</p>
            </div>
            <Button variant="outline" disabled={verifyQuery.isFetching} onClick={() => {setVerifyVisible(true);void verifyQuery.refetch()}}>
              <RefreshCw className={`w-4 h-4 mr-2 ${verifyQuery.isFetching?"animate-spin":""}`}/>
              {verifyQuery.isFetching?"Verifying…":"Verify Weekly Totals"}
            </Button>
          </div>
          {verifyVisible && verifyQuery.isError && <p className="text-sm text-destructive">{verifyQuery.error instanceof Error?verifyQuery.error.message:"Verification unavailable"}</p>}
          {verifyVisible && verifyQuery.data && <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Checked {new Date(verifyQuery.data.checkedAt).toLocaleString("en-GB")} · {verifyQuery.data.orderCount} recorded orders · {verifyQuery.data.totalUnits} production units</p>
            <p className="text-xs text-muted-foreground">Counts include every eligible order, even suspected duplicates. Filtering options above may change the displayed statistics; this audit uses the unfiltered operational order records.</p>
            {verifyQuery.data.duplicates.length>0 ? <div className="border rounded-lg p-3 space-y-2">
              <strong className="text-sm text-amber-700">{verifyQuery.data.duplicates.length} possible duplicate pairs — review before packing</strong>
              {verifyQuery.data.duplicates.map(d=><p className="text-xs" key={d.first+"-"+d.second}>{d.customerName}: orders #{d.first} / #{d.second} — {d.reason}</p>)}
            </div> : <p className="text-sm">No high-similarity order pairs detected in this week's records.</p>}
            <div className="space-y-2">
              {verifyQuery.data.products.map(p=>{
                const display=(!hideAddons&&!hideAddDelivery&&!hideSubscriptionBase) ? computed?.all.mealCounts[p.productName] : undefined;
                const differs=display!==undefined&&display!==p.quantity;
                return <div key={p.productName} className="rounded-lg border p-3 space-y-2">
                  <button type="button" className="w-full flex justify-between items-center gap-3 text-sm text-left" onClick={()=>setExpandedProduct(expandedProduct===p.productName?null:p.productName)}>
                    <span className="font-medium">{p.productName}</span>
                    <span className={differs?"text-destructive font-semibold":"font-semibold"}>Records: {p.quantity}{display!==undefined?` · Page: ${display}`:""} {differs?"⚠":"▾"}</span>
                  </button>
                  {expandedProduct===p.productName && <div className="border-t pt-2 space-y-1">{p.orders.map((o,i)=><div key={o.orderId+"-"+i} className="text-xs flex justify-between gap-2"><span>#{o.orderId} · {o.customerName}</span><strong>{o.quantity}</strong></div>)}</div>}
                </div>;
              })}
            </div>
          </div>}
        </CardContent>
      </Card>

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
                    <p className="text-2xl font-bold tabular-nums inline-flex items-center gap-1.5" data-testid={`text-stat-${card.key}`}>
                      {card.fmt(value)}
                      {isFetching && !isLoading && <RefreshCw className="w-3.5 h-3.5 animate-spin text-muted-foreground" />}
                    </p>
                    {card.note ? <p className="text-[10px] text-muted-foreground mt-0.5">{card.note}</p> : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="border-l-4 border-l-orange-400 bg-orange-50 dark:bg-orange-950/30" data-testid="card-product-breakdown">
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4">
                <UtensilsCrossed className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Product Breakdown</span>
                <span className="ml-auto text-[10px] text-muted-foreground">= {computed.all.mealsSold} total sold</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Meals</span>
                  <p className="text-2xl font-bold tabular-nums" data-testid="stat-breakdown-meals">{computed.all.numMeals}</p>
                  <p className="text-[10px] text-muted-foreground">Main meal boxes</p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Oats</span>
                  <p className="text-2xl font-bold tabular-nums" data-testid="stat-breakdown-oats">{computed.all.numOats}</p>
                  <p className="text-[10px] text-muted-foreground">Overnight oats / porridge</p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Soups</span>
                  <p className="text-2xl font-bold tabular-nums" data-testid="stat-breakdown-soups">{computed.all.numSoups}</p>
                  <p className="text-[10px] text-muted-foreground">Soups</p>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Snacks</span>
                  <p className="text-2xl font-bold tabular-nums" data-testid="stat-breakdown-snacks">{computed.all.numSnacks}</p>
                  <p className="text-[10px] text-muted-foreground">Extras ≤ £4.50</p>
                </div>
              </div>
            </CardContent>
          </Card>

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
