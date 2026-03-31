import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChefHat, ChevronDown, ChevronRight, BookOpen, Pencil, Trash2, Check, X } from "lucide-react";
import { DateFilter, DateRangeLabel, useDateFilter } from "@/components/date-filter";
import { OrderSourceFilter, useOrderSourceFilter } from "@/components/order-source-filter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ProductBreakdown = {
  productId: number;
  productName: string;
  orderedQuantity: number;
  ingredients: Array<{
    name: string;
    quantityPerUnit: string;
    unit: string;
    totalNeeded: number;
    costPerG: string | null;
    costPerMeal: number | null;
    totalCost: number | null;
  }>;
};

type GrandTotal = {
  name: string;
  totalQuantity: number;
  unit: string;
  totalCost: number | null;
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

function formatPrecise(n: number): string {
  if (isNaN(n) || n === 0) return "0";
  // Convert to string without scientific notation, strip trailing zeros
  const s = n.toPrecision(10);
  return parseFloat(s).toString();
}

function ProductAccordion({
  product,
  packagingCost,
  showPackaging,
}: {
  product: ProductBreakdown;
  packagingCost: number;
  showPackaging: boolean;
}) {
  const [open, setOpen] = useState(product.orderedQuantity > 0);
  const hasOrders = product.orderedQuantity > 0;

  const hasIngredientCosts = product.ingredients.some(i => i.costPerMeal != null);
  const ingredientCostPerMeal = hasIngredientCosts
    ? product.ingredients.reduce((sum, i) => sum + (i.costPerMeal ?? 0), 0)
    : null;

  const displayCostPerMeal =
    ingredientCostPerMeal != null
      ? ingredientCostPerMeal + (showPackaging ? packagingCost : 0)
      : packagingCost > 0 && showPackaging
      ? packagingCost
      : null;

  const totalIngredientCost = hasIngredientCosts
    ? product.ingredients.reduce((sum, i) => sum + (i.totalCost ?? 0), 0)
    : null;

  const totalWithPackaging =
    totalIngredientCost != null
      ? totalIngredientCost + (showPackaging ? packagingCost * product.orderedQuantity : 0)
      : showPackaging && packagingCost > 0
      ? packagingCost * product.orderedQuantity
      : null;

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
        <div className="flex items-center gap-3 flex-shrink-0 ml-2">
          {displayCostPerMeal != null && (
            <span className="text-xs text-muted-foreground" data-testid={`text-cost-per-meal-${product.productId}`}>
              £{displayCostPerMeal.toFixed(2)}/meal{showPackaging && packagingCost > 0 ? " (incl. pkg)" : ""}
            </span>
          )}
          {totalWithPackaging != null && hasOrders && (
            <span className="text-xs text-muted-foreground tabular-nums" data-testid={`text-total-cost-${product.productId}`}>
              £{totalWithPackaging.toFixed(2)} total
            </span>
          )}
          <span className={`text-sm ${hasOrders ? "font-semibold" : "text-muted-foreground"}`}>
            {product.orderedQuantity} ordered
          </span>
        </div>
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
                <TableHead className="text-right w-[80px]">£/g</TableHead>
                <TableHead className="text-right w-[100px]">Cost/Meal</TableHead>
                <TableHead className="text-right w-[90px]">Total Cost</TableHead>
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
                  <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
                    {ing.costPerG != null ? formatPrecise(parseFloat(ing.costPerG)) : <span className="text-muted-foreground/30">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm">
                    {ing.costPerMeal != null ? `£${formatPrecise(ing.costPerMeal)}` : <span className="text-muted-foreground/30">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    {ing.totalCost != null ? `£${ing.totalCost.toFixed(2)}` : <span className="text-muted-foreground/30">—</span>}
                  </TableCell>
                </TableRow>
              ))}
              {showPackaging && packagingCost > 0 && (
                <TableRow className="text-muted-foreground italic">
                  <TableCell className="text-sm">Packaging</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right tabular-nums text-sm">£{packagingCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-medium">
                    £{(packagingCost * product.orderedQuantity).toFixed(2)}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
            {(ingredientCostPerMeal != null || (showPackaging && packagingCost > 0)) && (
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={6} className="text-right text-sm font-semibold">
                    Total cost per meal{showPackaging && packagingCost > 0 ? " (incl. packaging)" : ""}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-sm font-bold">
                    £{(displayCostPerMeal ?? 0).toFixed(4)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}
    </div>
  );
}

type StandardIngredient = { id: number; name: string; costPerG: string; unit: string };

function StandardIngredientsPanel() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editCostPerG, setEditCostPerG] = useState("");
  const [editUnit, setEditUnit] = useState("");

  const { data: standards, isLoading } = useQuery<StandardIngredient[]>({
    queryKey: ["/api/standard-ingredients"],
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, costPerG, unit }: { id: number; costPerG: string; unit: string }) =>
      apiRequest("PUT", `/api/standard-ingredients/${id}`, { costPerG, unit }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/standard-ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-names"] });
      setEditingId(null);
      toast({ title: "Updated" });
    },
    onError: (e: Error) => toast({ title: "Failed to update", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/standard-ingredients/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/standard-ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-names"] });
      toast({ title: "Removed from library" });
    },
    onError: (e: Error) => toast({ title: "Failed to delete", description: e.message, variant: "destructive" }),
  });

  const startEdit = (s: StandardIngredient) => {
    setEditingId(s.id);
    setEditCostPerG(s.costPerG);
    setEditUnit(s.unit);
  };

  const saveEdit = () => {
    if (editingId == null) return;
    updateMutation.mutate({ id: editingId, costPerG: editCostPerG, unit: editUnit });
  };

  return (
    <Card data-testid="card-standard-ingredients">
      <button
        className="w-full flex items-center gap-2 px-6 py-4 text-left hover:bg-muted/40 transition-colors"
        onClick={() => setOpen(v => !v)}
        data-testid="button-toggle-standard-ingredients"
      >
        <BookOpen className="w-4 h-4 text-muted-foreground" />
        <span className="font-semibold">Standard Ingredients Library</span>
        <span className="ml-2 text-sm text-muted-foreground">{standards ? `${standards.length} ingredients` : ""}</span>
        <span className="ml-auto">{open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
      </button>
      {open && (
        <CardContent className="pt-0 pb-4">
          {isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !standards || standards.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No standard ingredients yet. Save product ingredients with a £/g cost to populate this library automatically.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ingredient</TableHead>
                  <TableHead className="text-right">£/g</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {standards.map(s => (
                  <TableRow key={s.id} data-testid={`row-standard-ingredient-${s.id}`}>
                    <TableCell className="font-medium" data-testid={`text-std-name-${s.id}`}>{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {editingId === s.id ? (
                        <Input
                          type="number"
                          value={editCostPerG}
                          onChange={e => setEditCostPerG(e.target.value)}
                          step="0.000001"
                          min="0"
                          className="w-28 text-right ml-auto"
                          data-testid={`input-std-costperg-${s.id}`}
                        />
                      ) : (
                        <span data-testid={`text-std-costperg-${s.id}`}>{parseFloat(s.costPerG).toPrecision(6).replace(/\.?0+$/, "")}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === s.id ? (
                        <Input
                          value={editUnit}
                          onChange={e => setEditUnit(e.target.value)}
                          className="w-16"
                          data-testid={`input-std-unit-${s.id}`}
                        />
                      ) : (
                        <span className="text-muted-foreground text-sm" data-testid={`text-std-unit-${s.id}`}>{s.unit}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        {editingId === s.id ? (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={saveEdit} disabled={updateMutation.isPending} data-testid={`button-std-save-${s.id}`}>
                              <Check className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)} data-testid={`button-std-cancel-${s.id}`}>
                              <X className="w-3 h-3" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(s)} data-testid={`button-std-edit-${s.id}`}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => deleteMutation.mutate(s.id)} disabled={deleteMutation.isPending} data-testid={`button-std-delete-${s.id}`}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function IngredientsPage() {
  const dateFilter = useDateFilter();
  const sourceFilter = useOrderSourceFilter();
  const { from, to } = dateFilter;
  const [showZeroIngredients, setShowZeroIngredients] = useState(false);
  const [showPackaging, setShowPackaging] = useState(false);

  const { data, isLoading } = useQuery<BreakdownResponse>({
    queryKey: ["/api/ingredient-breakdown", `?from=${from.toISOString()}&to=${to.toISOString()}&source=${sourceFilter.toQueryParam()}`],
  });

  const { data: settings } = useQuery<Record<string, string>>({
    queryKey: ["/api/settings"],
  });

  const packagingCost = parseFloat(settings?.packaging_cost || "0") || 0;

  const activeProducts = data?.products.filter(p => p.orderedQuantity > 0) ?? [];
  const hiddenCount = (data?.products.length ?? 0) - activeProducts.length;
  const hasData = activeProducts.length > 0 || (data?.grandTotals.length ?? 0) > 0;

  const totalMealsOrdered = activeProducts.reduce((sum, p) => sum + p.orderedQuantity, 0);

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
            <p className="text-muted-foreground font-medium">No orders this week</p>
            <p className="text-sm text-muted-foreground mt-1">
              Products with orders will appear here. Use the arrows above to view previous weeks.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-lg font-semibold">By Product</h2>
              <div className="flex items-center gap-4">
                {packagingCost > 0 && (
                  <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-muted-foreground shrink-0" data-testid="toggle-show-packaging">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={showPackaging}
                      onChange={e => setShowPackaging(e.target.checked)}
                      data-testid="checkbox-show-packaging"
                    />
                    Include packaging (£{packagingCost.toFixed(2)}/meal)
                  </label>
                )}
                {hiddenCount > 0 && (
                  <span className="text-xs text-muted-foreground" data-testid="text-hidden-products">
                    {hiddenCount} product{hiddenCount > 1 ? "s" : ""} with no orders this week hidden
                  </span>
                )}
              </div>
            </div>
            {activeProducts.map(product => (
              <ProductAccordion
                key={product.productId}
                product={product}
                packagingCost={packagingCost}
                showPackaging={showPackaging}
              />
            ))}
          </div>

          {data.grandTotals.length > 0 && (
            <Card>
              <CardContent className="p-0">
                <div className="p-4 border-b flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <h2 className="text-lg font-semibold" data-testid="text-grand-totals-heading">Grand Totals</h2>
                    <p className="text-sm text-muted-foreground">Combined ingredient totals across all products</p>
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-muted-foreground shrink-0" data-testid="toggle-show-zeros">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={showZeroIngredients}
                      onChange={e => setShowZeroIngredients(e.target.checked)}
                      data-testid="checkbox-show-zeros"
                    />
                    Show zero items
                  </label>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ingredient</TableHead>
                      <TableHead className="text-right">Total Quantity</TableHead>
                      <TableHead>Unit</TableHead>
                      <TableHead className="text-right w-[100px]">Total Cost</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.grandTotals
                      .filter(item => showZeroIngredients || item.totalQuantity > 0)
                      .map((item, idx) => (
                        <TableRow key={idx} data-testid={`row-grand-total-${idx}`}>
                          <TableCell className="font-medium" data-testid={`text-grand-ingredient-${idx}`}>{item.name}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums" data-testid={`text-grand-qty-${idx}`}>
                            {formatQty(item.totalQuantity)}
                          </TableCell>
                          <TableCell className="text-muted-foreground" data-testid={`text-grand-unit-${idx}`}>{item.unit}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium" data-testid={`text-grand-cost-${idx}`}>
                            {item.totalCost != null ? `£${item.totalCost.toFixed(2)}` : <span className="text-muted-foreground/30">—</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    {showPackaging && packagingCost > 0 && totalMealsOrdered > 0 && (
                      <TableRow className="text-muted-foreground italic" data-testid="row-grand-packaging">
                        <TableCell className="font-medium" data-testid="text-grand-packaging">Packaging</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{totalMealsOrdered}</TableCell>
                        <TableCell className="text-muted-foreground">meals</TableCell>
                        <TableCell className="text-right tabular-nums font-medium" data-testid="text-grand-packaging-cost">
                          £{(packagingCost * totalMealsOrdered).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                  {(() => {
                    const visibleItems = data.grandTotals.filter(item => showZeroIngredients || item.totalQuantity > 0);
                    const ingredientTotal = visibleItems.reduce((sum, item) => item.totalCost != null ? sum + item.totalCost : sum, 0);
                    const packagingTotal = showPackaging && packagingCost > 0 ? packagingCost * totalMealsOrdered : 0;
                    const grandTotal = ingredientTotal + packagingTotal;
                    const anyCosted = visibleItems.some(item => item.totalCost != null) || (showPackaging && packagingCost > 0);
                    if (!anyCosted) return null;
                    return (
                      <TableFooter>
                        <TableRow className="font-bold" data-testid="row-grand-cost-total">
                          <TableCell colSpan={3}>
                            Total {showPackaging && packagingCost > 0 ? "Ingredient + Packaging" : "Ingredient"} Cost
                          </TableCell>
                          <TableCell className="text-right tabular-nums" data-testid="text-grand-cost-total">
                            £{grandTotal.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    );
                  })()}
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <StandardIngredientsPanel />
    </div>
  );
}
