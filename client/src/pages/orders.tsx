import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { OrderActions } from "@/components/order-actions";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { RefreshCw, Trash2, Plus, ShoppingCart, Download, Tag, Pencil, CalendarCheck, Banknote, MessageSquare, UserCheck, ChevronDown, ChevronUp, ChevronsUpDown, Stamp, Search, X, UserPlus, ArrowUpFromLine, CheckCircle2, AlertCircle, ChevronLeft, ChevronRight, Link2, Mail, FileDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateFilter, DateRangeLabel, DeliveryDatePills, useDateFilter, getDeliveryDateForOrder } from "@/components/date-filter";
import { OrderSourceFilter, useOrderSourceFilter } from "@/components/order-source-filter";
import type { Order, OrderItem, RecurringOrder, RecurringOrderItem } from "@shared/schema";

type OrderWithItems = Order & { items: OrderItem[] };
type RecurringOrderWithItems = RecurringOrder & { items: RecurringOrderItem[] };

const SOUP_PRODUCTS = ["curried sweet potato & carrot"];

function itemSortPriority(name: string): number {
  const n = name.toLowerCase();
  if (/subscription/i.test(n)) return 30;
  if (/soup/i.test(n) || SOUP_PRODUCTS.includes(n.trim())) return 20;
  if (/oat/i.test(n)) return 10;
  return 0;
}
function sortItems<T extends { productName: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => itemSortPriority(a.productName) - itemSortPriority(b.productName));
}

const SUB_RE_ORDERS = /meal\s+subscription/i;

function effectiveSpend(o: any, subCustomers: Set<string> = new Set()): number {
  if (o.isManual) {
    const cash = parseFloat(o.cashAmount ?? "0");
    if (cash > 0) return cash;
    if (subCustomers.has(o.customerName)) return 0;
    return o.items.reduce((s: number, i: any) => s + parseFloat(i.price || "0") * i.quantity, 0);
  }
  return o.items.reduce((s: number, i: any) => s + parseFloat(i.price || "0"), 0)
    + parseFloat(o.shippingTotal || "0");
}

export default function OrdersPage() {
  const { toast } = useToast();
  const dateFilter = useDateFilter();
  const sourceFilter = useOrderSourceFilter();
  const [dayFilter, setDayFilter] = useState<"all" | "saturday" | "tuesday">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OrderWithItems | null>(null);
  const [showConsistent, setShowConsistent] = useState(true);
  const [hideSubscriptions, setHideSubscriptions] = useState(false);
  const [orderSortCol, setOrderSortCol] = useState<"customer" | "total" | "spend" | "type" | "status" | null>(null);
  const [orderSortDir, setOrderSortDir] = useState<"asc" | "desc">("asc");
  const SUBSCRIPTION_RE = /meal\s+subscription\s*-\s*\d+/i;
  const [stampingCustomer, setStampingCustomer] = useState<RecurringOrderWithItems | null>(null);
  const [editingConsistentCustomer, setEditingConsistentCustomer] = useState<RecurringOrderWithItems | null>(null);
  const [showAddConsistentDialog, setShowAddConsistentDialog] = useState(false);

  const { from, to } = dateFilter;

  const { data: allOrders, isLoading, isFetching } = useQuery<OrderWithItems[]>({
    queryKey: ["/api/orders", `?from=${from.toISOString()}&to=${to.toISOString()}`],
  });

  const { data: allRecurringOrders } = useQuery<RecurringOrderWithItems[]>({
    queryKey: ["/api/recurring-orders"],
    select: (data) => data.filter((c: any) => c.active !== false),
  });

  type CustomerGroup = {
    customerName: string;
    saturday?: RecurringOrderWithItems;
    tuesday?: RecurringOrderWithItems;
  };

  const customerGroups = useMemo<CustomerGroup[]>(() => {
    if (!allRecurringOrders) return [];
    const map = new Map<string, CustomerGroup>();
    for (const c of allRecurringOrders) {
      const key = c.customerName.toLowerCase().trim();
      const group = map.get(key) || { customerName: c.customerName };
      if (c.isTuesday) group.tuesday = c;
      else group.saturday = c;
      map.set(key, group);
    }
    return Array.from(map.values()).sort((a, b) => a.customerName.localeCompare(b.customerName));
  }, [allRecurringOrders]);

  const addDayMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/recurring-orders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({ title: "Day added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add day", description: error.message, variant: "destructive" });
    },
  });

  const makeConsistentMutation = useMutation({
    mutationFn: async (order: OrderWithItems) => {
      const items = order.items
        .filter(i => i.productName.trim() && !i.productName.toLowerCase().includes("add delivery"))
        .map(i => ({ productName: i.productName, quantity: i.quantity, productId: i.productId || null }));
      const existing = (allRecurringOrders || []).find(
        r => r.customerName.toLowerCase().trim() === order.customerName.toLowerCase().trim()
          && r.isTuesday === (order.isTuesday === true)
      );
      if (existing) {
        return apiRequest("PATCH", `/api/recurring-orders/${existing.id}`, {
          items,
          deliveryAddress: order.deliveryAddress || null,
          fulfillmentType: order.fulfillmentType || "delivery",
        });
      }
      return apiRequest("POST", "/api/recurring-orders", {
        customerName: order.customerName,
        fulfillmentType: order.fulfillmentType || "delivery",
        deliveryAddress: order.deliveryAddress || null,
        isTuesday: order.isTuesday === true,
        items,
      });
    },
    onSuccess: (_data, order) => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      const day = order.isTuesday ? "Tuesday" : "Saturday";
      const existing = (allRecurringOrders || []).find(
        r => r.customerName.toLowerCase().trim() === order.customerName.toLowerCase().trim()
          && r.isTuesday === (order.isTuesday === true)
      );
      toast({ title: existing
        ? `${order.customerName}'s ${day} template updated with items from this order`
        : `${order.customerName} added as a consistent ${day} customer`
      });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update consistent customer", description: error.message, variant: "destructive" });
    },
  });

  const deleteConsistentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/recurring-orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({ title: "Consistent customer removed" });
    },
  });

  const deduplicateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/recurring-orders/deduplicate"),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({ title: data.removed > 0 ? `Removed ${data.removed} duplicate${data.removed > 1 ? "s" : ""}` : "No duplicates found" });
    },
    onError: (error: Error) => {
      toast({ title: "Cleanup failed", description: error.message, variant: "destructive" });
    },
  });

  const [smartStampResult, setSmartStampResult] = useState<{ created: number; skipped: number; total: number; details: string[] } | null>(null);
  const [showSmartStampResult, setShowSmartStampResult] = useState(false);
  const [confirmRemoveStamps, setConfirmRemoveStamps] = useState(false);

  const removeStampsMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/recurring-orders/stamps-this-week"),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setConfirmRemoveStamps(false);
      toast({ title: `Removed ${data.deleted} stamped order${data.deleted !== 1 ? "s" : ""}` });
    },
    onError: (error: Error) => {
      toast({ title: "Remove failed", description: error.message, variant: "destructive" });
    },
  });

  const smartStampAllMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/recurring-orders/smart-stamp-all"),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      setSmartStampResult(data);
      setShowSmartStampResult(true);
    },
    onError: (error: Error) => {
      toast({ title: "Smart stamp failed", description: error.message, variant: "destructive" });
    },
  });

  const [editingAmounts, setEditingAmounts] = useState<Record<number, string>>({});

  const packingMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/orders/${id}/packing`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/orders"] }),
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const orders = allOrders?.filter(o => {
    if (dayFilter === "saturday" && o.isTuesday) return false;
    if (dayFilter === "tuesday" && !o.isTuesday) return false;
    if (!sourceFilter.filterOrder(o)) return false;
    if (hideSubscriptions && o.items?.some(i => SUBSCRIPTION_RE.test(i.productName))) return false;
    if (o.items?.length > 0 && o.items.every(i => i.productName.toLowerCase().includes("add delivery"))) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const nameMatch = o.customerName?.toLowerCase().includes(q);
      const addrMatch = o.deliveryAddress?.toLowerCase().includes(q);
      const noteMatch = (o as any).notes?.toLowerCase().includes(q);
      const itemMatch = o.items?.some(i => i.productName.toLowerCase().includes(q));
      if (!nameMatch && !addrMatch && !noteMatch && !itemMatch) return false;
    }
    return true;
  });

  // Customers who have a WooCommerce subscription order this week — their manual
  // recurring orders are operational records only; the actual payment is captured
  // in the WooCommerce subscription order, so we exclude them from revenue totals.
  const subCustomers = useMemo(() =>
    new Set(
      (allOrders || [])
        .filter(o => !o.isManual && o.items.some(i => SUB_RE_ORDERS.test(i.productName)))
        .map(o => o.customerName)
    ),
  [allOrders]);

  const [orderSyncPhase,setOrderSyncPhase] = useState("");
  const syncMutation = useMutation({
    mutationFn: async () => {
      const start=await apiRequest("POST","/api/woo/sync-start");
      const initial=await start.json();
      if(!start.ok)throw Error(initial.message||"Unable to start WooCommerce sync");
      for(let attempt=0;attempt<240;attempt++){
        await new Promise(resolve=>setTimeout(resolve,1500));
        const res=await fetch("/api/woo/sync-progress",{credentials:"include",cache:"no-store"});
        if(!res.ok)throw Error("Sync status unavailable (HTTP "+res.status+")");
        const state=await res.json();
        setOrderSyncPhase(state.phase+" · "+Math.round(state.elapsedMs/1000)+"s");
        if(!state.running){
          if(state.error)throw Error(state.error);
          return state.result;
        }
      }
      throw Error("Sync continues in the background; check sync progress before starting another.");
    },
    onMutate:()=>setOrderSyncPhase("Starting WooCommerce sync…"),
    onSuccess: async (data) => {
      toast({title:"Orders synced",description:`Imported: ${data.orders?.imported??0}, Updated: ${data.orders?.updated??0}`});
      queryClient.invalidateQueries({queryKey:["/api/orders"]});
    },
    onError: (error: Error) => toast({ title: "Sync failed", description: error.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order deleted" });
    },
  });

  const moveWeekMutation = useMutation({
    mutationFn: ({ id, orderDate }: { id: number; orderDate: string }) =>
      apiRequest("PATCH", `/api/orders/${id}`, { orderDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order moved to new week" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to move order", description: error.message, variant: "destructive" });
    },
  });

  const addonLinkMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/orders/${id}/addon-link`);
      return res.json() as Promise<{ url: string }>;
    },
    onSuccess: async ({ url }) => {
      try {
        await navigator.clipboard.writeText(url);
        toast({ title: "Link copied to clipboard", description: url });
      } catch {
        toast({ title: "Addon link generated", description: url });
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to generate link", description: error.message, variant: "destructive" });
    },
  });

  const reprocessAddonMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/orders/${id}/addon-link/reprocess`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json() as Promise<{ itemsAdded: number }>;
    },
    onSuccess: ({ itemsAdded }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: `Payment recovered — ${itemsAdded} item${itemsAdded !== 1 ? "s" : ""} added to order` });
    },
    onError: (error: Error) => toast({ title: "Recovery failed", description: error.message, variant: "destructive" }),
  });

  const sendReceiptMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/orders/${id}/addon-receipt/email`);
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      return res.json();
    },
    onSuccess: () => toast({ title: "Receipt email sent" }),
    onError: (error: Error) => toast({ title: "Failed to send receipt", description: error.message, variant: "destructive" }),
  });

  async function downloadAddonReceiptPdf(orderId: number, customerName: string) {
    try {
      const res = await fetch(`/api/orders/${orderId}/addon-receipt/pdf`, { credentials: "include" });
      if (!res.ok) { const e = await res.json(); throw new Error(e.message); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `receipt-${customerName.replace(/\s+/g, "-").toLowerCase()}-addon.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast({ title: "Failed to download receipt", description: e.message, variant: "destructive" });
    }
  }

  const allProductNames = Array.from(new Set((orders || []).flatMap(o => o.items.map(i => i.productName))))
    .sort((a, b) => {
      const pa = itemSortPriority(a), pb = itemSortPriority(b);
      return pa !== pb ? pa - pb : a.localeCompare(b);
    });

  const productTotals: Record<string, number> = {};
  for (const name of allProductNames) {
    productTotals[name] = (orders || []).reduce((sum, order) => {
      return sum + order.items.filter(i => i.productName === name).reduce((s, i) => s + i.quantity, 0);
    }, 0);
  }

  function handleOrderSort(col: typeof orderSortCol) {
    if (orderSortCol === col) {
      setOrderSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setOrderSortCol(col);
      setOrderSortDir(col === "customer" || col === "type" || col === "status" ? "asc" : "desc");
    }
  }

  const sortedOrders = useMemo(() => {
    if (!orders || !orderSortCol) return orders || [];
    return [...orders].sort((a, b) => {
      let av: number | string, bv: number | string;
      if (orderSortCol === "customer") { av = a.customerName?.toLowerCase() ?? ""; bv = b.customerName?.toLowerCase() ?? ""; }
      else if (orderSortCol === "total") { av = a.items.filter(i => !i.productName.toLowerCase().includes("add delivery") && !/meal\s+subscription/i.test(i.productName)).reduce((s, i) => s + i.quantity, 0); bv = b.items.filter(i => !i.productName.toLowerCase().includes("add delivery") && !/meal\s+subscription/i.test(i.productName)).reduce((s, i) => s + i.quantity, 0); }
      else if (orderSortCol === "spend") { av = effectiveSpend(a, subCustomers); bv = effectiveSpend(b, subCustomers); }
      else if (orderSortCol === "type") { av = a.fulfillmentType ?? ""; bv = b.fulfillmentType ?? ""; }
      else { av = a.status ?? ""; bv = b.status ?? ""; }
      if (av < bv) return orderSortDir === "asc" ? -1 : 1;
      if (av > bv) return orderSortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [orders, orderSortCol, orderSortDir]);

  function OrderSortIcon({ col }: { col: typeof orderSortCol }) {
    if (orderSortCol !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 inline text-muted-foreground/40" />;
    return orderSortDir === "asc"
      ? <ChevronUp className="w-3 h-3 ml-1 inline" />
      : <ChevronDown className="w-3 h-3 ml-1 inline" />;
  }

  const statusColor = (status: string) => {
    switch (status) {
      case "completed": return "default" as const;
      case "processing": return "secondary" as const;
      case "on-hold": return "outline" as const;
      default: return "secondary" as const;
    }
  };

  const handleExport = () => {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    window.open(`/api/orders/export?${params.toString()}`, "_blank");
  };

  const handleLabels = (tuesday?: boolean, mode?: "xmas") => {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    if (tuesday !== undefined) params.set("tuesday", String(tuesday));
    if (mode === "xmas") params.set("mode", "xmas");
    window.open(`/api/orders/labels?${params.toString()}`, "_blank");
  };

  return (
    <div className="max-w-full space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">Orders</h1>
          <DateRangeLabel from={from} to={to} />
          <DeliveryDatePills weekStart={from} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateFilter {...dateFilter} testIdPrefix="orders" showMonth />
          <Button size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="button-sync-orders">
            <RefreshCw className={`w-4 h-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            Sync from Woo
          </Button>
          {syncMutation.isPending && <span role="status" className="text-xs text-muted-foreground">{orderSyncPhase}</span>}
          {orders && orders.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={handleExport} data-testid="button-export-xlsx">
                <Download className="w-4 h-4 mr-1" />
                Export XLSX
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleLabels(false)} data-testid="button-print-labels-saturday">
                <Tag className="w-4 h-4 mr-1" />
                Sat Labels
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleLabels(true)} data-testid="button-print-labels-tuesday">
                <Tag className="w-4 h-4 mr-1" />
                Tue Labels
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleLabels(undefined, "xmas")} data-testid="button-print-labels-christmas">
                <Tag className="w-4 h-4 mr-1" />
                🎄 Xmas Labels
              </Button>
            </>
          )}
          <ManualOrderDialog open={showManualDialog} onOpenChange={setShowManualDialog} />
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap" data-testid="day-filter-tabs">
          {(["all", "saturday", "tuesday"] as const).map(d => (
            <Button
              key={d}
              size="sm"
              variant={dayFilter === d ? "default" : "outline"}
              onClick={() => setDayFilter(d)}
              data-testid={`button-day-${d}`}
              className="capitalize"
            >
              {d === "all" ? "All Days" : d === "saturday" ? "Saturday / Website" : "Tuesday"}
            </Button>
          ))}
        </div>
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search orders…"
            className="pl-8 h-8 text-sm"
            data-testid="input-search-orders"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              data-testid="button-clear-search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer select-none" data-testid="label-hide-subscriptions">
          <Checkbox
            checked={hideSubscriptions}
            onCheckedChange={(v) => setHideSubscriptions(!!v)}
            data-testid="checkbox-hide-subscriptions"
          />
          Hide subscriptions
        </label>
      </div>

      {(customerGroups.length > 0 || allRecurringOrders) && (
        <Card data-testid="card-consistent-customers">
          <CardContent className="p-0">
            <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                className="flex min-w-0 items-center gap-2 text-left"
                onClick={() => setShowConsistent(v => !v)}
                data-testid="button-toggle-consistent"
              >
                <UserCheck className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm">Consistent Customers</span>
                <Badge variant="secondary" className="text-xs">{customerGroups.length}</Badge>
                {showConsistent ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-end">
                <Button
                  size="sm"
                  className="col-span-2 h-8 w-full text-xs bg-emerald-600 text-white sm:col-span-1 sm:h-7 sm:w-auto"
                  onClick={() => smartStampAllMutation.mutate()}
                  disabled={smartStampAllMutation.isPending}
                  data-testid="button-smart-stamp-all"
                >
                  <Stamp className="w-3 h-3 mr-1" />
                  {smartStampAllMutation.isPending ? "Stamping…" : "Stamp All This Week"}
                </Button>
                {confirmRemoveStamps ? (
                  <div className="col-span-2 flex min-w-0 flex-wrap items-center gap-1 sm:col-span-1">
                    <span className="w-full text-xs text-destructive font-medium sm:w-auto">Remove all this week's stamps?</span>
                    <Button
                      size="sm" variant="destructive" className="h-8 flex-1 text-xs sm:h-7 sm:flex-none"
                      onClick={() => removeStampsMutation.mutate()}
                      disabled={removeStampsMutation.isPending}
                      data-testid="button-confirm-remove-stamps"
                    >
                      {removeStampsMutation.isPending ? "Removing…" : "Yes, remove"}
                    </Button>
                    <Button
                      size="sm" variant="outline" className="h-8 flex-1 text-xs sm:h-7 sm:flex-none"
                      onClick={() => setConfirmRemoveStamps(false)}
                      data-testid="button-cancel-remove-stamps"
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm" variant="outline" className="h-8 w-full text-xs text-destructive border-destructive/40 sm:h-7 sm:w-auto"
                    onClick={() => setConfirmRemoveStamps(true)}
                    data-testid="button-remove-stamps"
                  >
                    <Trash2 className="w-3 h-3 mr-1" />Remove All Stamps
                  </Button>
                )}
                <Button
                  size="sm" variant="outline" className="h-8 w-full text-xs text-amber-600 border-amber-300 sm:h-7 sm:w-auto"
                  onClick={() => deduplicateMutation.mutate()}
                  disabled={deduplicateMutation.isPending}
                  data-testid="button-deduplicate-consistent"
                >
                  {deduplicateMutation.isPending ? "Cleaning…" : "Remove duplicates"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 w-full text-xs sm:h-7 sm:w-auto" onClick={() => setShowAddConsistentDialog(true)} data-testid="button-add-consistent">
                  <Plus className="w-3 h-3 mr-1" />Add Customer
                </Button>
              </div>
            </div>
            {showConsistent && (
              <div className="border-t overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[160px]">Customer</TableHead>
                      <TableHead className="w-[180px]">Ordering Days</TableHead>
                      <TableHead>Saturday Items</TableHead>
                      <TableHead>Tuesday Items</TableHead>
                      <TableHead className="min-w-[220px] sm:min-w-[300px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customerGroups.map(group => (
                      <TableRow key={group.customerName} data-testid={`row-consistent-${group.customerName}`}>
                        <TableCell className="align-top pt-3">
                          <div className="font-medium">{group.customerName}</div>
                          {group.saturday && group.saturday.items.length > 0 && (() => {
                            const satStamped = allOrders?.some(
                              o => o.isManual && !o.isTuesday && o.customerName.toLowerCase() === group.customerName.toLowerCase()
                            );
                            return satStamped ? (
                              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 mt-0.5">
                                <CheckCircle2 className="w-3 h-3" />Sat stamped
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                <AlertCircle className="w-3 h-3" />Sat needs stamp
                              </span>
                            );
                          })()}
                          {group.tuesday && group.tuesday.items.length > 0 && (() => {
                            const tueStamped = allOrders?.some(
                              o => o.isManual && o.isTuesday && o.customerName.toLowerCase() === group.customerName.toLowerCase()
                            );
                            return tueStamped ? (
                              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 mt-0.5">
                                <CheckCircle2 className="w-3 h-3" />Tue stamped
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                <AlertCircle className="w-3 h-3" />Tue needs stamp
                              </span>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="align-top pt-3">
                          <div className="flex flex-col gap-2">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <Checkbox
                                checked={!!group.saturday}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    addDayMutation.mutate({
                                      customerName: group.customerName,
                                      isTuesday: false,
                                      fulfillmentType: group.tuesday?.fulfillmentType || "delivery",
                                      deliveryAddress: group.tuesday?.deliveryAddress || null,
                                      items: [],
                                    });
                                  } else if (group.saturday) {
                                    deleteConsistentMutation.mutate(group.saturday.id);
                                  }
                                }}
                                data-testid={`checkbox-sat-${group.customerName}`}
                              />
                              <span className="text-sm">Saturday</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                              <Checkbox
                                checked={!!group.tuesday}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    addDayMutation.mutate({
                                      customerName: group.customerName,
                                      isTuesday: true,
                                      fulfillmentType: group.saturday?.fulfillmentType || "delivery",
                                      deliveryAddress: group.saturday?.deliveryAddress || null,
                                      items: [],
                                    });
                                  } else if (group.tuesday) {
                                    deleteConsistentMutation.mutate(group.tuesday.id);
                                  }
                                }}
                                data-testid={`checkbox-tue-${group.customerName}`}
                              />
                              <span className="text-sm text-amber-600 dark:text-amber-400">Tuesday</span>
                            </label>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground align-top pt-3">
                          {group.saturday
                            ? (() => {
                                const actualOrders = allOrders?.filter(
                                  o => o.isManual && !o.isTuesday && o.customerName.toLowerCase() === group.customerName.toLowerCase()
                                );
                                const items = actualOrders && actualOrders.length > 0
                                  ? actualOrders.flatMap(o => o.items)
                                  : group.saturday!.items;
                                return items.length === 0
                                  ? <span className="italic">No items — amend to add</span>
                                  : <>{sortItems(items).map(i => `${i.quantity > 1 ? i.quantity + "× " : ""}${i.productName}`).join(", ")}{actualOrders && actualOrders.length > 0 && <span className="ml-1 text-xs text-muted-foreground/60">(actual)</span>}</>;
                              })()
                            : <span className="text-muted-foreground/40 italic">—</span>}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground align-top pt-3">
                          {group.tuesday
                            ? (() => {
                                const actualOrders = allOrders?.filter(
                                  o => o.isManual && o.isTuesday && o.customerName.toLowerCase() === group.customerName.toLowerCase()
                                );
                                const items = actualOrders && actualOrders.length > 0
                                  ? actualOrders.flatMap(o => o.items)
                                  : group.tuesday!.items;
                                return items.length === 0
                                  ? <span className="italic">No items — amend to add</span>
                                  : <>{sortItems(items).map(i => `${i.quantity > 1 ? i.quantity + "× " : ""}${i.productName}`).join(", ")}{actualOrders && actualOrders.length > 0 && <span className="ml-1 text-xs text-muted-foreground/60">(actual)</span>}</>;
                              })()
                            : <span className="text-muted-foreground/40 italic">—</span>}
                        </TableCell>
                        <TableCell className="align-top pt-2">
                          <div className="grid grid-cols-1 gap-1.5 sm:flex sm:flex-wrap">
                            {group.saturday && (
                              <>
                                <Button size="sm" variant="outline" className="h-8 w-full justify-start text-xs sm:h-7 sm:w-auto sm:justify-center" onClick={() => setEditingConsistentCustomer(group.saturday!)} data-testid={`button-amend-sat-${group.customerName}`}>
                                  <Pencil className="w-3 h-3 mr-1" />Amend Saturday
                                </Button>
                                <Button size="sm" variant="default" className="h-8 w-full justify-start text-xs sm:h-7 sm:w-auto sm:justify-center" onClick={() => setStampingCustomer(group.saturday!)} data-testid={`button-stamp-sat-${group.customerName}`}>
                                  <Stamp className="w-3 h-3 mr-1" />Stamp Sat
                                </Button>
                              </>
                            )}
                            {group.tuesday && (
                              <>
                                <Button size="sm" variant="outline" className="h-8 w-full justify-start text-xs border-amber-400 text-amber-600 dark:text-amber-400 sm:h-7 sm:w-auto sm:justify-center" onClick={() => setEditingConsistentCustomer(group.tuesday!)} data-testid={`button-amend-tue-${group.customerName}`}>
                                  <Pencil className="w-3 h-3 mr-1" />Amend Tuesday
                                </Button>
                                <Button size="sm" className="h-8 w-full justify-start text-xs bg-amber-500 hover:bg-amber-600 sm:h-7 sm:w-auto sm:justify-center" onClick={() => setStampingCustomer(group.tuesday!)} data-testid={`button-stamp-tue-${group.customerName}`}>
                                  <Stamp className="w-3 h-3 mr-1" />Stamp Tue
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <OrderSourceFilter filter={sourceFilter} testIdPrefix="orders-source" />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : !orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <ShoppingCart className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No orders for this period</p>
              <p className="text-sm text-muted-foreground mt-1">Sync from WooCommerce or add a manual order</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[150px] cursor-pointer select-none" onClick={() => handleOrderSort("customer")}>
                      Customer <OrderSortIcon col="customer" />
                    </TableHead>
                    {allProductNames.map(name => (
                      <TableHead key={name} className="text-center min-w-[80px]">{name}</TableHead>
                    ))}
                    <TableHead className="text-center w-[60px] cursor-pointer select-none" onClick={() => handleOrderSort("total")}>
                      Total <OrderSortIcon col="total" />
                    </TableHead>
                    <TableHead className="min-w-[180px]">Delivery Address</TableHead>
                    <TableHead className="w-[100px] cursor-pointer select-none" onClick={() => handleOrderSort("type")}>
                      Type <OrderSortIcon col="type" />
                    </TableHead>
                    <TableHead className="w-[130px] cursor-pointer select-none" onClick={() => handleOrderSort("spend")}>
                      <span>Spend <OrderSortIcon col="spend" /></span>
                      <span className="block text-[10px] font-normal text-muted-foreground leading-tight">inc. delivery</span>
                    </TableHead>
                    <TableHead className="w-[80px] cursor-pointer select-none" onClick={() => handleOrderSort("status")}>
                      Status <OrderSortIcon col="status" />
                    </TableHead>
                    <TableHead className="min-w-[100px]">Notes</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedOrders.map((order) => {
                    const orderSpend = effectiveSpend(order, subCustomers);
                    const itemSummary = sortItems(order.items
                      .filter(i => !i.productName.toLowerCase().includes("add delivery")))
                      .map(i => {
                        return `${i.quantity > 1 ? i.quantity + "× " : ""}${i.productName}`;
                      })
                      .join(", ");
                    return (
                    <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span data-testid={`text-customer-${order.id}`}>{order.customerName}</span>
                          {order.customerDeliveryInstructions && <Badge variant="secondary" title={order.customerDeliveryInstructions} className="max-w-[260px] truncate">Delivery instructions: {order.customerDeliveryInstructions}</Badge>}
                          {order.isManual && (
                            <Badge variant="outline" className="text-xs">Manual</Badge>
                          )}
                          {!order.isManual && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="w-5 h-5 text-muted-foreground/50 hover:text-primary"
                                  onClick={() => addonLinkMutation.mutate(order.id)}
                                  disabled={addonLinkMutation.isPending}
                                  data-testid={`button-addon-link-${order.id}`}
                                >
                                  <Link2 className="w-3 h-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Generate add-on payment link</TooltipContent>
                            </Tooltip>
                          )}
                          {(order as any).pendingAddonToken && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="w-5 h-5 text-amber-500 hover:text-amber-600 animate-pulse"
                                  onClick={() => reprocessAddonMutation.mutate(order.id)}
                                  disabled={reprocessAddonMutation.isPending}
                                  data-testid={`button-recover-addon-${order.id}`}
                                >
                                  <AlertCircle className="w-3 h-3" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Recover unprocessed addon payment — click to add items</TooltipContent>
                            </Tooltip>
                          )}
                          {order.items.some(i => i.portalAdded) && (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="w-5 h-5 text-emerald-600 hover:text-emerald-700"
                                    onClick={() => sendReceiptMutation.mutate(order.id)}
                                    disabled={sendReceiptMutation.isPending}
                                    data-testid={`button-send-receipt-${order.id}`}
                                  >
                                    <Mail className="w-3 h-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Send add-on receipt email</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="w-5 h-5 text-emerald-600 hover:text-emerald-700"
                                    onClick={() => downloadAddonReceiptPdf(order.id, order.customerName)}
                                    data-testid={`button-download-receipt-${order.id}`}
                                  >
                                    <FileDown className="w-3 h-3" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>Download add-on receipt PDF</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                          {!order.isTuesday && (() => {
                            const delivDate = getDeliveryDateForOrder(order.orderDate, false);
                            return (
                              <Badge variant="outline" className="text-xs border-green-500 text-green-700 dark:text-green-400" data-testid={`badge-saturday-${order.id}`}>
                                <CalendarCheck className="w-3 h-3 mr-0.5" />Sat {format(delivDate, "do MMM")}
                              </Badge>
                            );
                          })()}
                          {order.isTuesday && (() => {
                            const delivDate = getDeliveryDateForOrder(order.orderDate, true);
                            return (
                              <Badge variant="outline" className="text-xs border-amber-400 text-amber-600 dark:text-amber-400" data-testid={`badge-tuesday-${order.id}`}>
                                <CalendarCheck className="w-3 h-3 mr-0.5" />Tue {format(delivDate, "do MMM")}
                              </Badge>
                            );
                          })()}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(order.orderDate), "EEE, MMM d")}
                        </span>
                        {itemSummary && (
                          <div className="text-xs text-muted-foreground mt-0.5 leading-tight" data-testid={`text-items-summary-${order.id}`}>
                            {itemSummary}
                          </div>
                        )}
                      </TableCell>
                      {allProductNames.map(name => {
                        const qty = order.items.filter(i => i.productName === name).reduce((s, i) => s + i.quantity, 0);
                        return (
                          <TableCell key={name} className="text-center">
                            {qty > 0 ? (
                              <span className="font-medium" data-testid={`text-qty-${order.id}-${name}`}>{qty}</span>
                            ) : (
                              <span className="text-muted-foreground/30">-</span>
                            )}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-center font-bold text-sm" data-testid={`text-total-items-${order.id}`}>
                        {order.items.filter(i => !i.productName.toLowerCase().includes("add delivery") && !/meal\s+subscription/i.test(i.productName)).reduce((s, i) => s + i.quantity, 0)}
                      </TableCell>
                      <TableCell>
                        <span className="text-sm" data-testid={`text-address-${order.id}`}>
                          {order.deliveryAddress || <span className="text-muted-foreground/40 text-xs">No address</span>}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={order.fulfillmentType === "delivery" ? "default" : "outline"}
                          data-testid={`badge-fulfillment-${order.id}`}
                        >
                          {order.fulfillmentType === "delivery" ? "Delivery" : "Collection"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-sm" data-testid={`text-spend-${order.id}`}>
                        <div className="space-y-1">
                          <div className="text-right">
                            {orderSpend > 0 ? `£${orderSpend.toFixed(2)}` : <span className="text-muted-foreground/30">—</span>}
                          </div>
                          {order.isManual && (
                            <>
                              <Select
                                value={(order as any).paymentMethod || "none"}
                                onValueChange={(v) => packingMutation.mutate({ id: order.id, data: { paymentMethod: v === "none" ? null : v } })}
                              >
                                <SelectTrigger className="h-6 text-xs px-1" data-testid={`select-payment-${order.id}`}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">—</SelectItem>
                                  <SelectItem value="cash">Cash</SelectItem>
                                  <SelectItem value="bank_transfer">Bank</SelectItem>
                                  <SelectItem value="nil">Nil</SelectItem>
                                </SelectContent>
                              </Select>
                              {(order as any).paymentMethod && (order as any).paymentMethod !== "none" && (order as any).paymentMethod !== "nil" && (
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={editingAmounts[order.id] ?? ((order as any).cashAmount != null ? String((order as any).cashAmount) : "")}
                                  onChange={(e) => setEditingAmounts(prev => ({ ...prev, [order.id]: e.target.value }))}
                                  onBlur={(e) => {
                                    const val = e.target.value;
                                    const orig = (order as any).cashAmount != null ? String((order as any).cashAmount) : "";
                                    if (val !== orig) packingMutation.mutate({ id: order.id, data: { cashAmount: val ? parseFloat(val) : null } });
                                    setEditingAmounts(prev => { const n = { ...prev }; delete n[order.id]; return n; });
                                  }}
                                  className="h-6 text-xs px-1"
                                  placeholder="£0.00"
                                  data-testid={`input-cash-amount-${order.id}`}
                                />
                              )}
                            </>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusColor(order.status)} data-testid={`badge-status-${order.id}`}>
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(order as any).notes ? (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground cursor-default" data-testid={`text-notes-${order.id}`}>
                                  <MessageSquare className="w-3 h-3 flex-shrink-0" />
                                  <span className="truncate max-w-[90px]">{(order as any).notes}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-[200px]">
                                {(order as any).notes}
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {(() => {
                            const day = order.isTuesday ? "Tuesday" : "Saturday";
                            const existing = (allRecurringOrders || []).find(
                              r => r.customerName.toLowerCase().trim() === order.customerName.toLowerCase().trim()
                                && r.isTuesday === (order.isTuesday === true)
                            );
                            return (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => makeConsistentMutation.mutate(order)}
                                      disabled={makeConsistentMutation.isPending}
                                      data-testid={`button-make-consistent-${order.id}`}
                                    >
                                      {existing
                                        ? <ArrowUpFromLine className="w-4 h-4 text-blue-500" />
                                        : <UserPlus className="w-4 h-4 text-muted-foreground" />}
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="left">
                                    {existing
                                      ? `Sync items from this order → ${day} template`
                                      : `Save as consistent ${day} customer`}
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            );
                          })()}
                          {order.isManual && (() => {
                            const shiftWeek = (weeks: number) => {
                              const d = new Date(order.orderDate);
                              d.setDate(d.getDate() + weeks * 7);
                              moveWeekMutation.mutate({ id: order.id, orderDate: d.toISOString() });
                            };
                            return (
                              <>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button size="icon" variant="ghost" onClick={() => shiftWeek(-1)} data-testid={`button-prev-week-${order.id}`}>
                                        <ChevronLeft className="w-4 h-4 text-muted-foreground" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Move to previous week</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button size="icon" variant="ghost" onClick={() => shiftWeek(1)} data-testid={`button-next-week-${order.id}`}>
                                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">Move to next week</TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => setEditingOrder(order)}
                                  data-testid={`button-edit-order-${order.id}`}
                                >
                                  <Pencil className="w-4 h-4 text-muted-foreground" />
                                </Button>
                              </>
                            );
                          })()}
                          <OrderActions orderId={order.id} />
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
                <TableFooter>
                  <TableRow className="border-t-2">
                    <TableCell className="font-bold text-xs text-muted-foreground">Customer</TableCell>
                    {allProductNames.map(name => (
                      <TableCell key={name} className="text-center font-bold text-xs text-muted-foreground">{name}</TableCell>
                    ))}
                    <TableCell className="text-center font-bold text-xs text-muted-foreground">Total</TableCell>
                    <TableCell className="font-bold text-xs text-muted-foreground">Address</TableCell>
                    <TableCell className="font-bold text-xs text-muted-foreground">Type</TableCell>
                    <TableCell className="font-bold text-xs text-muted-foreground text-right">
                      <span>Spend</span>
                      <span className="block text-[10px] font-normal leading-tight">inc. delivery</span>
                    </TableCell>
                    <TableCell className="font-bold text-xs text-muted-foreground">Status</TableCell>
                    <TableCell className="font-bold text-xs text-muted-foreground">Notes / Cash</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                  <TableRow className="bg-muted/50" data-testid="row-order-totals">
                    <TableCell className="font-bold text-sm">TOTAL</TableCell>
                    {allProductNames.map(name => (
                      <TableCell key={name} className="text-center font-bold text-sm" data-testid={`text-total-${name}`}>
                        {productTotals[name] || 0}
                      </TableCell>
                    ))}
                    <TableCell className="text-center font-bold text-sm" data-testid="text-grand-total-items">
                      <span className="inline-flex items-center gap-1">
                        {(orders || []).reduce((sum, o) => sum + o.items.filter(i => !i.productName.toLowerCase().includes("add delivery") && !/meal\s+subscription/i.test(i.productName)).reduce((s, i) => s + i.quantity, 0), 0)}
                        {isFetching && !isLoading && <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />}
                      </span>
                    </TableCell>
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-right font-bold text-sm" data-testid="text-total-spend">
                      £{(orders || []).reduce((sum, o) => sum + effectiveSpend(o, subCustomers), 0).toFixed(2)}
                    </TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-sm font-medium text-green-700 dark:text-green-400" data-testid="text-total-payment-methods">
                      {(() => {
                        const cashCount = (orders || []).filter(o => (o as any).paymentMethod === "cash").length;
                        const btCount = (orders || []).filter(o => (o as any).paymentMethod === "bank_transfer").length;
                        const parts = [];
                        if (cashCount > 0) parts.push(`Cash: ${cashCount}`);
                        if (btCount > 0) parts.push(`BT: ${btCount}`);
                        return parts.join(" · ");
                      })()}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {editingOrder && (
        <EditOrderDialog
          order={editingOrder}
          open={!!editingOrder}
          onOpenChange={(v) => { if (!v) setEditingOrder(null); }}
        />
      )}
      {stampingCustomer && (
        <StampDialog
          customer={stampingCustomer}
          open={!!stampingCustomer}
          onOpenChange={(v) => { if (!v) setStampingCustomer(null); }}
        />
      )}
      {editingConsistentCustomer && (
        <EditConsistentDialog
          customer={editingConsistentCustomer}
          open={!!editingConsistentCustomer}
          onOpenChange={(v) => { if (!v) setEditingConsistentCustomer(null); }}
        />
      )}
      <AddConsistentDialog
        open={showAddConsistentDialog}
        onOpenChange={setShowAddConsistentDialog}
      />

      {/* Smart Stamp Results Dialog */}
      <Dialog open={showSmartStampResult} onOpenChange={setShowSmartStampResult}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Stamp All This Week — Results</DialogTitle>
          </DialogHeader>
          {smartStampResult && (
            <div className="flex flex-col gap-4 overflow-y-auto">
              <div className="flex gap-4">
                <div className="flex-1 rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-600">{smartStampResult.created}</div>
                  <div className="text-xs text-muted-foreground mt-1">Orders created</div>
                </div>
                <div className="flex-1 rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold text-amber-500">{smartStampResult.skipped}</div>
                  <div className="text-xs text-muted-foreground mt-1">Skipped</div>
                </div>
                <div className="flex-1 rounded-lg border p-3 text-center">
                  <div className="text-2xl font-bold">{smartStampResult.total}</div>
                  <div className="text-xs text-muted-foreground mt-1">Total customers</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Items were selected from this week&apos;s menu using last week&apos;s order as a template. All orders can be edited from the orders table below.
              </p>
              {smartStampResult.details.length > 0 && (
                <div className="rounded-md border overflow-y-auto max-h-60">
                  {smartStampResult.details.map((d, i) => (
                    <div key={i} className={`px-3 py-1.5 text-xs border-b last:border-b-0 ${d.includes("skipped") ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`} data-testid={`smart-stamp-detail-${i}`}>
                      {d}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ProductSelect({ value, onChange, products, testId }: {
  value: string;
  onChange: (v: string) => void;
  products: any[] | undefined;
  testId?: string;
}) {
  const grouped = useMemo(() => {
    if (!products) return [];
    const map = new Map<string, string[]>();
    for (const p of products) {
      const cat = p.category || "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p.name);
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      const numA = parseInt(a.replace(/\D/g, "")) || 999;
      const numB = parseInt(b.replace(/\D/g, "")) || 999;
      return numA - numB;
    });
  }, [products]);

  const knownNames = useMemo(() => new Set(products?.map(p => p.name) ?? []), [products]);
  const isCustom = value && !knownNames.has(value);

  return (
    <div className="flex-1 flex flex-col gap-1">
      <Select value={isCustom ? "__custom__" : (value || "")} onValueChange={(v) => { if (v !== "__custom__") onChange(v); }}>
        <SelectTrigger data-testid={testId}>
          <SelectValue placeholder="Select a product…">
            {isCustom ? <span className="text-muted-foreground italic">Custom: {value}</span> : undefined}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {grouped.map(([cat, names]) => (
            <SelectGroup key={cat}>
              <SelectLabel className="text-xs font-semibold text-muted-foreground">── {cat} ──</SelectLabel>
              {names.map(name => (
                <SelectItem key={name} value={name}>{name}</SelectItem>
              ))}
            </SelectGroup>
          ))}
          <SelectGroup>
            <SelectLabel className="text-xs font-semibold text-muted-foreground">── Other ──</SelectLabel>
            <SelectItem value="__custom__">Type custom name…</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
      {(isCustom || value === "__custom__") && (
        <Input
          value={isCustom ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter product name"
          autoFocus
        />
      )}
    </div>
  );
}

function ManualOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState("");
  const [address, setAddress] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<"delivery" | "collection">("delivery");
  const [isTuesday, setIsTuesday] = useState(false);
  const [notes, setNotes] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"" | "cash" | "bank_transfer">("");
  const [cashAmount, setCashAmount] = useState("");
  const [saveAsConsistent, setSaveAsConsistent] = useState(true);
  const [itemLines, setItemLines] = useState([{ productName: "", quantity: 1 }]);

  const { data: products } = useQuery<any[]>({ queryKey: ["/api/products"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/orders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({
        title: "Manual order created",
        description: saveAsConsistent ? "Customer saved for future weeks." : undefined,
      });
      onOpenChange(false);
      setCustomerName("");
      setAddress("");
      setFulfillmentType("delivery");
      setIsTuesday(false);
      setNotes("");
      setPaymentMethod("");
      setCashAmount("");
      setSaveAsConsistent(true);
      setItemLines([{ productName: "", quantity: 1 }]);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create order", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    const validItems = itemLines.filter(i => i.productName.trim());
    if (!customerName.trim() || validItems.length === 0) {
      toast({ title: "Please fill in customer name and at least one item", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      customerName,
      deliveryAddress: fulfillmentType === "delivery" ? (address || null) : null,
      fulfillmentType,
      isTuesday,
      notes: notes || null,
      paymentMethod: paymentMethod || null,
      cashAmount: cashAmount ? parseFloat(cashAmount) : null,
      saveAsConsistent,
      items: validItems.map(i => ({
        productName: i.productName,
        quantity: i.quantity,
        productId: products?.find(p => p.name === i.productName)?.id || null,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" data-testid="button-add-manual-order">
          <Plus className="w-4 h-4 mr-1" />
          Manual Order
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Manual Order</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Customer Name</Label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name"
              data-testid="input-manual-customer"
            />
          </div>
          <div>
            <Label>Order Type</Label>
            <Select value={fulfillmentType} onValueChange={(v) => setFulfillmentType(v as "delivery" | "collection")} data-testid="select-manual-fulfillment">
              <SelectTrigger data-testid="select-manual-fulfillment-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="delivery">Delivery</SelectItem>
                <SelectItem value="collection">Collection</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fulfillmentType === "delivery" && (
            <div>
              <Label>Delivery Address</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Delivery address"
                data-testid="input-manual-address"
              />
            </div>
          )}
          <div className="flex items-center justify-between">
            <Label htmlFor="tuesday-toggle" className="flex items-center gap-2 cursor-pointer">
              <CalendarCheck className="w-4 h-4 text-muted-foreground" />
              Tuesday order
            </Label>
            <Switch id="tuesday-toggle" checked={isTuesday} onCheckedChange={setIsTuesday} data-testid="switch-tuesday" />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any customer notes or special instructions..."
              rows={2}
              data-testid="input-manual-notes"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1"><Banknote className="w-4 h-4" />Payment Method (optional)</Label>
            <Select value={paymentMethod || "none"} onValueChange={(v) => { setPaymentMethod(v === "none" ? "" : v as "cash" | "bank_transfer" | "nil"); if (v === "none" || v === "nil") setCashAmount(""); }}>
              <SelectTrigger data-testid="select-manual-payment-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Online / not specified</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="nil">Nil</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {paymentMethod && paymentMethod !== "nil" && (
            <div>
              <Label>Amount received (£)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
                placeholder="0.00"
                data-testid="input-manual-cash-amount"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Items</Label>
            {itemLines.map((line, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <ProductSelect
                  value={line.productName}
                  onChange={(v) => {
                    const newLines = [...itemLines];
                    newLines[idx].productName = v;
                    setItemLines(newLines);
                  }}
                  products={products}
                  testId={`select-manual-item-${idx}`}
                />
                <Input
                  type="number"
                  value={line.quantity}
                  onChange={(e) => {
                    const newLines = [...itemLines];
                    newLines[idx].quantity = parseInt(e.target.value) || 1;
                    setItemLines(newLines);
                  }}
                  className="w-20 shrink-0"
                  min={1}
                  data-testid={`input-manual-qty-${idx}`}
                />
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setItemLines([...itemLines, { productName: "", quantity: 1 }])}
              data-testid="button-add-item-line"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Item
            </Button>
          </div>
          <div className="flex items-center gap-2 pt-1" data-testid="toggle-save-as-consistent">
            <Switch
              id="save-consistent"
              checked={saveAsConsistent}
              onCheckedChange={setSaveAsConsistent}
              data-testid="switch-save-consistent"
            />
            <Label htmlFor="save-consistent" className="text-sm cursor-pointer">
              Save as consistent customer
            </Label>
          </div>
          <Button onClick={handleSubmit} disabled={createMutation.isPending} className="w-full" data-testid="button-submit-manual-order">
            {createMutation.isPending ? "Creating..." : "Create Order"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditOrderDialog({ order, open, onOpenChange }: { order: OrderWithItems; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState(order.customerName);
  const [address, setAddress] = useState(order.deliveryAddress || "");
  const [fulfillmentType, setFulfillmentType] = useState<"delivery" | "collection">(
    (order.fulfillmentType as "delivery" | "collection") || "collection"
  );
  const [isTuesday, setIsTuesday] = useState(order.isTuesday || false);
  const [notes, setNotes] = useState((order as any).notes || "");
  const [paymentMethod, setPaymentMethod] = useState<"" | "cash" | "bank_transfer">((order as any).paymentMethod || "");
  const [cashAmount, setCashAmount] = useState((order as any).cashAmount != null ? String((order as any).cashAmount) : "");
  const [itemLines, setItemLines] = useState(
    order.items.map(i => ({ productName: i.productName, quantity: i.quantity }))
  );

  const { data: products } = useQuery<any[]>({ queryKey: ["/api/products"] });
  const { data: currentWeekProducts } = useQuery<any[]>({ queryKey: ["/api/products/current-week"] });
  const currentWeekNames = new Set((currentWeekProducts || []).map((p: any) => p.name));
  const currentWeekMeals = (currentWeekProducts || []).filter((p: any) => !/subscription|add\s+delivery/i.test(p.name));

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/orders/${order.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order updated" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update order", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    const validItems = itemLines.filter(i => i.productName.trim());
    if (!customerName.trim() || validItems.length === 0) {
      toast({ title: "Please fill in customer name and at least one item", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      customerName,
      deliveryAddress: fulfillmentType === "delivery" ? (address || null) : null,
      fulfillmentType,
      isTuesday,
      notes: notes || null,
      paymentMethod: paymentMethod || null,
      cashAmount: cashAmount ? parseFloat(cashAmount) : null,
      items: validItems.map(i => ({
        productName: i.productName,
        quantity: i.quantity,
        productId: products?.find((p: any) => p.name === i.productName)?.id || null,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Order</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Customer Name</Label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name"
              data-testid="input-edit-customer"
            />
          </div>
          <div>
            <Label>Order Type</Label>
            <Select value={fulfillmentType} onValueChange={(v) => setFulfillmentType(v as "delivery" | "collection")} data-testid="select-edit-fulfillment">
              <SelectTrigger data-testid="select-edit-fulfillment-trigger">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="delivery">Delivery</SelectItem>
                <SelectItem value="collection">Collection</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fulfillmentType === "delivery" && (
            <div>
              <Label>Delivery Address</Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Delivery address"
                data-testid="input-edit-address"
              />
            </div>
          )}
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-tuesday-toggle" className="flex items-center gap-2 cursor-pointer">
              <CalendarCheck className="w-4 h-4 text-muted-foreground" />
              Tuesday order
            </Label>
            <Switch id="edit-tuesday-toggle" checked={isTuesday} onCheckedChange={setIsTuesday} data-testid="switch-edit-tuesday" />
          </div>
          <div>
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any customer notes or special instructions..."
              rows={2}
              data-testid="input-edit-notes"
            />
          </div>
          <div>
            <Label className="flex items-center gap-1"><Banknote className="w-4 h-4" />Payment Method (optional)</Label>
            <Select value={paymentMethod || "none"} onValueChange={(v) => { setPaymentMethod(v === "none" ? "" : v as "cash" | "bank_transfer" | "nil"); if (v === "none" || v === "nil") setCashAmount(""); }}>
              <SelectTrigger data-testid="select-edit-payment-method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Online / not specified</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                <SelectItem value="nil">Nil</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {paymentMethod && paymentMethod !== "nil" && (
            <div>
              <Label>Amount received (£)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={cashAmount}
                onChange={(e) => setCashAmount(e.target.value)}
                placeholder="0.00"
                data-testid="input-edit-cash-amount"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>Items</Label>
            {itemLines.map((line, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex gap-2 items-start">
                  <ProductSelect
                    value={line.productName}
                    onChange={(v) => {
                      const newLines = [...itemLines];
                      newLines[idx].productName = v;
                      setItemLines(newLines);
                    }}
                    products={products}
                    testId={`select-edit-item-${idx}`}
                  />
                  <Input
                    type="number"
                    value={line.quantity}
                    onChange={(e) => {
                      const newLines = [...itemLines];
                      newLines[idx].quantity = parseInt(e.target.value) || 1;
                      setItemLines(newLines);
                    }}
                    className="w-20 shrink-0"
                    min={1}
                    data-testid={`input-edit-qty-${idx}`}
                  />
                </div>
                {line.productName.trim() && currentWeekProducts && !currentWeekNames.has(line.productName) && (
                  <div className="flex items-center gap-2 pl-1 flex-wrap">
                    <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Not on this week's menu
                    </span>
                    <Select onValueChange={(v) => { const newLines = [...itemLines]; newLines[idx].productName = v; setItemLines(newLines); }}>
                      <SelectTrigger className="h-7 text-xs border-amber-300 text-amber-700 w-auto max-w-[200px]">
                        <SelectValue placeholder="Change to…" />
                      </SelectTrigger>
                      <SelectContent>
                        {currentWeekMeals.map((p: any) => (
                          <SelectItem key={p.id} value={p.name} className="text-xs">{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            ))}
            <Button
              size="sm"
              variant="outline"
              onClick={() => setItemLines([...itemLines, { productName: "", quantity: 1 }])}
              data-testid="button-edit-add-item"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Item
            </Button>
          </div>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending} className="w-full" data-testid="button-submit-edit-order">
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StampDialog({ customer, open, onOpenChange }: {
  customer: RecurringOrderWithItems;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [itemLines, setItemLines] = useState(
    customer.items.length > 0
      ? customer.items.map(i => ({ productName: i.productName, quantity: i.quantity }))
      : [{ productName: "", quantity: 1 }]
  );

  const { data: products } = useQuery<any[]>({ queryKey: ["/api/products"] });

  const stampMutation = useMutation({
    mutationFn: (items: any[]) => apiRequest("POST", `/api/recurring-orders/${customer.id}/stamp`, { items }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: `Order created for ${customer.customerName}` });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to stamp order", description: error.message, variant: "destructive" });
    },
  });

  const handleStamp = () => {
    const validItems = itemLines.filter(i => i.productName.trim());
    if (validItems.length === 0) {
      toast({ title: "Add at least one item", variant: "destructive" });
      return;
    }
    stampMutation.mutate(validItems);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Stamp className="w-4 h-4" />
              {customer.customerName} — This Week
            </span>
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-2">
          Adjust quantities if needed, then stamp to create this week's order.
        </p>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Items</Label>
            {itemLines.map((line, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  value={line.productName}
                  onChange={(e) => {
                    const newLines = [...itemLines];
                    newLines[idx].productName = e.target.value;
                    setItemLines(newLines);
                  }}
                  placeholder="Product name"
                  className="flex-1"
                  list="stamp-product-suggestions"
                  data-testid={`input-stamp-item-${idx}`}
                />
                <Input
                  type="number"
                  value={line.quantity}
                  onChange={(e) => {
                    const newLines = [...itemLines];
                    newLines[idx].quantity = parseInt(e.target.value) || 1;
                    setItemLines(newLines);
                  }}
                  className="w-20"
                  min={1}
                  data-testid={`input-stamp-qty-${idx}`}
                />
                {itemLines.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setItemLines(itemLines.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            ))}
            <datalist id="stamp-product-suggestions">
              {(products || []).map((p: any) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setItemLines([...itemLines, { productName: "", quantity: 1 }])}
              data-testid="button-stamp-add-item"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Item
            </Button>
          </div>
          <Button onClick={handleStamp} disabled={stampMutation.isPending} className="w-full" data-testid="button-confirm-stamp">
            <Stamp className="w-4 h-4 mr-1" />
            {stampMutation.isPending ? "Creating..." : "Stamp This Week's Order"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditConsistentDialog({ customer, open, onOpenChange }: {
  customer: RecurringOrderWithItems;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState(customer.customerName);
  const [address, setAddress] = useState(customer.deliveryAddress || "");
  const [fulfillmentType, setFulfillmentType] = useState<"delivery" | "collection">(
    (customer.fulfillmentType as "delivery" | "collection") || "delivery"
  );
  const [notes, setNotes] = useState((customer as any).notes || "");
  const [active, setActive] = useState(customer.active !== false);
  const [itemLines, setItemLines] = useState(
    customer.items.length > 0
      ? customer.items.map(i => ({ productName: i.productName, quantity: i.quantity }))
      : [{ productName: "", quantity: 1 }]
  );

  const { data: products } = useQuery<any[]>({ queryKey: ["/api/products"] });

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/recurring-orders/${customer.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({ title: "Consistent customer updated" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const validItems = itemLines.filter(i => i.productName.trim());
    if (!customerName.trim()) {
      toast({ title: "Customer name is required", variant: "destructive" });
      return;
    }
    updateMutation.mutate({
      customerName,
      deliveryAddress: fulfillmentType === "delivery" ? (address || null) : null,
      fulfillmentType,
      active,
      notes: notes || null,
      items: validItems.map(i => ({
        productName: i.productName,
        quantity: i.quantity,
        productId: products?.find((p: any) => p.name === i.productName)?.id || null,
      })),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Edit — {customer.customerName}
            {customer.isTuesday
              ? <Badge className="bg-amber-500 text-white text-xs">Tuesday</Badge>
              : <Badge variant="outline" className="text-xs">Saturday</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Customer Name</Label>
            <Input
              value={customerName}
              onChange={e => setCustomerName(e.target.value)}
              placeholder="Customer name"
              data-testid="input-edit-consistent-name"
            />
          </div>
          <div className="space-y-1">
            <Label>Fulfillment</Label>
            <Select value={fulfillmentType} onValueChange={(v: "delivery" | "collection") => setFulfillmentType(v)}>
              <SelectTrigger data-testid="select-edit-consistent-fulfillment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="delivery">Delivery</SelectItem>
                <SelectItem value="collection">Collection</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fulfillmentType === "delivery" && (
            <div className="space-y-1">
              <Label>Delivery Address</Label>
              <Textarea
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="Street, City, Postcode"
                rows={2}
                data-testid="input-edit-consistent-address"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Any regular notes..."
              data-testid="input-edit-consistent-notes"
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Consistent customer</p>
              <p className="text-xs text-muted-foreground">Turn off to stop this customer appearing each week</p>
            </div>
            <Switch
              id="edit-consistent-active"
              checked={active}
              onCheckedChange={setActive}
              data-testid="switch-edit-consistent-active"
            />
          </div>
          <div className="space-y-2">
            <Label>Default Items</Label>
            {itemLines.map((line, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  value={line.productName}
                  onChange={e => {
                    const next = [...itemLines];
                    next[idx].productName = e.target.value;
                    setItemLines(next);
                  }}
                  placeholder="Product name"
                  className="flex-1"
                  list="edit-consistent-products"
                  data-testid={`input-edit-consistent-item-${idx}`}
                />
                <Input
                  type="number"
                  value={line.quantity}
                  onChange={e => {
                    const next = [...itemLines];
                    next[idx].quantity = parseInt(e.target.value) || 1;
                    setItemLines(next);
                  }}
                  className="w-20"
                  min={1}
                  data-testid={`input-edit-consistent-qty-${idx}`}
                />
                {itemLines.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setItemLines(itemLines.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            ))}
            <datalist id="edit-consistent-products">
              {(products || []).map((p: any) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setItemLines([...itemLines, { productName: "", quantity: 1 }])}
              data-testid="button-edit-consistent-add-item"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Item
            </Button>
          </div>
          <Button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="w-full"
            data-testid="button-save-consistent"
          >
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddConsistentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<"delivery" | "collection">("delivery");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [satChecked, setSatChecked] = useState(true);
  const [tueChecked, setTueChecked] = useState(false);
  const [itemLines, setItemLines] = useState([{ productName: "", quantity: 1 }]);
  const { data: products } = useQuery<any[]>({ queryKey: ["/api/products"] });

  const mutation = useMutation({
    mutationFn: async (days: boolean[]) => {
      for (const isTuesday of days) {
        await apiRequest("POST", "/api/recurring-orders", {
          customerName,
          fulfillmentType,
          deliveryAddress: fulfillmentType === "delivery" ? (address || null) : null,
          notes: notes || null,
          isTuesday,
          items: itemLines.filter(i => i.productName.trim()).map(i => ({
            productName: i.productName,
            quantity: i.quantity,
            productId: products?.find((p: any) => p.name === i.productName)?.id || null,
          })),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({ title: "Customer added" });
      onOpenChange(false);
      setCustomerName(""); setAddress(""); setNotes("");
      setSatChecked(true); setTueChecked(false);
      setItemLines([{ productName: "", quantity: 1 }]);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add customer", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    if (!customerName.trim()) {
      toast({ title: "Customer name is required", variant: "destructive" });
      return;
    }
    if (!satChecked && !tueChecked) {
      toast({ title: "Select at least one ordering day", variant: "destructive" });
      return;
    }
    const days: boolean[] = [];
    if (satChecked) days.push(false);
    if (tueChecked) days.push(true);
    mutation.mutate(days);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Consistent Customer</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Customer Name</Label>
            <Input value={customerName} onChange={e => setCustomerName(e.target.value)} placeholder="Customer name" data-testid="input-add-consistent-name" />
          </div>
          <div className="space-y-2">
            <Label>Ordering Days</Label>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox checked={satChecked} onCheckedChange={(v) => setSatChecked(!!v)} data-testid="checkbox-add-saturday" />
                <span className="text-sm">Saturday</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <Checkbox checked={tueChecked} onCheckedChange={(v) => setTueChecked(!!v)} data-testid="checkbox-add-tuesday" />
                <span className="text-sm text-amber-600 dark:text-amber-400">Tuesday</span>
              </label>
            </div>
            {satChecked && tueChecked && (
              <p className="text-xs text-muted-foreground">Items below will be used as the starting template for both days — amend each day separately afterwards.</p>
            )}
          </div>
          <div className="space-y-1">
            <Label>Fulfillment</Label>
            <Select value={fulfillmentType} onValueChange={(v: "delivery" | "collection") => setFulfillmentType(v)}>
              <SelectTrigger data-testid="select-add-consistent-fulfillment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="delivery">Delivery</SelectItem>
                <SelectItem value="collection">Collection</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {fulfillmentType === "delivery" && (
            <div className="space-y-1">
              <Label>Delivery Address</Label>
              <Textarea value={address} onChange={e => setAddress(e.target.value)} placeholder="Street, City, Postcode" rows={2} data-testid="input-add-consistent-address" />
            </div>
          )}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any regular notes..." data-testid="input-add-consistent-notes" />
          </div>
          <div className="space-y-2">
            <Label>Default Items</Label>
            {itemLines.map((line, idx) => (
              <div key={idx} className="flex gap-2">
                <Input
                  value={line.productName}
                  onChange={e => { const n = [...itemLines]; n[idx].productName = e.target.value; setItemLines(n); }}
                  placeholder="Product name"
                  className="flex-1"
                  list="add-consistent-products"
                  data-testid={`input-add-consistent-item-${idx}`}
                />
                <Input
                  type="number"
                  value={line.quantity}
                  onChange={e => { const n = [...itemLines]; n[idx].quantity = parseInt(e.target.value) || 1; setItemLines(n); }}
                  className="w-20"
                  min={1}
                  data-testid={`input-add-consistent-qty-${idx}`}
                />
                {itemLines.length > 1 && (
                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setItemLines(itemLines.filter((_, i) => i !== idx))}>
                    <Trash2 className="w-3 h-3" />
                  </Button>
                )}
              </div>
            ))}
            <datalist id="add-consistent-products">
              {(products || []).map((p: any) => <option key={p.id} value={p.name} />)}
            </datalist>
            <Button size="sm" variant="outline" onClick={() => setItemLines([...itemLines, { productName: "", quantity: 1 }])} data-testid="button-add-consistent-item">
              <Plus className="w-3 h-3 mr-1" />Add Item
            </Button>
          </div>
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="w-full" data-testid="button-submit-add-consistent">
            {mutation.isPending ? "Adding..." : "Add Customer"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
