import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addWeeks, subWeeks } from "date-fns";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";

type ProductTotal = {
  productName: string;
  productId: number | null;
  totalOrdered: number;
  manualQuantity: number;
};

export default function ProductTotalsPage() {
  const [dateMode, setDateMode] = useState<"week" | "month" | "custom">("week");
  const [weekOffset, setWeekOffset] = useState(0);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const now = new Date();
  let from: Date, to: Date;
  if (dateMode === "week") {
    from = startOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });
    to = endOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });
  } else if (dateMode === "month") {
    from = startOfMonth(now);
    to = endOfMonth(now);
  } else {
    from = customFrom ? new Date(customFrom) : startOfWeek(now, { weekStartsOn: 1 });
    to = customTo ? new Date(customTo) : endOfWeek(now, { weekStartsOn: 1 });
  }

  const { data: totals, isLoading } = useQuery<ProductTotal[]>({
    queryKey: ["/api/product-totals", `?from=${from.toISOString()}&to=${to.toISOString()}`],
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-totals-title">Product Totals</h1>
          <p className="text-sm text-muted-foreground">
            {format(from, "MMM d")} - {format(to, "MMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            <Button size="sm" variant={dateMode === "week" ? "default" : "outline"} onClick={() => { setDateMode("week"); setWeekOffset(0); }} data-testid="button-mode-week">
              Week
            </Button>
            <Button size="sm" variant={dateMode === "month" ? "default" : "outline"} onClick={() => setDateMode("month")} data-testid="button-mode-month">
              Month
            </Button>
            <Button size="sm" variant={dateMode === "custom" ? "default" : "outline"} onClick={() => setDateMode("custom")} data-testid="button-mode-custom">
              Custom
            </Button>
          </div>
          {dateMode === "week" && (
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w - 1)} data-testid="button-totals-prev">
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="outline" onClick={() => setWeekOffset(0)} data-testid="button-totals-this-week">This Week</Button>
              <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w + 1)} data-testid="button-totals-next">
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          )}
          {dateMode === "custom" && (
            <div className="flex gap-2">
              <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} data-testid="input-custom-from" />
              <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} data-testid="input-custom-to" />
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !totals || totals.length === 0 ? (
            <div className="p-12 text-center">
              <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No product data for this period</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Online Orders</TableHead>
                  <TableHead className="text-right">Manual / Shop</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {totals.map((t, idx) => (
                  <TableRow key={idx} data-testid={`row-total-${idx}`}>
                    <TableCell className="font-medium" data-testid={`text-total-product-${idx}`}>{t.productName}</TableCell>
                    <TableCell className="text-right" data-testid={`text-total-online-${idx}`}>{t.totalOrdered}</TableCell>
                    <TableCell className="text-right" data-testid={`text-total-manual-${idx}`}>{t.manualQuantity}</TableCell>
                    <TableCell className="text-right font-semibold" data-testid={`text-total-combined-${idx}`}>
                      {t.totalOrdered + t.manualQuantity}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
