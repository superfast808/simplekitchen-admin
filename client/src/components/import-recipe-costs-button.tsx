import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CloudDownload } from "lucide-react";

type ImportRecipeCostsResponse = {
  matchedRecipes: number;
  matchedProducts: number;
  importedIngredients: number;
  unmatchedRecipes: string[];
};

export function ImportRecipeCostsButton() {
  const { toast } = useToast();

  const importMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/recipe-costs/import");
      return response.json() as Promise<ImportRecipeCostsResponse>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-breakdown"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-names"] });

      const unmatched = data.unmatchedRecipes.length > 0
        ? ` Skipped below 99%: ${data.unmatchedRecipes.join(", ")}.`
        : "";
      toast({
        title: data.matchedProducts > 0 ? "Recipe costs imported" : "No high-confidence matches found",
        description: data.matchedProducts > 0
          ? `${data.matchedProducts} product${data.matchedProducts !== 1 ? "s" : ""} updated with ${data.importedIngredients} ingredient lines.${unmatched}`
          : `Only matches at 99% confidence or higher are imported.${unmatched}`,
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

  const handleImport = () => {
    if (!window.confirm("Pull recipe costs and replace ingredients for local products matched at 99% confidence or higher?")) {
      return;
    }
    importMutation.mutate();
  };

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleImport}
      disabled={importMutation.isPending}
      title="Import recipe ingredients and costs using 99%+ recipe-name matches"
      data-testid="button-import-recipe-costs"
    >
      <CloudDownload className={`w-4 h-4 mr-1 ${importMutation.isPending ? "animate-pulse" : ""}`} />
      {importMutation.isPending ? "Importing..." : "Import recipe costs"}
    </Button>
  );
}