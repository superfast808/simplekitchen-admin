import { useState } from "react";
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
import { Plus, Pencil, Trash2, Play, CalendarCheck, ShoppingCart, CalendarDays, Copy, CheckCircle2, AlertCircle, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useDateFilter, DateFilter, DateRangeLabel, getDeliveryDatesForWindow } from "@/components/date-filter";
import { format } from "date-fns";
import { useMemo } from "react";
import type { RecurringOrder, RecurringOrderItem, Order, OrderItem } from "@shared/schema";

type RecurringOrderWithItems = RecurringOrder & { items: RecurringOrderItem[] };
type OrderWithItems = Order & { items: OrderItem[] };
type PreviousOrderMap = Record<number, { items: { productName: string; quantity: number }[]; orderDate: string }>;

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

export default function TuesdayOrdersPage() {
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [editingOrder, setEditingOrder] = useState<RecurringOrderWithItems | null>(null);
  const [editingManualOrder, setEditingManualOrder] = useState<OrderWithItems | null>(null);
  const dateFilter = useDateFilter();
  const { from, to, mode } = dateFilter;
  const deliveryTue = mode === "window" ? getDeliveryDatesForWindow(from).tuesday : null;

  const { data: orders, isLoading } = useQuery<RecurringOrderWithItems[]>({
    queryKey: ["/api/recurring-orders"],
    select: (data) => data.filter((o: any) => o.isTuesday !== false),
  });

  const { data: saturdayOrders } = useQuery<RecurringOrderWithItems[]>({
    queryKey: ["/api/recurring-orders"],
    select: (data) => data.filter((o: any) => o.isTuesday === false),
  });

  const { data: previousOrders } = useQuery<PreviousOrderMap>({
    queryKey: ["/api/recurring-orders/previous-orders"],
  });

  const { data: manualOrders } = useQuery<OrderWithItems[]>({
    queryKey: ["/api/orders", `?from=${from.toISOString()}&to=${to.toISOString()}`],
    select: (data) => data.filter(o => o.isManual && o.isTuesday && o.status !== 'refunded'),
  });

  const { data: tuesdayWebOrders } = useQuery<OrderWithItems[]>({
    queryKey: ["/api/orders", `?from=${from.toISOString()}&to=${to.toISOString()}`],
    select: (data) => data.filter(o => {
      if (o.isManual) return false;
      if (!o.isTuesday) return false;
      if (o.status === 'refunded') return false;
      if (o.items.length > 0 && o.items.every(i => /add\s+delivery/i.test(i.productName))) return false;
      return true;
    }),
  });

  const tuesdayWebTotals = useMemo(() => {
    if (!tuesdayWebOrders) return { orders: 0, delivery: 0, collection: 0, revenue: 0, items: 0 };
    let revenue = 0, items = 0, delivery = 0, collection = 0;
    for (const order of tuesdayWebOrders) {
      if (order.fulfillmentType === "delivery") delivery++;
      else collection++;
      for (const item of order.items) {
        revenue += parseFloat(item.price) || 0;
        items += item.quantity;
      }
    }
    return { orders: tuesdayWebOrders.length, delivery, collection, revenue, items };
  }, [tuesdayWebOrders]);

  const OATS_RE = /oat|porridge|overnight/i;
  const mealOatSummary = useMemo(() => {
    let meals = 0, oats = 0;
    const countItems = (items: { productName: string; quantity: number }[]) => {
      for (const item of items) {
        if (OATS_RE.test(item.productName)) oats += item.quantity;
        else meals += item.quantity;
      }
    };
    for (const o of manualOrders ?? []) countItems(o.items);
    for (const o of tuesdayWebOrders ?? []) countItems(o.items);
    return { meals, oats };
  }, [manualOrders, tuesdayWebOrders]);

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
      toast({ title: "Items copied from Saturday order" });
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
    mutationFn: () => apiRequest("POST", "/api/recurring-orders/generate"),
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
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">Tuesday Orders</h1>
            {deliveryTue && (
              <Badge className="bg-amber-500 text-white text-sm px-2.5 py-0.5" data-testid="badge-delivery-date">
                <CalendarCheck className="w-3.5 h-3.5 mr-1" />
                Delivering {format(deliveryTue, "EEEE do MMMM")}
              </Badge>
            )}
            {(mealOatSummary.meals > 0 || mealOatSummary.oats > 0) && (
              <Badge variant="outline" className="text-sm px-2.5 py-0.5 font-medium" data-testid="badge-meal-summary">
                {mealOatSummary.meals} meal{mealOatSummary.meals !== 1 ? "s" : ""}{mealOatSummary.oats > 0 ? ` + ${mealOatSummary.oats} oats` : ""}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Recurring Tuesday customers + two-week subscription orders — use prev/next to change week
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
        <DateFilter {...dateFilter} testIdPrefix="tue" />
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
              <CalendarCheck className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium" data-testid="text-empty-state">No recurring orders yet</p>
              <p className="text-sm text-muted-foreground mt-1">Add customers who order the same meals every week</p>
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
                                const saturdayMatch = saturdayOrders?.find(
                                  s => s.customerName.toLowerCase() === order.customerName.toLowerCase() && s.items.length > 0
                                );
                                return saturdayMatch ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-xs h-6 px-2"
                                    disabled={copyItemsMutation.isPending}
                                    onClick={() => copyItemsMutation.mutate({
                                      targetId: order.id,
                                      items: saturdayMatch.items.map(i => ({ productName: i.productName, quantity: i.quantity })),
                                    })}
                                    data-testid={`button-copy-from-saturday-${order.id}`}
                                  >
                                    <Copy className="w-3 h-3 mr-1" />
                                    Copy from Saturday
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
              <h2 className="text-lg font-semibold" data-testid="text-manual-orders-heading">Manual Tuesday Orders</h2>
              {deliveryTue && (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-xs">
                  {format(deliveryTue, "EEE do MMM")}
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
                  No manual orders this week — hit "Generate This Week" to create from your recurring list
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
                                  {oats > 0 && <div className="text-xs text-muted-foreground">{oats} oats</div>}
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
                                  </SelectContent>
                                </Select>
                                {(order as any).paymentMethod && (order as any).paymentMethod !== "none" && (
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
              <h2 className="text-lg font-semibold" data-testid="text-tue-website-orders-heading">Website Orders — Tuesday Delivery</h2>
              {deliveryTue && (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-xs">
                  {format(deliveryTue, "EEE do MMM")}
                </Badge>
              )}
            </div>
            <DateRangeLabel from={from} to={to} />
          </div>
        </div>
        <Card>
          <CardContent className="p-0">
            {!tuesdayWebOrders || tuesdayWebOrders.length === 0 ? (
              <div className="p-8 text-center">
                <Globe className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm text-muted-foreground" data-testid="text-no-tue-website-orders">
                  No Tuesday website orders this week (two-week subscription orders will appear here)
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tuesdayWebOrders.map((order) => {
                      const orderTotal = order.items.reduce((sum, i) => sum + (parseFloat(i.price) || 0), 0);
                      const orderMeals = order.items.filter(i => !OATS_RE.test(i.productName)).reduce((s, i) => s + i.quantity, 0);
                      const orderOats = order.items.filter(i => OATS_RE.test(i.productName)).reduce((s, i) => s + i.quantity, 0);
                      return (
                        <TableRow key={order.id} data-testid={`row-tue-website-${order.id}`}>
                          <TableCell className="font-medium" data-testid={`text-tue-website-customer-${order.id}`}>
                            {order.customerName}
                          </TableCell>
                          <TableCell>
                            <div className="text-sm leading-snug" data-testid={`text-tue-website-items-${order.id}`}>
                              {sortItems(order.items).map((item, i) => {
                                return (i > 0 ? ", " : "") + `${item.quantity > 1 ? item.quantity + "× " : ""}${item.productName}`;
                              }).join("")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted-foreground" data-testid={`text-tue-website-address-${order.id}`}>
                              {order.deliveryAddress || "—"}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={order.fulfillmentType === "delivery" ? "default" : "outline"}
                              data-testid={`badge-tue-website-fulfillment-${order.id}`}
                            >
                              {order.fulfillmentType === "delivery" ? "Delivery" : "Collection"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums" data-testid={`text-tue-website-qty-${order.id}`}>
                            <div className="leading-tight">
                              {orderMeals > 0 && <div className="font-semibold">{orderMeals} meal{orderMeals !== 1 ? "s" : ""}</div>}
                              {orderOats > 0 && <div className="text-xs text-muted-foreground">{orderOats} oats</div>}
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-medium" data-testid={`text-tue-website-total-${order.id}`}>
                            £{orderTotal.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={(order as any).readyToPack === true}
                              onCheckedChange={(checked) => packingMutation.mutate({ id: order.id, data: { readyToPack: !!checked } })}
                              data-testid={`checkbox-pack-tue-website-${order.id}`}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                  <TableFooter>
                    <TableRow className="bg-muted/50 font-semibold" data-testid="row-tue-grand-totals">
                      <TableCell colSpan={2}>
                        Grand Total — {tuesdayWebTotals.orders} order{tuesdayWebTotals.orders !== 1 ? "s" : ""}
                        <span className="text-muted-foreground font-normal ml-2 text-xs">
                          ({tuesdayWebTotals.delivery} delivery · {tuesdayWebTotals.collection} collection · {tuesdayWebTotals.items} items)
                        </span>
                      </TableCell>
                      <TableCell colSpan={3} />
                      <TableCell className="text-right tabular-nums" data-testid="text-tue-grand-total-qty">
                        {tuesdayWebTotals.items}
                      </TableCell>
                      <TableCell className="text-right text-base" data-testid="text-tue-grand-total-revenue">
                        £{tuesdayWebTotals.revenue.toFixed(2)}
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
              <div key={idx} className="flex gap-2">
                <Input
                  value={line.productName}
                  onChange={(e) => { const n = [...itemLines]; n[idx].productName = e.target.value; setItemLines(n); }}
                  placeholder="Product name" className="flex-1" list="edit-manual-product-suggestions"
                  data-testid={`input-edit-manual-item-${idx}`}
                />
                <Input
                  type="number" value={line.quantity}
                  onChange={(e) => { const n = [...itemLines]; n[idx].quantity = parseInt(e.target.value) || 1; setItemLines(n); }}
                  className="w-20" min={1} data-testid={`input-edit-manual-qty-${idx}`}
                />
              </div>
            ))}
            <datalist id="edit-manual-product-suggestions">
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
      items: validItems,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Recurring Customer" : "Edit Recurring Order"}</DialogTitle>
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
                  list="recurring-product-suggestions"
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
              </div>
            ))}
            <datalist id="recurring-product-suggestions">
              {(products || []).map((p: any) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setItemLines([...itemLines, { productName: "", quantity: 1 }])}
              data-testid="button-recurring-add-item"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add Item
            </Button>
          </div>
          <Button onClick={handleSubmit} disabled={mutation.isPending} className="w-full" data-testid="button-submit-recurring">
            {mutation.isPending ? "Saving..." : (mode === "create" ? "Add Customer" : "Save Changes")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
