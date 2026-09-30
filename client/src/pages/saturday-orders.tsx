import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Play, CalendarDays, ShoppingCart, Globe, Copy, CheckCircle2, AlertCircle, Minus, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDateFilter, DateFilter, DateRangeLabel, getDeliveryDatesForWindow } from "@/components/date-filter";
import { format } from "date-fns";
import type { RecurringOrder, RecurringOrderItem, Order, OrderItem } from "@shared/schema";

type RecurringOrderWithItems = RecurringOrder & { items: RecurringOrderItem[] };
type OrderWithItems = Order & { items: OrderItem[] };
type PreviousOrderMap = Record<number, { items: { productName: string; quantity: number }[]; orderDate: string }>;

const SOUP_PRODUCTS = ["curried sweet potato & carrot"];

function itemSortPriority(name: string): number {
  const n = name.toLowerCase();
  if (/subscription/i.test(n)) return 30;
  if (/soup/i.test(n) || SOUP_PRODUCTS.includes(n.trim())) return 20;
  if (/oat|porridge|overnight|gold\s*bar/i.test(n)) return 10;
  return 0;
}
function sortItems<T extends { productName: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => itemSortPriority(a.productName) - itemSortPriority(b.productName));
}

export default function SaturdayOrdersPage() {
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editingOrder, setEditingOrder] = useState<RecurringOrderWithItems | null>(null);
  const [editingManualOrder, setEditingManualOrder] = useState<OrderWithItems | null>(null);
  const [editingItemsOrder, setEditingItemsOrder] = useState<OrderWithItems | null>(null);
  const dateFilter = useDateFilter();
  const { from, to, mode } = dateFilter;
  const deliverySat = mode === "window" ? getDeliveryDatesForWindow(from).saturday : null;

  const { data: orders, isLoading } = useQuery<RecurringOrderWithItems[]>({
    queryKey: ["/api/recurring-orders"],
    select: (data) => data.filter((o: any) => o.isTuesday === false),
  });

  const { data: tuesdayOrders } = useQuery<RecurringOrderWithItems[]>({
    queryKey: ["/api/recurring-orders"],
    select: (data) => data.filter((o: any) => o.isTuesday !== false),
  });

  const { data: previousOrders } = useQuery<PreviousOrderMap>({
    queryKey: ["/api/recurring-orders/previous-orders"],
  });

  const { data: manualOrders } = useQuery<OrderWithItems[]>({
    queryKey: ["/api/orders", `?from=${from.toISOString()}&to=${to.toISOString()}`],
    select: (data) => data.filter(o => o.isManual && !o.isTuesday && o.status !== 'refunded' && o.status !== 'cancelled' && o.status !== 'on-hold'),
  });

  const { data: websiteOrders } = useQuery<OrderWithItems[]>({
    queryKey: ["/api/orders", `?from=${from.toISOString()}&to=${to.toISOString()}`],
    select: (data) => data.filter(o => {
      if (o.isManual) return false;
      if (o.isTuesday) return false;
      if (o.status === 'refunded' || o.status === 'cancelled') return false;
      if (o.items.length > 0 && o.items.every(i => /add\s+delivery/i.test(i.productName))) return false;
      return true;
    }),
  });

  const grandTotals = useMemo(() => {
    if (!websiteOrders) return { orders: 0, delivery: 0, collection: 0, revenue: 0, items: 0 };
    let revenue = 0;
    let items = 0;
    let delivery = 0;
    let collection = 0;
    for (const order of websiteOrders) {
      if (order.fulfillmentType === "delivery") delivery++;
      else collection++;
      for (const item of order.items) {
        revenue += parseFloat(item.price) || 0;
        items += item.quantity;
      }
    }
    return { orders: websiteOrders.length, delivery, collection, revenue, items };
  }, [websiteOrders]);

  const OATS_RE = /oat|porridge|overnight|gold\s*bar/i;
  const mealOatSummary = useMemo(() => {
    let meals = 0, oats = 0;
    const countItems = (items: { productName: string; quantity: number }[]) => {
      for (const item of items) {
        if (OATS_RE.test(item.productName)) oats += item.quantity;
        else meals += item.quantity;
      }
    };
    for (const o of manualOrders ?? []) countItems(o.items);
    for (const o of websiteOrders ?? []) countItems(o.items);
    return { meals, oats };
  }, [manualOrders, websiteOrders]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/recurring-orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({ title: "Recurring order removed" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiRequest("PATCH", `/api/recurring-orders/${id}`, { active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
    },
  });

  const copyItemsMutation = useMutation({
    mutationFn: ({ targetId, items }: { targetId: number; items: { productName: string; quantity: number }[] }) =>
      apiRequest("PATCH", `/api/recurring-orders/${targetId}`, { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({ title: "Items copied from Tuesday order" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to copy items", description: err.message, variant: "destructive" });
    },
  });

  const deleteManualMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders/previous-orders"] });
      toast({ title: "Manual order removed" });
    },
  });

  const [editingAmounts, setEditingAmounts] = useState<Record<number, string>>({});

  const packingMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) => apiRequest("PATCH", `/api/orders/${id}/packing`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/orders"] }),
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/recurring-orders/generate-saturday"),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders/previous-orders"] });
      toast({
        title: "Orders generated",
        description: `${data.created} order${data.created !== 1 ? "s" : ""} created from your recurring list.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to generate", description: err.message, variant: "destructive" });
    },
  });

  const activeCount = orders?.filter(o => o.active).length || 0;

  return (
    <div className="p-6 space-y-6 max-w-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">Saturday Orders</h1>
            {deliverySat && (
              <Badge className="bg-green-600 text-white text-sm px-2.5 py-0.5" data-testid="badge-delivery-date">
                <CalendarDays className="w-3.5 h-3.5 mr-1" />
                Delivering {format(deliverySat, "EEEE do MMMM")}
              </Badge>
            )}
            {(mealOatSummary.meals > 0 || mealOatSummary.oats > 0) && (
              <Badge variant="outline" className="text-sm px-2.5 py-0.5 font-medium" data-testid="badge-meal-summary">
                {mealOatSummary.meals} meal{mealOatSummary.meals !== 1 ? "s" : ""}{mealOatSummary.oats > 0 ? ` + ${mealOatSummary.oats} oats / gold bars` : ""}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Recurring Saturday customers + website orders — website orders filtered to Saturday delivery only
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || activeCount === 0}
            data-testid="button-generate-orders"
          >
            <Play className="w-4 h-4 mr-1" />
            {generateMutation.isPending ? "Generating..." : `Generate This Week (${activeCount})`}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)} data-testid="button-add-recurring">
            <Plus className="w-4 h-4 mr-1" />
            Add Customer
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <DateFilter {...dateFilter} testIdPrefix="sat" />
      </div>

      <div>
        <div className="mb-3 flex items-start gap-3">
          <div className="flex items-center gap-2 mt-0.5 cursor-pointer" onClick={() => setShowTemplates(v => !v)}>
            <Checkbox checked={showTemplates} onCheckedChange={(v) => setShowTemplates(!!v)} data-testid="checkbox-show-templates" />
            <h2 className="text-lg font-semibold select-none" data-testid="text-recurring-heading">Recurring Customer Templates</h2>
          </div>
        </div>
        {showTemplates && (
        <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center text-muted-foreground">Loading...</div>
          ) : !orders || orders.length === 0 ? (
            <div className="p-12 text-center">
              <CalendarDays className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium" data-testid="text-empty-state">No recurring Saturday orders yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add customers who order the same meals every Saturday</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px]">Active</TableHead>
                    <TableHead className="min-w-[140px]">Customer</TableHead>
                    <TableHead className="min-w-[200px]">Items</TableHead>
                    <TableHead className="min-w-[200px]">Address</TableHead>
                    <TableHead className="w-[90px]">Type</TableHead>
                    <TableHead className="w-[100px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const isStamped = manualOrders?.some(
                      m => m.customerName.toLowerCase() === order.customerName.toLowerCase()
                    );
                    const prevEntry = previousOrders?.[order.id];
                    const displayItems = prevEntry && prevEntry.items.length > 0 ? prevEntry.items : order.items;
                    return (
                    <TableRow key={order.id} className={!order.active ? "opacity-50" : ""} data-testid={`row-recurring-${order.id}`}>
                      <TableCell>
                        <Switch
                          checked={order.active}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: order.id, active: checked })}
                          data-testid={`switch-active-${order.id}`}
                        />
                      </TableCell>
                      <TableCell data-testid={`text-customer-${order.id}`}>
                        <div className="font-medium">{order.customerName}</div>
                        {order.active && (() => {
                          return isStamped ? (
                            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 mt-0.5" data-testid={`status-stamped-${order.id}`}>
                              <CheckCircle2 className="w-3 h-3" />Stamped
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mt-0.5" data-testid={`status-needs-stamp-${order.id}`}>
                              <AlertCircle className="w-3 h-3" />Needs stamp
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {displayItems.length > 0 && (
                            <div className="text-sm leading-snug" data-testid={`text-items-${order.id}`}>
                              {sortItems(displayItems).map((item, i) => {
                                return (i > 0 ? ", " : "") + `${item.quantity > 1 ? item.quantity + "× " : ""}${item.productName}`;
                              }).join("")}
                            </div>
                          )}
                          {displayItems.length === 0 && (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-muted-foreground">No items</span>
                              {(() => {
                                const tuesdayMatch = tuesdayOrders?.find(
                                  t => t.customerName.toLowerCase() === order.customerName.toLowerCase() && t.items.length > 0
                                );
                                return tuesdayMatch ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-6 px-2"
                                    disabled={copyItemsMutation.isPending}
                                    onClick={() => copyItemsMutation.mutate({
                                      targetId: order.id,
                                      items: tuesdayMatch.items.map(i => ({ productName: i.productName, quantity: i.quantity })),
                                    })}
                                    data-testid={`button-copy-from-tuesday-${order.id}`}
                                  >
                                    <Copy className="w-3 h-3 mr-1" />
                                    Copy from Tuesday
                                  </Button>
                                ) : null;
                              })()}
                            </div>
                          )}
                          {prevEntry && (
                            <span className="text-xs text-muted-foreground" data-testid={`text-prev-order-date-${order.id}`}>
                              Last order: {format(new Date(prevEntry.orderDate), "d MMM")}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm" data-testid={`text-address-${order.id}`}>
                          {order.deliveryAddress || "—"}
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
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setEditingOrder(order)}
                            data-testid={`button-edit-recurring-${order.id}`}
                          >
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(order.id)}
                            data-testid={`button-delete-recurring-${order.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-muted-foreground" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        </Card>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold" data-testid="text-manual-orders-heading">Manual Saturday Orders</h2>
              {deliverySat && (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs">
                  {format(deliverySat, "EEE do MMM")}
                </Badge>
              )}
            </div>
            <DateRangeLabel from={from} to={to} />
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            {!manualOrders || manualOrders.length === 0 ? (
              <div className="p-8 text-center">
                <ShoppingCart className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground" data-testid="text-no-manual-orders">
                  No manual Saturday orders this week — hit "Generate This Week" to create from your recurring list
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[140px]">Customer</TableHead>
                      <TableHead className="min-w-[200px]">Items</TableHead>
                      <TableHead className="min-w-[200px]">Address</TableHead>
                      <TableHead className="w-[90px]">Type</TableHead>
                      <TableHead className="w-[130px]">Qty / Spend</TableHead>
                      <TableHead className="w-[60px] text-center">Pack</TableHead>
                      <TableHead className="w-[100px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manualOrders.map((order) => (
                      <TableRow key={order.id} data-testid={`row-manual-${order.id}`}>
                        <TableCell className="font-medium" data-testid={`text-manual-customer-${order.id}`}>
                          {order.customerName}
                        </TableCell>
                        <TableCell>
                          <div className="text-sm leading-snug" data-testid={`text-manual-items-${order.id}`}>
                            {sortItems(order.items).map((item, i) => {
                              return (i > 0 ? ", " : "") + `${item.quantity > 1 ? item.quantity + "× " : ""}${item.productName}`;
                            }).join("")}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm" data-testid={`text-manual-address-${order.id}`}>
                            {order.deliveryAddress || "—"}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={order.fulfillmentType === "delivery" ? "default" : "outline"}
                            data-testid={`badge-manual-fulfillment-${order.id}`}
                          >
                            {order.fulfillmentType === "delivery" ? "Delivery" : "Collection"}
                          </Badge>
                        </TableCell>
                        <TableCell data-testid={`text-manual-qty-${order.id}`}>
                          <div className="space-y-1">
                            <div className="tabular-nums text-right leading-tight">
                              {(() => {
                                const meals = order.items.filter(i => !OATS_RE.test(i.productName)).reduce((s, i) => s + i.quantity, 0);
                                const oats = order.items.filter(i => OATS_RE.test(i.productName)).reduce((s, i) => s + i.quantity, 0);
                                return (<>
                                  {meals > 0 && <div className="font-semibold">{meals} meal{meals !== 1 ? "s" : ""}</div>}
                                  {oats > 0 && <div className="text-xs text-muted-foreground">{oats} oats / gold bars</div>}
                                </>);
                              })()}
                            </div>
                            {(order as any).isSubscriptionStamped ? (
                              (order as any).parentOrderTotal != null ? (
                                <div className="text-xs text-muted-foreground" data-testid={`text-sub-paid-${order.id}`}>
                                  Paid £{parseFloat((order as any).parentOrderTotal).toFixed(2)}
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">Paid (sub)</div>
                              )
                            ) : (
                              <>
                                <Select
                                  value={(order as any).paymentMethod || "none"}
                                  onValueChange={(v) => packingMutation.mutate({ id: order.id, data: { paymentMethod: v === "none" ? null : v } })}
                                >
                                  <SelectTrigger className="h-7 text-xs px-2" data-testid={`select-payment-${order.id}`}>
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
                                    className="h-7 text-xs px-2"
                                    placeholder="£0.00"
                                    data-testid={`input-cash-amount-${order.id}`}
                                  />
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Checkbox
                            checked={(order as any).readyToPack === true}
                            onCheckedChange={(checked) => packingMutation.mutate({ id: order.id, data: { readyToPack: !!checked } })}
                            data-testid={`checkbox-pack-${order.id}`}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setEditingManualOrder(order)}
                              data-testid={`button-edit-manual-${order.id}`}
                            >
                              <Pencil className="w-4 h-4 text-muted-foreground" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => deleteManualMutation.mutate(order.id)}
                              data-testid={`button-delete-manual-${order.id}`}
                            >
                              <Trash2 className="w-4 h-4 text-muted-foreground" />
                            </Button>
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
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3">
          <Globe className="w-5 h-5 text-muted-foreground" />
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold" data-testid="text-website-orders-heading">Website Orders — Saturday Delivery</h2>
              {deliverySat && (
                <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 text-xs">
                  {format(deliverySat, "EEE do MMM")}
                </Badge>
              )}
            </div>
            <DateRangeLabel from={from} to={to} />
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            {!websiteOrders || websiteOrders.length === 0 ? (
              <div className="p-8 text-center">
                <Globe className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground" data-testid="text-no-website-orders">
                  No website orders found for this week
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[140px]">Customer</TableHead>
                      <TableHead className="min-w-[220px]">Items</TableHead>
                      <TableHead className="min-w-[180px]">Address</TableHead>
                      <TableHead className="w-[90px]">Type</TableHead>
                      <TableHead className="w-[50px] text-right">Qty</TableHead>
                      <TableHead className="w-[90px] text-right">Total</TableHead>
                      <TableHead className="w-[60px] text-center">Pack</TableHead>
                      <TableHead className="w-[44px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {websiteOrders.map((order) => {
                      const orderTotal = order.items.reduce((sum, i) => sum + (parseFloat(i.price) || 0), 0);
                      const orderMeals = order.items.filter(i => !OATS_RE.test(i.productName)).reduce((s, i) => s + i.quantity, 0);
                      const orderOats = order.items.filter(i => OATS_RE.test(i.productName)).reduce((s, i) => s + i.quantity, 0);
                      const isOverridden = (order as any).portalOverridden === true;
                      return (
                        <TableRow key={order.id} data-testid={`row-website-${order.id}`}>
                          <TableCell className="font-medium" data-testid={`text-website-customer-${order.id}`}>
                            {order.customerName}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm leading-snug" data-testid={`text-website-items-${order.id}`}>
                              {sortItems(order.items).map((item, i) => {
                                return (i > 0 ? ", " : "") + `${item.quantity > 1 ? item.quantity + "× " : ""}${item.productName}`;
                              }).join("")}
                            </div>
                            {isOverridden && (
                              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">✎ corrected</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground" data-testid={`text-website-address-${order.id}`}>
                              {order.deliveryAddress || "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={order.fulfillmentType === "delivery" ? "default" : "outline"}
                              data-testid={`badge-website-fulfillment-${order.id}`}
                            >
                              {order.fulfillmentType === "delivery" ? "Delivery" : "Collection"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums" data-testid={`text-website-qty-${order.id}`}>
                            <div className="leading-tight">
                              {orderMeals > 0 && <div className="font-semibold">{orderMeals} meal{orderMeals !== 1 ? "s" : ""}</div>}
                              {orderOats > 0 && <div className="text-xs text-muted-foreground">{orderOats} oats / gold bars</div>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium" data-testid={`text-website-total-${order.id}`}>
                            £{orderTotal.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={(order as any).readyToPack === true}
                              onCheckedChange={(checked) => packingMutation.mutate({ id: order.id, data: { readyToPack: !!checked } })}
                              data-testid={`checkbox-pack-website-${order.id}`}
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Correct items"
                              onClick={() => setEditingItemsOrder(order)}
                              data-testid={`button-correct-items-${order.id}`}
                            >
                              <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="bg-muted/50 font-semibold" data-testid="row-grand-totals">
                      <TableCell colSpan={2}>
                        Grand Total — {grandTotals.orders} order{grandTotals.orders !== 1 ? "s" : ""}
                        <span className="text-muted-foreground font-normal ml-2 text-xs">
                          ({grandTotals.delivery} delivery · {grandTotals.collection} collection · {grandTotals.items} items)
                        </span>
                      </TableCell>
                      <TableCell colSpan={3} />
                      <TableCell className="text-right tabular-nums" data-testid="text-grand-total-qty">
                        {grandTotals.items}
                      </TableCell>
                      <TableCell className="text-right text-base" data-testid="text-grand-total-revenue">
                        £{grandTotals.revenue.toFixed(2)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <RecurringOrderDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        mode="create"
      />

      {editingOrder && (
        <RecurringOrderDialog
          open={!!editingOrder}
          onOpenChange={(v) => { if (!v) setEditingOrder(null); }}
          mode="edit"
          order={editingOrder}
        />
      )}

      {editingItemsOrder && (
        <EditOrderItemsDialog
          order={editingItemsOrder}
          open={!!editingItemsOrder}
          onOpenChange={(v) => { if (!v) setEditingItemsOrder(null); }}
        />
      )}

      {editingManualOrder && (
        <EditManualOrderDialog
          order={editingManualOrder}
          open={!!editingManualOrder}
          onOpenChange={(v) => { if (!v) setEditingManualOrder(null); }}
        />
      )}
    </div>
  );
}

function EditOrderItemsDialog({ order, open, onOpenChange }: { order: OrderWithItems; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [itemLines, setItemLines] = useState(
    order.items.filter(i => !i.portalAdded).map(i => ({ productName: i.productName, quantity: i.quantity }))
  );
  const { data: products } = useQuery<any[]>({ queryKey: ["/api/products"] });

  const saveMutation = useMutation({
    mutationFn: (items: Array<{ productName: string; quantity: number }>) =>
      apiRequest("PATCH", `/api/orders/${order.id}/items`, { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Items corrected", description: "The order will not be overwritten by future syncs." });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const valid = itemLines.filter(i => i.productName.trim() && i.quantity > 0);
    if (valid.length === 0) { toast({ title: "Add at least one item", variant: "destructive" }); return; }
    saveMutation.mutate(valid);
  };

  const mealProducts = (products || []).filter((p: any) => !/subscription|add\s+delivery/i.test(p.name));
  const { data: currentWeekProducts } = useQuery<any[]>({ queryKey: ["/api/products/current-week"] });
  const currentWeekNames = new Set((currentWeekProducts || []).map((p: any) => p.name));
  const currentWeekMeals = (currentWeekProducts || []).filter((p: any) => !/subscription|add\s+delivery/i.test(p.name));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Correct Items — {order.customerName}
          </DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-1">
          Changes here will lock this order against future WooCommerce syncs and mark it as corrected.
        </p>
        <div className="space-y-2">
          {itemLines.map((line, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex gap-2 items-center">
                <Input
                  value={line.productName}
                  onChange={(e) => { const n = [...itemLines]; n[idx].productName = e.target.value; setItemLines(n); }}
                  placeholder="Product name"
                  className="flex-1 text-sm"
                  list="sat-correct-items-suggestions"
                  data-testid={`input-correct-item-name-${idx}`}
                />
                <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => { const n = [...itemLines]; n[idx].quantity = Math.max(1, n[idx].quantity - 1); setItemLines(n); }} data-testid={`button-correct-qty-minus-${idx}`}><Minus className="w-3 h-3" /></Button>
                <span className="w-6 text-center text-sm font-semibold">{line.quantity}</span>
                <Button size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => { const n = [...itemLines]; n[idx].quantity = n[idx].quantity + 1; setItemLines(n); }} data-testid={`button-correct-qty-plus-${idx}`}><Plus className="w-3 h-3" /></Button>
                <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => setItemLines(itemLines.filter((_, i) => i !== idx))} disabled={itemLines.length <= 1} data-testid={`button-correct-remove-${idx}`}><Trash2 className="w-3 h-3 text-destructive" /></Button>
              </div>
              {line.productName.trim() && currentWeekProducts && !currentWeekNames.has(line.productName) && (
                <div className="flex items-center gap-2 pl-1 flex-wrap">
                  <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> Not on this week's menu
                  </span>
                  <Select onValueChange={(v) => { const n = [...itemLines]; n[idx].productName = v; setItemLines(n); }}>
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
          <datalist id="sat-correct-items-suggestions">
            {mealProducts.map((p: any) => <option key={p.id} value={p.name} />)}
          </datalist>
          <Button size="sm" variant="outline" onClick={() => setItemLines([...itemLines, { productName: "", quantity: 1 }])} data-testid="button-correct-add-item">
            <Plus className="w-3 h-3 mr-1" /> Add Item
          </Button>
        </div>
        <div className="border-t pt-3 mt-1 flex gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1" data-testid="button-correct-cancel">Cancel</Button>
          <Button onClick={handleSave} disabled={saveMutation.isPending} className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white" data-testid="button-correct-save">
            {saveMutation.isPending ? <RotateCcw className="w-4 h-4 animate-spin" /> : "Save Correction"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditManualOrderDialog({ order, open, onOpenChange }: { order: OrderWithItems; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState(order.customerName);
  const [address, setAddress] = useState(order.deliveryAddress || "");
  const [fulfillmentType, setFulfillmentType] = useState<"delivery" | "collection">(
    (order.fulfillmentType as "delivery" | "collection") || "collection"
  );
  const [itemLines, setItemLines] = useState(
    order.items.map(i => ({ productName: i.productName, quantity: i.quantity }))
  );

  const { data: products } = useQuery<any[]>({ queryKey: ["/api/products"] });
  const { data: cwProducts } = useQuery<any[]>({ queryKey: ["/api/products/current-week"] });
  const cwNames = new Set((cwProducts || []).map((p: any) => p.name));
  const cwMeals = (cwProducts || []).filter((p: any) => !/subscription|add\s+delivery/i.test(p.name));

  const updateMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PATCH", `/api/orders/${order.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order updated" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
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
          <DialogTitle>Edit Manual Order</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Customer Name</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name" data-testid="input-edit-manual-customer" />
          </div>
          <div>
            <Label>Order Type</Label>
            <Select value={fulfillmentType} onValueChange={(v) => setFulfillmentType(v as "delivery" | "collection")}>
              <SelectTrigger data-testid="select-edit-manual-fulfillment-trigger">
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
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Delivery address" data-testid="input-edit-manual-address" />
            </div>
          )}
          <div className="space-y-2">
            <Label>Items</Label>
            {itemLines.map((line, idx) => (
              <div key={idx} className="space-y-1">
                <div className="flex gap-2">
                  <Input
                    value={line.productName}
                    onChange={(e) => { const n = [...itemLines]; n[idx].productName = e.target.value; setItemLines(n); }}
                    placeholder="Product name" className="flex-1" list="sat-edit-manual-product-suggestions"
                    data-testid={`input-edit-manual-item-${idx}`}
                  />
                  <Input
                    type="number" value={line.quantity}
                    onChange={(e) => { const n = [...itemLines]; n[idx].quantity = parseInt(e.target.value) || 1; setItemLines(n); }}
                    className="w-20" min={1} data-testid={`input-edit-manual-qty-${idx}`}
                  />
                  <Button
                    size="icon" variant="ghost"
                    onClick={() => setItemLines(itemLines.filter((_, i) => i !== idx))}
                    disabled={itemLines.length <= 1}
                    data-testid={`button-remove-item-${idx}`}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
                {line.productName.trim() && cwProducts && !cwNames.has(line.productName) && (
                  <div className="flex items-center gap-2 pl-1 flex-wrap">
                    <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Not on this week's menu
                    </span>
                    <Select onValueChange={(v) => { const n = [...itemLines]; n[idx].productName = v; setItemLines(n); }}>
                      <SelectTrigger className="h-7 text-xs border-amber-300 text-amber-700 w-auto max-w-[200px]">
                        <SelectValue placeholder="Change to…" />
                      </SelectTrigger>
                      <SelectContent>
                        {cwMeals.map((p: any) => (
                          <SelectItem key={p.id} value={p.name} className="text-xs">{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            ))}
            <datalist id="sat-edit-manual-product-suggestions">
              {(products || []).map((p: any) => <option key={p.id} value={p.name} />)}
            </datalist>
            <Button size="sm" variant="outline" onClick={() => setItemLines([...itemLines, { productName: "", quantity: 1 }])} data-testid="button-edit-manual-add-item">
              <Plus className="w-3 h-3 mr-1" /> Add Item
            </Button>
          </div>
          <Button onClick={handleSubmit} disabled={updateMutation.isPending} className="w-full" data-testid="button-submit-edit-manual">
            {updateMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RecurringOrderDialog({
  open,
  onOpenChange,
  mode,
  order,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  order?: RecurringOrderWithItems;
}) {
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState(order?.customerName || "");
  const [address, setAddress] = useState(order?.deliveryAddress || "");
  const [fulfillmentType, setFulfillmentType] = useState<"delivery" | "collection">(
    (order?.fulfillmentType as "delivery" | "collection") || "delivery"
  );
  const [itemLines, setItemLines] = useState(
    order?.items?.map(i => ({ productName: i.productName, quantity: i.quantity })) || [{ productName: "", quantity: 1 }]
  );

  const { data: products } = useQuery<any[]>({ queryKey: ["/api/products"] });

  const mutation = useMutation({
    mutationFn: (data: any) =>
      mode === "create"
        ? apiRequest("POST", "/api/recurring-orders", data)
        : apiRequest("PATCH", `/api/recurring-orders/${order!.id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({ title: mode === "create" ? "Recurring order added" : "Recurring order updated" });
      onOpenChange(false);
      if (mode === "create") {
        setCustomerName("");
        setAddress("");
        setFulfillmentType("delivery");
        setItemLines([{ productName: "", quantity: 1 }]);
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const handleSubmit = () => {
    const validItems = itemLines.filter(i => i.productName.trim());
    if (!customerName.trim() || validItems.length === 0) {
      toast({ title: "Please fill in customer name and at least one item", variant: "destructive" });
      return;
    }
    mutation.mutate({
      customerName,
      deliveryAddress: fulfillmentType === "delivery" ? (address || null) : null,
      fulfillmentType,
      isTuesday: false,
      items: validItems,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Saturday Customer" : "Edit Recurring Order"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Customer Name</Label>
            <Input
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Customer name"
              data-testid="input-recurring-customer"
            />
          </div>
          <div>
            <Label>Order Type</Label>
            <Select value={fulfillmentType} onValueChange={(v) => setFulfillmentType(v as "delivery" | "collection")}>
              <SelectTrigger data-testid="select-recurring-fulfillment-trigger">
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
                data-testid="input-recurring-address"
              />
            </div>
          )}
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
                  list="sat-recurring-product-suggestions"
                  data-testid={`input-recurring-item-${idx}`}
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
                  data-testid={`input-recurring-qty-${idx}`}
                />
                {itemLines.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setItemLines(itemLines.filter((_, i) => i !== idx))}
                    data-testid={`button-remove-item-${idx}`}
                  >
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
            <datalist id="sat-recurring-product-suggestions">
              {(products || []).map((p: any) => <option key={p.id} value={p.name} />)}
            </datalist>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setItemLines([...itemLines, { productName: "", quantity: 1 }])}
              data-testid="button-add-item"
            >
              <Plus className="w-3 h-3 mr-1" /> Add Item
            </Button>
          </div>
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="w-full" data-testid="button-submit-recurring">
            {mutation.isPending ? "Saving..." : mode === "create" ? "Add Customer" : "Save Changes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
