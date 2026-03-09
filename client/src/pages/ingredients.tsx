import { useQuery } from "@tanstack/react-query";
import { format, startOfWeek, endOfWeek, addWeeks } from "date-fns";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChefHat, ChevronLeft, ChevronRight } from "lucide-react";

type IngredientSummary = {
  name: string;
  totalQuantity: number;
  unit: string;
};

export default function IngredientsPage() {
  const [weekOffset, setWeekOffset] = useState(0);

  const now = new Date();
  const from = startOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });
  const to = endOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });

  const { data: summary, isLoading } = useQuery<IngredientSummary[]>({
    queryKey: ["/api/ingredient-summary", `?from=${from.toISOString()}&to=${to.toISOString()}`],
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-ingredients-title">Ingredient Summary</h1>
          <p className="text-sm text-muted-foreground">
            Total quantities needed for {format(from, "MMM d")} - {format(to, "MMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w - 1)} data-testid="button-ing-prev">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setWeekOffset(0)} data-testid="button-ing-this-week">This Week</Button>
          <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w + 1)} data-testid="button-ing-next">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
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
