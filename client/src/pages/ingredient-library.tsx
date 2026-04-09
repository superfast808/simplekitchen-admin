import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BookOpen, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type StandardIngredient = { id: number; name: string; costPerG: string; unit: string };

export default function IngredientLibraryPage() {
  const { toast } = useToast();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValues, setEditValues] = useState<{ name: string; costPerG: string; unit: string }>({ name: "", costPerG: "", unit: "" });
  const [showAddRow, setShowAddRow] = useState(false);
  const [newRow, setNewRow] = useState<{ name: string; costPerG: string; unit: string }>({ name: "", costPerG: "", unit: "g" });

  const { data: standards, isLoading } = useQuery<StandardIngredient[]>({
    queryKey: ["/api/standard-ingredients"],
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/standard-ingredients"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ingredient-names"] });
  };

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name: string; costPerG: string; unit: string }) =>
      apiRequest("PUT", `/api/standard-ingredients/${id}`, data),
    onSuccess: () => { invalidate(); setEditingId(null); toast({ title: "Saved" }); },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/standard-ingredients/${id}`),
    onSuccess: () => { invalidate(); toast({ title: "Removed from library" }); },
    onError: (e: Error) => toast({ title: "Delete failed", description: e.message, variant: "destructive" }),
  });

  const addMutation = useMutation({
    mutationFn: (data: { name: string; costPerG: string; unit: string }) =>
      apiRequest("POST", "/api/standard-ingredients", data),
    onSuccess: () => {
      invalidate();
      setNewRow({ name: "", costPerG: "", unit: "g" });
      setShowAddRow(false);
      toast({ title: "Added to library" });
    },
    onError: (e: Error) => toast({ title: "Add failed", description: e.message, variant: "destructive" }),
  });

  const startEdit = (s: StandardIngredient) => {
    setEditingId(s.id);
    setEditValues({ name: s.name, costPerG: s.costPerG ?? "", unit: s.unit });
  };

  const saveEdit = () => {
    if (!editingId) return;
    if (!editValues.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    updateMutation.mutate({ id: editingId, ...editValues });
  };

  const saveNew = () => {
    if (!newRow.name.trim() || !newRow.costPerG.trim() || !newRow.unit.trim()) {
      toast({ title: "All fields are required", variant: "destructive" }); return;
    }
    addMutation.mutate(newRow);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <BookOpen className="w-6 h-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-library-title">Standard Ingredients Library</h1>
          <p className="text-sm text-muted-foreground">Shared £/g costs used across all product ingredient breakdowns</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-1/2">Name</TableHead>
                <TableHead className="text-right">£/g</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(!standards || standards.length === 0) && !showAddRow && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-10 text-sm">
                    No ingredients yet. Add one below, or save a product ingredient with a £/g cost to populate automatically.
                  </TableCell>
                </TableRow>
              )}

              {(standards ?? []).map(s => (
                <TableRow key={s.id} data-testid={`row-library-${s.id}`}>
                  {editingId === s.id ? (
                    <>
                      <TableCell className="py-1.5">
                        <Input
                          value={editValues.name}
                          onChange={e => setEditValues(v => ({ ...v, name: e.target.value }))}
                          className="h-8"
                          data-testid={`input-library-name-${s.id}`}
                          onKeyDown={e => e.key === "Enter" && saveEdit()}
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input
                          type="number"
                          value={editValues.costPerG}
                          onChange={e => setEditValues(v => ({ ...v, costPerG: e.target.value }))}
                          className="h-8 w-32 ml-auto text-right"
                          step="0.000001"
                          data-testid={`input-library-cost-${s.id}`}
                          onKeyDown={e => e.key === "Enter" && saveEdit()}
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <Input
                          value={editValues.unit}
                          onChange={e => setEditValues(v => ({ ...v, unit: e.target.value }))}
                          className="h-8 w-20"
                          data-testid={`input-library-unit-${s.id}`}
                          onKeyDown={e => e.key === "Enter" && saveEdit()}
                        />
                      </TableCell>
                      <TableCell className="py-1.5">
                        <div className="flex gap-1 justify-end">
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={saveEdit} disabled={updateMutation.isPending} data-testid={`button-library-save-${s.id}`}>
                            <Check className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingId(null)} data-testid={`button-library-cancel-${s.id}`}>
                            <X className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="font-medium" data-testid={`text-library-name-${s.id}`}>{s.name}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground" data-testid={`text-library-cost-${s.id}`}>
                        {s.costPerG ? `£${parseFloat(s.costPerG).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}` : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm" data-testid={`text-library-unit-${s.id}`}>{s.unit}</TableCell>
                      <TableCell>
                        <div className="flex gap-1 justify-end">
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => startEdit(s)} data-testid={`button-library-edit-${s.id}`}>
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteMutation.mutate(s.id)} disabled={deleteMutation.isPending} data-testid={`button-library-delete-${s.id}`}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}

              {showAddRow && (
                <TableRow data-testid="row-library-new">
                  <TableCell className="py-1.5">
                    <Input
                      placeholder="Ingredient name"
                      value={newRow.name}
                      onChange={e => setNewRow(v => ({ ...v, name: e.target.value }))}
                      className="h-8"
                      data-testid="input-library-new-name"
                      autoFocus
                      onKeyDown={e => e.key === "Enter" && saveNew()}
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Input
                      type="number"
                      placeholder="0.000000"
                      value={newRow.costPerG}
                      onChange={e => setNewRow(v => ({ ...v, costPerG: e.target.value }))}
                      step="0.000001"
                      className="h-8 w-32 ml-auto text-right"
                      data-testid="input-library-new-cost"
                      onKeyDown={e => e.key === "Enter" && saveNew()}
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Input
                      placeholder="g"
                      value={newRow.unit}
                      onChange={e => setNewRow(v => ({ ...v, unit: e.target.value }))}
                      className="h-8 w-20"
                      data-testid="input-library-new-unit"
                      onKeyDown={e => e.key === "Enter" && saveNew()}
                    />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600" onClick={saveNew} disabled={addMutation.isPending} data-testid="button-library-new-save">
                        <Check className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setShowAddRow(false); setNewRow({ name: "", costPerG: "", unit: "g" }); }} data-testid="button-library-new-cancel">
                        <X className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {!showAddRow && (
        <Button variant="outline" size="sm" onClick={() => setShowAddRow(true)} data-testid="button-library-add">
          <Plus className="w-3.5 h-3.5 mr-1.5" />
          Add ingredient
        </Button>
      )}
    </div>
  );
}
