import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Play, CalendarCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { RecurringOrder, RecurringOrderItem } from "@shared/schema";

type RecurringOrderWithItems = RecurringOrder & { items: RecurringOrderItem[] };

export default function TuesdayOrdersPage() {
  const { toast } = useToast();
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingOrder, setEditingOrder] = useState<RecurringOrderWithItems | null>(null);

  const { data: orders, isLoading } = useQuery<RecurringOrderWithItems[]>({
    queryKey: ["/api/recurring-orders"],
  });

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

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/recurring-orders/generate"),
    onSuccess: async (res) => {
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
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
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">Tuesday Orders</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recurring weekly orders — set them once, generate each week
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
                  {orders.map((order) => (
                    <TableRow key={order.id} className={!order.active ? "opacity-50" : ""} data-testid={`row-recurring-${order.id}`}>
                      <TableCell>
                        <Switch
                          checked={order.active}
                          onCheckedChange={(checked) => toggleMutation.mutate({ id: order.id, active: checked })}
                          data-testid={`switch-active-${order.id}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium" data-testid={`text-customer-${order.id}`}>
                        {order.customerName}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {order.items.map((item, i) => (
                            <Badge key={i} variant="secondary" className="text-xs" data-testid={`badge-item-${order.id}-${i}`}>
                              {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.productName}
                            </Badge>
                          ))}
                          {order.items.length === 0 && (
                            <span className="text-xs text-muted-foreground">No items</span>
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
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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
    </div>
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
      <DialogContent className="max-w-md">
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
