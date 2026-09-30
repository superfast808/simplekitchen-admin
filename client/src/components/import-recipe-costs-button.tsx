import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CloudDownload, AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

type PreviewProduct = {
  id: number;
  name: string;
};

type PreviewRecipe = {
  recipeIndex: number;
  recipeName: string;
  ingredientCount: number;
  valid: boolean;
  suggestedProductId: number | null;
  suggestedProductName: string | null;
  suggestedConfidence: number;
  focusProductId: number | null;
  focusProductName: string | null;
  focusConfidence: number;
  candidates: Array<{
    productId: number;
    productName: string;
    confidence: number;
  }>;
};

type RecipeCostPreviewResponse = {
  threshold: number;
  products: PreviewProduct[];
  recipes: PreviewRecipe[];
};

type ImportRecipeCostsResponse = {
  matchedRecipes: number;
  matchedProducts: number;
  importedIngredients: number;
  unmatchedRecipes: string[];
  results: Array<{
    recipeName: string;
    productId: number | null;
    productName: string | null;
    confidence: number;
    ingredientLines: number;
    status: "imported" | "skipped";
    reason?: string;
  }>;
};

type ImportRecipeCostsButtonProps = {
  preferredProducts?: PreviewProduct[];
  preferredLabel?: string;
};

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function ImportRecipeCostsButton({
  preferredProducts = [],
  preferredLabel = "selected week",
}: ImportRecipeCostsButtonProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<RecipeCostPreviewResponse | null>(null);
  const [selections, setSelections] = useState<Record<number, string>>({});
  const [lastResult, setLastResult] = useState<ImportRecipeCostsResponse | null>(null);
  const [showAllRecipes, setShowAllRecipes] = useState(preferredProducts.length === 0);

  const preferredIdSet = useMemo(
    () => new Set(preferredProducts.map(product => product.id)),
    [preferredProducts],
  );

  const previewMutation = useMutation({
    mutationFn: async () => {
      const productIds = preferredProducts.map(product => product.id);
      const query = productIds.length > 0
        ? `?productIds=${encodeURIComponent(productIds.join(","))}`
        : "";
      const response = await apiRequest("GET", `/api/recipe-costs/preview${query}`);
      return response.json() as Promise<RecipeCostPreviewResponse>;
    },
    onSuccess: (data) => {
      setPreview(data);
      setLastResult(null);

      // Only auto-select high-confidence matches returned by the preview API.
      // When a selected-week focus is supplied, the API deliberately limits
      // these automatic selections to products from that week.
      const defaults: Record<number, string> = {};
      for (const recipe of data.recipes) {
        if (recipe.suggestedProductId != null) {
          defaults[recipe.recipeIndex] = String(recipe.suggestedProductId);
        }
      }
      setSelections(defaults);
    },
    onError: (error: Error) => {
      toast({
        title: "Could not load recipe matches",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const matches = Object.entries(selections)
        .filter(([, productId]) => productId !== "")
        .map(([recipeIndex, productId]) => ({
          recipeIndex: Number(recipeIndex),
          productId: Number(productId),
        }));

      const response = await apiRequest("POST", "/api/recipe-costs/import", { matches });
      return response.json() as Promise<ImportRecipeCostsResponse>;
    },
    onSuccess: (data) => {
      setLastResult(data);
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-breakdown"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-names"] });
      queryClient.invalidateQueries({ queryKey: ["/api/standard-ingredients"] });

      toast({
        title: "Recipe cost import complete",
        description: `${data.matchedProducts} product${data.matchedProducts !== 1 ? "s" : ""} updated with ${data.importedIngredients} ingredient lines. ${data.unmatchedRecipes.length} skipped.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Recipe cost import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const selectedCount = useMemo(
    () => Object.values(selections).filter(Boolean).length,
    [selections],
  );

  const focusedRecipes = useMemo(() => {
    if (!preview || preferredProducts.length === 0) {
      return preview?.recipes ?? [];
    }

    const ranked = preview.recipes
      .filter(recipe => recipe.valid && recipe.focusProductId != null)
      .sort((a, b) => b.focusConfidence - a.focusConfidence);

    const focusLimit = Math.min(
      20,
      Math.max(preferredProducts.length + 4, 8),
    );

    const reasonablyClose = ranked.filter(recipe => recipe.focusConfidence >= 0.45);
    if (reasonablyClose.length >= preferredProducts.length) {
      return reasonablyClose.slice(0, focusLimit);
    }

    return ranked.slice(0, Math.max(preferredProducts.length, focusLimit));
  }, [preview, preferredProducts]);

  const visibleRecipes = useMemo(() => {
    if (!preview) return [];
    if (preferredProducts.length > 0 && !showAllRecipes) return focusedRecipes;
    return preview.recipes;
  }, [preview, preferredProducts.length, showAllRecipes, focusedRecipes]);

  const preferredOptions = useMemo(
    () => preview?.products.filter(product => preferredIdSet.has(product.id)) ?? [],
    [preview, preferredIdSet],
  );

  const otherOptions = useMemo(
    () => preview?.products.filter(product => !preferredIdSet.has(product.id)) ?? [],
    [preview, preferredIdSet],
  );

  const needsReviewCount = useMemo(
    () => visibleRecipes.filter(recipe =>
      recipe.valid && recipe.suggestedProductId == null
    ).length,
    [visibleRecipes],
  );

  const handleReview = () => {
    setOpen(true);
    setPreview(null);
    setLastResult(null);
    setSelections({});
    setShowAllRecipes(preferredProducts.length === 0);
    previewMutation.mutate();
  };

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={handleReview}
        disabled={previewMutation.isPending}
        title="Review recipe-to-product matches before importing ingredient costs"
        data-testid="button-import-recipe-costs"
      >
        <CloudDownload className={`w-4 h-4 mr-1 ${previewMutation.isPending ? "animate-pulse" : ""}`} />
        {previewMutation.isPending ? "Checking recipes..." : "Import recipe costs"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Review recipe cost matches</DialogTitle>
          </DialogHeader>

          {previewMutation.isPending && (
            <div className="py-12 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              Pulling recipes and comparing them with local products...
            </div>
          )}

          {preview && (
            <>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-2">
                <div className="font-medium">
                  {preferredProducts.length > 0 && !showAllRecipes
                    ? `Focused on ${preferredProducts.length} products showing in the ${preferredLabel} · ${visibleRecipes.length} likely source recipes`
                    : `${preview.recipes.length} source recipes checked`}
                  {" · "}{selectedCount} selected for import
                </div>

                <div className="text-muted-foreground">
                  Exact/high-confidence matches at {percent(preview.threshold)} or above are selected automatically.
                  {needsReviewCount > 0
                    ? ` ${needsReviewCount} visible recipe${needsReviewCount !== 1 ? "s" : ""} need manual review.`
                    : " All visible valid recipes have a high-confidence match."}
                </div>

                {preferredProducts.length > 0 && (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="text-muted-foreground">
                      Current-week products are prioritised in matching and in each product selector.
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowAllRecipes(value => !value)}
                    >
                      {showAllRecipes
                        ? `Focus on ${preferredLabel}`
                        : `Show all ${preview.recipes.length} recipes`}
                    </Button>
                  </div>
                )}

                <div className="text-muted-foreground">
                  You can override any suggestion below. Choosing a product manually bypasses the confidence threshold for that recipe.
                </div>
              </div>

              <div className="overflow-y-auto flex-1 pr-1 space-y-2 min-h-0">
                {visibleRecipes.map(recipe => {
                  const selected = selections[recipe.recipeIndex] ?? "";
                  const autoMatched = recipe.suggestedProductId != null;
                  const focused = preferredProducts.length > 0 && !showAllRecipes;
                  const bestMatchName = focused
                    ? recipe.focusProductName
                    : recipe.candidates[0]?.productName ?? null;
                  const bestMatchConfidence = focused
                    ? recipe.focusConfidence
                    : recipe.candidates[0]?.confidence ?? 0;

                  return (
                    <div
                      key={recipe.recipeIndex}
                      className="rounded-lg border p-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium truncate">{recipe.recipeName}</span>
                          {!recipe.valid ? (
                            <span className="inline-flex items-center gap-1 text-xs text-destructive">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              No usable ingredients
                            </span>
                          ) : autoMatched ? (
                            <span className="inline-flex items-center gap-1 text-xs text-green-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Auto match {percent(recipe.suggestedConfidence)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Review needed
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-muted-foreground mt-1">
                          {recipe.ingredientCount} ingredient line{recipe.ingredientCount !== 1 ? "s" : ""}
                          {bestMatchName
                            ? ` · Best ${focused ? preferredLabel : "name"} match: “${bestMatchName}” (${percent(bestMatchConfidence)})`
                            : " · No local product candidates"}
                        </div>

                        {!focused && recipe.candidates.length > 1 && (
                          <div className="text-xs text-muted-foreground mt-1 truncate">
                            Next: {recipe.candidates.slice(1, 4).map(candidate =>
                              `${candidate.productName} ${percent(candidate.confidence)}`
                            ).join(" · ")}
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                          Match to local product
                        </label>
                        <select
                          value={selected}
                          disabled={!recipe.valid || importMutation.isPending}
                          onChange={(event) => {
                            const value = event.target.value;
                            setSelections(current => ({
                              ...current,
                              [recipe.recipeIndex]: value,
                            }));
                            setLastResult(null);
                          }}
                          className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                          data-testid={`select-recipe-match-${recipe.recipeIndex}`}
                        >
                          <option value="">Skip this recipe</option>
                          {preferredOptions.length > 0 && (
                            <optgroup label={`Products in ${preferredLabel}`}>
                              {preferredOptions.map(product => (
                                <option key={product.id} value={product.id}>
                                  {product.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                          {otherOptions.length > 0 && (
                            <optgroup label={preferredOptions.length > 0 ? "Other products" : "Products"}>
                              {otherOptions.map(product => (
                                <option key={product.id} value={product.id}>
                                  {product.name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      </div>
                    </div>
                  );
                })}

                {visibleRecipes.length === 0 && (
                  <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
                    No likely recipe matches were found for the products in this week. Use “Show all recipes” to match them manually.
                  </div>
                )}
              </div>

              {lastResult && (
                <div className="rounded-lg border p-3 max-h-48 overflow-y-auto">
                  <div className="font-medium text-sm mb-2">
                    Import result: {lastResult.matchedProducts} products updated · {lastResult.importedIngredients} ingredient lines imported
                  </div>
                  <div className="space-y-1 text-xs">
                    {lastResult.results.map((result, index) => (
                      <div
                        key={`${result.recipeName}-${index}`}
                        className={result.status === "imported" ? "text-green-700" : "text-muted-foreground"}
                      >
                        {result.status === "imported" ? "Imported" : "Skipped"}: {result.recipeName}
                        {result.productName ? ` → ${result.productName}` : ""}
                        {result.status === "imported"
                          ? ` · ${result.ingredientLines} lines · name confidence ${percent(result.confidence)}`
                          : result.reason ? ` · ${result.reason}` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between gap-3 pt-2 border-t">
                <div className="text-xs text-muted-foreground">
                  Import replaces the existing ingredient lines for each selected local product.
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button variant="outline" onClick={() => setOpen(false)}>
                    Close
                  </Button>
                  <Button
                    onClick={() => importMutation.mutate()}
                    disabled={selectedCount === 0 || importMutation.isPending}
                  >
                    {importMutation.isPending && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
                    {importMutation.isPending
                      ? "Importing..."
                      : `Import ${selectedCount} selected`}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
