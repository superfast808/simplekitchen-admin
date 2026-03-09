import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChefHat } from "lucide-react";
import { DateFilter, DateRangeLabel, useDateFilter } from "@/components/date-filter";

type IngredientSummary = {
  name: string;
  totalQuantity: number;
  unit: string;
};

export default function IngredientsPage() {
  const dateFilter = useDateFilter();
  const { from, to } = dateFilter;

  const { data: summary, isLoading } = useQuery<IngredientSummary[]>({
    queryKey: ["/api/ingredient-summary", `?from=${from.toISOString()}&to=${to.toISOString()}`],
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-ingredients-title">Ingredient Summary</h1>
          <DateRangeLabel from={from} to={to} />
        </div>
        <DateFilter {...dateFilter} testIdPrefix="ing" />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !summary || summary.length === 0 ? (
            <div className="p-12 text-center">
              <ChefHat className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No ingredient data</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add ingredients to products and sync orders to see the summary
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead className="text-right">Quantity Needed</TableHead>
                  <TableHead>Unit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.map((item, idx) => (
                  <TableRow key={idx} data-testid={`row-ingredient-${idx}`}>
                    <TableCell className="font-medium" data-testid={`text-ingredient-name-${idx}`}>{item.name}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums" data-testid={`text-ingredient-qty-${idx}`}>
                      {item.totalQuantity % 1 === 0 ? item.totalQuantity : item.totalQuantity.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-muted-foreground" data-testid={`text-ingredient-unit-${idx}`}>{item.unit}</TableCell>
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
