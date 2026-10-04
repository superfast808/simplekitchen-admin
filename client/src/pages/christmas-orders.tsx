import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  Gift,
  Truck,
  Store,
  ShoppingBag,
  PoundSterling,
  Search,
  PackageCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Order, OrderItem } from "@shared/schema";

type ChristmasOrderItem = OrderItem & {
  isChristmasItem?: boolean;
};

type ChristmasOrder = Order & {
  items: ChristmasOrderItem[];
  isChristmasOrder?: boolean;
};

function getOrderTotal(order: ChristmasOrder): number {
  const paidTotal = Number.parseFloat(order.wooPaidTotal || "");
  if (Number.isFinite(paidTotal)) return paidTotal;

  const itemTotal = order.items.reduce(
    (sum, item) => sum + (Number.parseFloat(item.price || "0") || 0),
    0,
  );
  const shipping = Number.parseFloat(order.shippingTotal || "0") || 0;
  return itemTotal + shipping;
}

function isActiveOrder(order: ChristmasOrder): boolean {
  return order.status !== "cancelled" && order.status !== "refunded";
}

function statusClasses(status: string): string {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300";
  }
  if (status === "processing") {
    return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-300";
  }
  if (status === "on-hold") {
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-300";
  }
  if (status === "cancelled" || status === "refunded") {
    return "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300";
  }
  return "";
}

export default function ChristmasOrdersPage() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: orders, isLoading, isFetching } = useQuery<ChristmasOrder[]>({
    queryKey: ["/api/orders", "?xmas=only"],
  });

  const sortedOrders = useMemo(
    () =>
      [...(orders || [])].sort(
        (a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime(),
      ),
    [orders],
  );

  const activeOrders = useMemo(
    () => sortedOrders.filter(isActiveOrder),
    [sortedOrders],
  );

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedOrders;

    return sortedOrders.filter(order =>
      order.customerName.toLowerCase().includes(q) ||
      (order.customerEmail || "").toLowerCase().includes(q) ||
      (order.deliveryAddress || "").toLowerCase().includes(q) ||
      String(order.wooId || "").includes(q) ||
      order.items.some(item => item.productName.toLowerCase().includes(q))
    );
  }, [sortedOrders, searchQuery]);

  const sideTotals = useMemo(() => {
    const totals = new Map<string, number>();

    for (const order of activeOrders) {
      for (const item of order.items) {
        if (!item.isChristmasItem) continue;
        totals.set(item.productName, (totals.get(item.productName) || 0) + item.quantity);
      }
    }

    return [...totals.entries()]
      .map(([productName, quantity]) => ({ productName, quantity }))
      .sort((a, b) => b.quantity - a.quantity || a.productName.localeCompare(b.productName));
  }, [activeOrders]);

  const totalSides = sideTotals.reduce((sum, item) => sum + item.quantity, 0);
  const deliveryCount = activeOrders.filter(order => order.fulfillmentType === "delivery").length;
  const collectionCount = activeOrders.filter(order => order.fulfillmentType !== "delivery").length;
  const revenue = activeOrders.reduce((sum, order) => sum + getOrderTotal(order), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-christmas-orders-title">
              Christmas Orders
            </h1>
            <Badge className="bg-emerald-700 text-white">Christmas Eve</Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Orders containing products from the dedicated Christmas menu at simplekitchenprep.com/christmas-orders
          </p>
        </div>

        <div className="relative w-full sm:w-[280px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Search customer, order or side..."
            className="pl-9"
            data-testid="input-search-christmas-orders"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <ShoppingBag className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Orders</span>
            </div>
            <p className="text-2xl font-bold tabular-nums" data-testid="stat-xmas-orders">
              {activeOrders.length}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Gift className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Sides</span>
            </div>
            <p className="text-2xl font-bold tabular-nums" data-testid="stat-xmas-sides">
              {totalSides}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Truck className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Delivery</span>
            </div>
            <p className="text-2xl font-bold tabular-nums" data-testid="stat-xmas-delivery">
              {deliveryCount}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <Store className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Collection</span>
            </div>
            <p className="text-2xl font-bold tabular-nums" data-testid="stat-xmas-collection">
              {collectionCount}
            </p>
          </CardContent>
        </Card>

        <Card className="col-span-2 lg:col-span-1">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-2">
              <PoundSterling className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Paid Value</span>
            </div>
            <p className="text-2xl font-bold tabular-nums" data-testid="stat-xmas-revenue">
              £{revenue.toFixed(2)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-1">
          <CardContent className="p-0">
            <div className="p-4 border-b">
              <h2 className="font-semibold flex items-center gap-2">
                <PackageCheck className="w-4 h-4" />
                Side Totals
              </h2>
              <p className="text-xs text-muted-foreground mt-1">
                Active Christmas orders only
              </p>
            </div>

            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : sideTotals.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No Christmas sides ordered yet.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right w-[80px]">Qty</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sideTotals.map(side => (
                    <TableRow key={side.productName}>
                      <TableCell className="text-sm font-medium">{side.productName}</TableCell>
                      <TableCell className="text-right font-bold tabular-nums">{side.quantity}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardContent className="p-0">
            <div className="p-4 border-b flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold">Christmas Customer Orders</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Kept separate from the normal weekly Orders screen
                </p>
              </div>
              {isFetching && (
                <Badge variant="outline" className="text-xs">Refreshing…</Badge>
              )}
            </div>

            {isLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : filteredOrders.length === 0 ? (
              <div className="p-10 text-center">
                <Gift className="w-10 h-10 mx-auto text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium text-muted-foreground">No matching Christmas orders</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[90px]">Order</TableHead>
                      <TableHead className="min-w-[115px]">Date</TableHead>
                      <TableHead className="min-w-[150px]">Customer</TableHead>
                      <TableHead className="min-w-[280px]">Christmas Sides</TableHead>
                      <TableHead className="min-w-[100px]">Fulfilment</TableHead>
                      <TableHead className="min-w-[180px]">Address</TableHead>
                      <TableHead className="text-right min-w-[90px]">Total</TableHead>
                      <TableHead className="min-w-[100px]">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredOrders.map(order => {
                      const christmasItems = order.items.filter(item => item.isChristmasItem);
                      return (
                        <TableRow key={order.id} className={!isActiveOrder(order) ? "opacity-60" : ""}>
                          <TableCell className="font-medium">
                            {order.wooId ? `#${order.wooId}` : `#${order.id}`}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {format(new Date(order.orderDate), "dd MMM yyyy")}
                            <div className="text-xs text-muted-foreground">
                              {format(new Date(order.orderDate), "HH:mm")}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="font-medium text-sm">{order.customerName}</div>
                            {order.customerEmail && (
                              <div className="text-xs text-muted-foreground">{order.customerEmail}</div>
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-0.5">
                              {christmasItems.map(item => (
                                <div key={item.id} className="text-sm">
                                  <span className="font-semibold">{item.quantity}×</span> {item.productName}
                                </div>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell>
                            {order.fulfillmentType === "delivery" ? (
                              <Badge className="bg-blue-600 text-white">
                                <Truck className="w-3 h-3 mr-1" /> Delivery
                              </Badge>
                            ) : (
                              <Badge variant="outline">
                                <Store className="w-3 h-3 mr-1" /> Collection
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {order.fulfillmentType === "delivery"
                              ? (order.deliveryAddress || "No address")
                              : "—"}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            £{getOrderTotal(order).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={statusClasses(order.status)}>
                              {order.status}
                            </Badge>
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
      </div>
    </div>
  );
}
