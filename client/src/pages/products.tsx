import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { RefreshCw, Package, ChevronRight, X, Plus, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Product, Ingredient } from "@shared/schema";

function AutocompleteInput({
  value,
  onChange,
  suggestions,
  placeholder,
  className,
  "data-testid": testId,
}: {
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder: string;
  className?: string;
  "data-testid"?: string;
}) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const filtered = value.trim()
    ? suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s.toLowerCase() !== value.toLowerCase())
    : [];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || filtered.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter" && focusedIdx >= 0) {
      e.preventDefault();
      onChange(filtered[focusedIdx]);
      setShowDropdown(false);
      setFocusedIdx(-1);
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  return (
    <div ref={wrapperRef} className={`relative ${className || ""}`}>
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setShowDropdown(true);
          setFocusedIdx(-1);
        }}
        onFocus={() => setShowDropdown(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        data-testid={testId}
      />
      {showDropdown && filtered.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-md max-h-40 overflow-y-auto">
          {filtered.map((item, i) => (
            <button
              key={item}
              type="button"
              className={`w-full text-left px-3 py-1.5 text-sm ${i === focusedIdx ? "bg-accent" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(item);
                setShowDropdown(false);
              }}
              data-testid={`option-autocomplete-${i}`}
            >
              {item}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const { toast } = useToast();
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const { data: products, isLoading } = useQuery<Product[]>({
    queryKey: ["/api/products"],
  });

  const syncMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/woo/sync-products"),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Products synced", description: `Imported: ${data.imported}, Updated: ${data.updated}` });
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
    },
    onError: (error: Error) => {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-products-title">Products</h1>
          <p className="text-sm text-muted-foreground">
            Manage products and their ingredients
          </p>
        </div>
        <Button size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending} data-testid="button-sync-products">
          <RefreshCw className={`w-4 h-4 mr-1 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          Sync from Woo
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-32 w-full rounded-md" />
          ))}
        </div>
      ) : !products || products.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <Package className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
            <p className="text-muted-foreground font-medium">No products yet</p>
            <p className="text-sm text-muted-foreground mt-1">Sync your products from WooCommerce to get started</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {products.map((product) => (
            <Card
              key={product.id}
              className="cursor-pointer transition-colors hover-elevate"
              onClick={() => setSelectedProduct(product)}
              data-testid={`card-product-${product.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  {product.imageUrl ? (
                    <img
                      src={product.imageUrl}
                      alt={product.name}
                      className="w-14 h-14 rounded-md object-cover flex-shrink-0"
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                      <Package className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm truncate" data-testid={`text-product-name-${product.id}`}>{product.name}</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {product.price ? `£${parseFloat(product.price).toFixed(2)}` : "No price"}
                      {product.category ? <span className="ml-2 text-xs text-muted-foreground">· {product.category}</span> : null}
                    </p>
                    {product.wooId && (
                      <Badge variant="outline" className="mt-1.5 text-xs">WC #{product.wooId}</Badge>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedProduct && (
        <IngredientsDialog
          product={selectedProduct}
          open={!!selectedProduct}
          onOpenChange={(open) => !open && setSelectedProduct(null)}
        />
      )}
    </div>
  );
}

function IngredientsDialog({ product, open, onOpenChange }: { product: Product; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();

  const { data: existingIngredients, isLoading } = useQuery<Ingredient[]>({
    queryKey: ["/api/products", product.id, "ingredients"],
    enabled: open,
  });

  const { data: knownIngredients } = useQuery<{ names: string[]; units: string[] }>({
    queryKey: ["/api/ingredient-names"],
    enabled: open,
  });

  const [ingredientLines, setIngredientLines] = useState<Array<{ name: string; quantityPerUnit: string; unit: string; costPerG: string }>>([]);
  const [initialized, setInitialized] = useState(false);

  if (existingIngredients && !initialized) {
    if (existingIngredients.length > 0) {
      setIngredientLines(existingIngredients.map(i => ({
        name: i.name,
        quantityPerUnit: i.quantityPerUnit,
        unit: i.unit,
        costPerG: (i as any).costPerG != null ? String((i as any).costPerG) : "",
      })));
    } else {
      setIngredientLines([{ name: "", quantityPerUnit: "", unit: "g", costPerG: "" }]);
    }
    setInitialized(true);
  }

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", `/api/products/${product.id}/ingredients`, data),
    onSuccess: () => {
      toast({ title: "Ingredients saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/products", product.id, "ingredients"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-breakdown"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-names"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    },
  });

  const handleSave = () => {
    const valid = ingredientLines.filter(i => i.name.trim() && i.quantityPerUnit);
    saveMutation.mutate({ ingredients: valid });
  };

  const addLine = () => setIngredientLines([...ingredientLines, { name: "", quantityPerUnit: "", unit: "g", costPerG: "" }]);

  const removeLine = (idx: number) => {
    const newLines = ingredientLines.filter((_, i) => i !== idx);
    setIngredientLines(newLines.length > 0 ? newLines : [{ name: "", quantityPerUnit: "", unit: "g", costPerG: "" }]);
  };

  const updateLine = (idx: number, field: string, value: string) => {
    const newLines = [...ingredientLines];
    (newLines[idx] as any)[field] = value;
    setIngredientLines(newLines);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); setInitialized(false); }}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {product.imageUrl && (
              <img src={product.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
            )}
            {product.name} - Ingredients
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Enter each ingredient with the quantity needed per unit of this product.
              Start typing to see suggestions from existing ingredients.
            </p>
            {ingredientLines.map((line, idx) => (
              <div key={idx} className="flex gap-2 items-center flex-wrap">
                <AutocompleteInput
                  value={line.name}
                  onChange={(v) => updateLine(idx, "name", v)}
                  suggestions={knownIngredients?.names || []}
                  placeholder="Ingredient name"
                  className="flex-1 min-w-[140px]"
                  data-testid={`input-ingredient-name-${idx}`}
                />
                <Input
                  type="number"
                  value={line.quantityPerUnit}
                  onChange={(e) => updateLine(idx, "quantityPerUnit", e.target.value)}
                  placeholder="Qty"
                  className="w-20"
                  step="0.001"
                  data-testid={`input-ingredient-qty-${idx}`}
                />
                <AutocompleteInput
                  value={line.unit}
                  onChange={(v) => updateLine(idx, "unit", v)}
                  suggestions={knownIngredients?.units || []}
                  placeholder="Unit"
                  className="w-20"
                  data-testid={`input-ingredient-unit-${idx}`}
                />
                <div className="relative w-24">
                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground pointer-events-none">£/g</span>
                  <Input
                    type="number"
                    value={line.costPerG}
                    onChange={(e) => updateLine(idx, "costPerG", e.target.value)}
                    placeholder="0.000"
                    className="pl-7 w-full"
                    step="0.000001"
                    min="0"
                    data-testid={`input-ingredient-cost-${idx}`}
                  />
                </div>
                <Button size="icon" variant="ghost" onClick={() => removeLine(idx)} data-testid={`button-remove-ingredient-${idx}`}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={addLine} data-testid="button-add-ingredient">
                <Plus className="w-3 h-3 mr-1" />
                Add Ingredient
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saveMutation.isPending} data-testid="button-save-ingredients">
                <Save className="w-3 h-3 mr-1" />
                {saveMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
