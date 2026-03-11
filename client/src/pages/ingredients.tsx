import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChefHat, ChevronDown, ChevronRight } from "lucide-react";
import { DateFilter, DateRangeLabel, useDateFilter } from "@/components/date-filter";
import { OrderSourceFilter, useOrderSourceFilter } from "@/components/order-source-filter";

type ProductBreakdown = {
  productId: number;
  productName: string;
  orderedQuantity: number;
  ingredients: Array<{
    name: string;
    quantityPerUnit: string;
    unit: string;
    totalNeeded: number;
  }>;
};

type GrandTotal = {
  name: string;
  totalQuantity: number;
  unit: string;
};

type BreakdownResponse = {
  products: ProductBreakdown[];
  grandTotals: GrandTotal[];
};

function formatQty(n: number | string): string {
  const v = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(v)) return "0";
  if (v === 0) return "0";
  if (v % 1 === 0) return String(v);
  const s = v.toFixed(2);
  return s.replace(/\.?0+$/, "");
}

function ProductAccordion({ product }: { product: ProductBreakdown }) {
  const [open, setOpen] = useState(product.orderedQuantity > 0);
  const hasOrders = product.orderedQuantity > 0;

  return (
    <div className={`border rounded-lg ${hasOrders ? "" : "opacity-60"}`} data-testid={`accordion-product-${product.productId}`}>
      <button
        type="button"
        className="w-full flex items-center justify-between p-3 text-left"
        onClick={() => setOpen(!open)}
        data-testid={`button-toggle-product-${product.productId}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
          <span className="font-medium text-sm truncate">{product.productName}</span>
        </div>
        <span className={`text-sm flex-shrink-0 ml-2 ${hasOrders ? "font-semibold" : "text-muted-foreground"}`}>
          {product.orderedQuantity} ordered
        </span>
      </button>
      {open && (
        <div className="border-t">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ingredient</TableHead>
                <TableHead className="text-right w-[100px]">Per Unit</TableHead>
                <TableHead className="text-right w-[100px]">Orders</TableHead>
                <TableHead className="text-right w-[120px]">Total Needed</TableHead>
                <TableHead className="w-[60px]">Unit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {product.ingredients.map((ing, idx) => (
                <TableRow key={idx}>
                  <TableCell className="font-medium text-sm">{ing.name}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{formatQty(ing.quantityPerUnit)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm">{product.orderedQuantity}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold text-sm">{formatQty(ing.totalNeeded)}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{ing.unit}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function IngredientsPage() {
  const dateFilter = useDateFilter();
  const sourceFilter = useOrderSourceFilter();
  const { from, to } = dateFilter;

  const { data, isLoading } = useQuery<BreakdownResponse>({
    queryKey: ["/api/ingredient-breakdown", `?from=${from.toISOString()}&to=${to.toISOString()}&source=${sourceFilter.toQueryParam()}`],
  });

  const hasData = data && (data.products.length > 0 || data.grandTotals.length > 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-ingredients-title">Ingredient Summary</h1>
          <DateRangeLabel from={from} to={to} />
        </div>
        <DateFilter {...dateFilter} testIdPrefix="ing" />
      </div>

      <OrderSourceFilter filter={sourceFilter} testIdPrefix="ing-source" />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
        </div>
      ) : !hasData ? (
        <Card>
          <CardContent className="p-12 text-center">
            <ChefHat className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium">No ingredient data</p>
            <p className="text-sm text-muted-foreground mt-1">
              Add ingredients to products and sync orders to see the breakdown
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            <h2 className="text-lg font-semibold">By Product</h2>
            {data.products.map(product => (
              <ProductAccordion key={product.productId} product={product} />
            ))}
          </div>

          {data.grandTotals.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="p-4 border-b">
                  <h2 className="text-lg font-semibold" data-testid="text-grand-totals-heading">Grand Totals</h2>
                  <p className="text-sm text-muted-foreground">Combined ingredient totals across all products</p>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead className="text-right">Total Quantity</TableHead>
                      <TableHead>Unit</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.grandTotals.map((item, idx) => (
                      <TableRow key={idx} data-testid={`row-grand-total-${idx}`}>
                        <TableCell className="font-medium" data-testid={`text-grand-ingredient-${idx}`}>{item.name}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums" data-testid={`text-grand-qty-${idx}`}>
                          {formatQty(item.totalQuantity)}
                        </TableCell>
                        <TableCell className="text-muted-foreground" data-testid={`text-grand-unit-${idx}`}>{item.unit}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
