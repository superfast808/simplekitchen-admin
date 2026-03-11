import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from "@/components/ui/table";
import { RefreshCw, Trash2, Plus, ShoppingCart, Download, Tag, Pencil, CalendarCheck } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateFilter, DateRangeLabel, useDateFilter } from "@/components/date-filter";
import { OrderSourceFilter, useOrderSourceFilter } from "@/components/order-source-filter";
import type { Order, OrderItem } from "@shared/schema";

type OrderWithItems = Order & { items: OrderItem[] };

export default function OrdersPage() {
  const { toast } = useToast();
  const dateFilter = useDateFilter();
  const sourceFilter = useOrderSourceFilter();
  const [showManualDialog, setShowManualDialog] = useState(false);
  const [editingOrder, setEditingOrder] = useState<OrderWithItems | null>(null);

  const { from, to } = dateFilter;

  const { data: allOrders, isLoading } = useQuery<OrderWithItems[]>({
    queryKey: ["/api/orders", `?from=${from.toISOString()}&to=${to.toISOString()}`],
  });

  const orders = allOrders?.filter(sourceFilter.filterOrder);

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
                    <TableHead className="min-w-[140px]">Customer</TableHead>
                    {allProductNames.map(name => (
                      <TableHead key={name} className="text-center min-w-[80px]">{name}</TableHead>
                    ))}
                    <TableHead className="min-w-[200px]">Delivery Address</TableHead>
                    <TableHead className="w-[90px]">Type</TableHead>
                    <TableHead className="w-[80px]">Status</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orders.map((order) => (
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
                          {order.deliveryAddress || "No address"}
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
                        <Badge variant={statusColor(order.status)} data-testid={`badge-status-${order.id}`}>
                          {order.status}
                        </Badge>
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
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="border-t-2">
                    <TableCell className="font-bold text-xs text-muted-foreground">Customer</TableCell>
                    {allProductNames.map(name => (
                      <TableCell key={name} className="text-center font-bold text-xs text-muted-foreground">{name}</TableCell>
                    ))}
                    <TableCell className="font-bold text-xs text-muted-foreground">Delivery Address</TableCell>
                    <TableCell className="font-bold text-xs text-muted-foreground">Type</TableCell>
                    <TableCell className="font-bold text-xs text-muted-foreground">Status</TableCell>
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
                    <TableCell></TableCell>
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
    </div>
  );
}

function ManualOrderDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState("");
  const [address, setAddress] = useState("");
  const [fulfillmentType, setFulfillmentType] = useState<"delivery" | "collection">("delivery");
  const [isTuesday, setIsTuesday] = useState(false);
  const [itemLines, setItemLines] = useState([{ productName: "", quantity: 1 }]);

  const { data: products } = useQuery<any[]>({ queryKey: ["/api/products"] });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/orders", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: "Manual order created" });
      onOpenChange(false);
      setCustomerName("");
      setAddress("");
      setFulfillmentType("delivery");
      setIsTuesday(false);
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
