import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3 } from "lucide-react";
import { DateFilter, DateRangeLabel, useDateFilter } from "@/components/date-filter";
import { OrderSourceFilter, useOrderSourceFilter } from "@/components/order-source-filter";

type ProductTotal = {
  productName: string;
  productId: number | null;
  totalOrdered: number;
  manualQuantity: number;
};

export default function ProductTotalsPage() {
  const dateFilter = useDateFilter();
  const sourceFilter = useOrderSourceFilter();
  const { from, to } = dateFilter;

  const { data: totals, isLoading } = useQuery<ProductTotal[]>({
    queryKey: ["/api/product-totals", `?from=${from.toISOString()}&to=${to.toISOString()}&source=${sourceFilter.toQueryParam()}`],
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-totals-title">Product Totals</h1>
          <DateRangeLabel from={from} to={to} />
        </div>
        <DateFilter {...dateFilter} testIdPrefix="totals" showMonth />
      </div>

      <OrderSourceFilter filter={sourceFilter} testIdPrefix="totals-source" />

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
