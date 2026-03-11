import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { RefreshCw, Trash2, Plus, ShoppingCart, Download, Tag, Pencil, CalendarCheck, Banknote, MessageSquare, UserCheck, ChevronDown, ChevronUp, Stamp } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateFilter, DateRangeLabel, useDateFilter } from "@/components/date-filter";
import { OrderSourceFilter, useOrderSourceFilter } from "@/components/order-source-filter";
import type { Order, OrderItem, RecurringOrder, RecurringOrderItem } from "@shared/schema";

type OrderWithItems = Order & { items: OrderItem[] };
type RecurringOrderWithItems = RecurringOrder & { items: RecurringOrderItem[] };

export default function OrdersPage() {
  const { toast } = useToast();
  const dateFilter = useDateFilter();
  const sourceFilter = useOrderSourceFilter();
  const [dayFilter, setDayFilter] = useState<"all" | "saturday" | "tuesday">("all");
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OrderWithItems | null>(null);
  const [showConsistent, setShowConsistent] = useState(true);
  const [stampingCustomer, setStampingCustomer] = useState<RecurringOrderWithItems | null>(null);

  const { from, to } = dateFilter;

  const { data: allOrders, isLoading } = useQuery<OrderWithItems[]>({
    queryKey: ["/api/orders", `?from=${from.toISOString()}&to=${to.toISOString()}`],
  });

  const { data: allConsistentCustomers } = useQuery<RecurringOrderWithItems[]>({
    queryKey: ["/api/recurring-orders"],
    select: (data) => data.filter((c: any) => c.isTuesday === false),
  });

  const deleteConsistentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/recurring-orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({ title: "Consistent customer removed" });
    },
  });

  const orders = allOrders?.filter(o => {
    if (dayFilter === "saturday" && o.isTuesday) return false;
    if (dayFilter === "tuesday" && !o.isTuesday) return false;
    return sourceFilter.filterOrder(o);
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/woo/sync-orders"),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Orders synced", description: `Imported: ${data.imported}, Updated: ${data.updated}` });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    },
    onError: (error: Error) => {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Order deleted" });
    },
  });

  const allProductNames = Array.from(new Set((orders || []).flatMap(o => o.items.map(i => i.productName)))).sort();

  const productTotals: Record<string, number> = {};
  for (const name of allProductNames) {
    productTotals[name] = (orders || []).reduce((sum, order) => {
      return sum + order.items.filter(i => i.productName === name).reduce((s, i) => s + i.quantity, 0);
    }, 0);
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

  const handleLabels = () => {
    const params = new URLSearchParams({
      from: from.toISOString(),
      to: to.toISOString(),
    });
    window.open(`/api/orders/labels?${params.toString()}`, "_blank");
  };

  return (
    <div className="p-6 space-y-6 max-w-full">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">Orders</h1>
          <DateRangeLabel from={from} to={to} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateFilter {...dateFilter} testIdPrefix="orders" showMonth />
          <Button size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="button-sync-orders">
            <RefreshCw className={`w-4 h-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            Sync from Woo
          </Button>
          {orders && orders.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={handleExport} data-testid="button-export-xlsx">
                <Download className="w-4 h-4 mr-1" />
                Export XLSX
              </Button>
              <Button size="sm" variant="outline" onClick={handleLabels} data-testid="button-print-labels">
                <Tag className="w-4 h-4 mr-1" />
                Labels
              </Button>
            </>
          )}
          <ManualOrderDialog open={showManualDialog} onOpenChange={setShowManualDialog} />
        </div>
      </div>

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

      {(allConsistentCustomers && allConsistentCustomers.length > 0) && (
        <Card data-testid="card-consistent-customers">
          <CardContent className="p-0">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              onClick={() => setShowConsistent(v => !v)}
              data-testid="button-toggle-consistent"
            >
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium text-sm">Consistent Customers</span>
                <Badge variant="secondary" className="text-xs">{allConsistentCustomers.length}</Badge>
              </div>
              {showConsistent ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
            {showConsistent && (
              <div className="border-t">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Default Items</TableHead>
                      <TableHead className="w-[130px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allConsistentCustomers.map(c => (
                      <TableRow key={c.id} data-testid={`row-consistent-${c.id}`}>
                        <TableCell className="font-medium">{c.customerName}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs capitalize">{c.fulfillmentType}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {c.items.length === 0
                            ? <span className="italic">No items set</span>
                            : c.items.map(i => `${i.quantity}×${i.productName}`).join(", ")}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="default"
                              className="h-7 text-xs"
                              onClick={() => setStampingCustomer(c)}
                              data-testid={`button-stamp-${c.id}`}
                            >
                              <Stamp className="w-3 h-3 mr-1" />
                              This week
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => deleteConsistentMutation.mutate(c.id)}
                              data-testid={`button-remove-consistent-${c.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
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
                    <TableHead className="min-w-[150px]">Customer</TableHead>
                    {allProductNames.map(name => (
                      <TableHead key={name} className="text-center min-w-[80px]">{name}</TableHead>
                    ))}
                    <TableHead className="min-w-[180px]">Delivery Address</TableHead>
                    <TableHead className="w-[100px]">Type</TableHead>
                    <TableHead className="w-[70px] text-right">Spend</TableHead>
                    <TableHead className="w-[80px]">Status</TableHead>
                    <TableHead className="min-w-[120px]">Notes / Cash</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => {
                    const orderSpend = order.items.reduce((sum, i) => sum + i.quantity * parseFloat(i.price || "0"), 0);
                    const itemSummary = order.items
                      .filter(i => !i.productName.toLowerCase().includes("add delivery"))
                      .map(i => `${i.quantity}×${i.productName}`)
                      .join(", ");
                    return (
                    <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span data-testid={`text-customer-${order.id}`}>{order.customerName}</span>
                          {order.isManual && (
                            <Badge variant="outline" className="text-xs">Manual</Badge>
                          )}
                          {order.isTuesday && (
                            <Badge variant="outline" className="text-xs border-amber-400 text-amber-600 dark:text-amber-400" data-testid={`badge-tuesday-${order.id}`}>
                              <CalendarCheck className="w-3 h-3 mr-0.5" />Tue
                            </Badge>
                          )}
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
                      <TableCell className="text-right font-medium text-sm" data-testid={`text-spend-${order.id}`}>
                        {orderSpend > 0 ? `£${orderSpend.toFixed(2)}` : <span className="text-muted-foreground/30">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusColor(order.status)} data-testid={`badge-status-${order.id}`}>
                          {order.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {(order as any).notes && (
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
                          )}
                          {(order as any).cashAmount && parseFloat((order as any).cashAmount) > 0 && (
                            <div className="flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium" data-testid={`text-cash-${order.id}`}>
                              <Banknote className="w-3 h-3 flex-shrink-0" />
                              Cash £{parseFloat((order as any).cashAmount).toFixed(2)}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {order.isManual && (
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setEditingOrder(order)}
                              data-testid={`button-edit-order-${order.id}`}
                            >
                              <Pencil className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          )}
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => deleteMutation.mutate(order.id)}
                            data-testid={`button-delete-order-${order.id}`}
                          >
                            <Trash2 className="w-4 h-4 text-muted-foreground" />
                          </Button>
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
                    <TableCell className="font-bold text-xs text-muted-foreground">Address</TableCell>
                    <TableCell className="font-bold text-xs text-muted-foreground">Type</TableCell>
                    <TableCell className="font-bold text-xs text-muted-foreground text-right">Spend</TableCell>
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
                    <TableCell></TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-right font-bold text-sm" data-testid="text-total-spend">
                      £{(orders || []).reduce((sum, o) => sum + o.items.reduce((s, i) => s + i.quantity * parseFloat(i.price || "0"), 0), 0).toFixed(2)}
                    </TableCell>
                    <TableCell></TableCell>
                    <TableCell className="text-sm font-medium text-green-700 dark:text-green-400" data-testid="text-total-cash">
                      {(() => {
                        const totalCash = (orders || []).reduce((sum, o) => sum + (parseFloat((o as any).cashAmount || "0") || 0), 0);
                        return totalCash > 0 ? `Cash: £${totalCash.toFixed(2)}` : "";
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
  const [cashAmount, setCashAmount] = useState("");
  const [itemLines, setItemLines] = useState([{ productName: "", quantity: 1 }]);

  const { data: products } = useQuery<any[]>({ queryKey: ["/api/products"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/orders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recurring-orders"] });
      toast({ title: "Manual order created", description: "Customer saved for future weeks." });
      onOpenChange(false);
      setCustomerName("");
      setAddress("");
      setFulfillmentType("delivery");
      setIsTuesday(false);
      setNotes("");
      setCashAmount("");
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
      cashAmount: cashAmount ? cashAmount : null,
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
            <Label className="flex items-center gap-1"><Banknote className="w-4 h-4" />Cash Payment (optional)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              placeholder="0.00"
              data-testid="input-manual-cash"
            />
            <p className="text-xs text-muted-foreground mt-1">Enter cash amount if payment wasn't taken online</p>
          </div>
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
                  list="product-suggestions"
                  data-testid={`input-manual-item-${idx}`}
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
                  data-testid={`input-manual-qty-${idx}`}
                />
              </div>
            ))}
            <datalist id="product-suggestions">
              {(products || []).map(p => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
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
  const [cashAmount, setCashAmount] = useState((order as any).cashAmount ? String(parseFloat((order as any).cashAmount)) : "");
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
      cashAmount: cashAmount ? cashAmount : null,
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
            <Label className="flex items-center gap-1"><Banknote className="w-4 h-4" />Cash Payment (optional)</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={cashAmount}
              onChange={(e) => setCashAmount(e.target.value)}
              placeholder="0.00"
              data-testid="input-edit-cash"
            />
          </div>
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
                  list="edit-product-suggestions"
                  data-testid={`input-edit-item-${idx}`}
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
                  data-testid={`input-edit-qty-${idx}`}
                />
              </div>
            ))}
            <datalist id="edit-product-suggestions">
              {(products || []).map((p: any) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
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
