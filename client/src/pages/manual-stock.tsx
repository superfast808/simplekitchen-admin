import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format, startOfWeek, endOfWeek, addWeeks } from "date-fns";
import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Package, ChevronLeft, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Product, ManualQuantity } from "@shared/schema";

export default function ManualStockPage() {
  const { toast } = useToast();
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");

  const now = new Date();
  const from = startOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });
  const to = endOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });

  const { data: products } = useQuery<Product[]>({ queryKey: ["/api/products"] });

  const { data: manualQtys, isLoading } = useQuery<ManualQuantity[]>({
    queryKey: ["/api/manual-quantities", `?from=${from.toISOString()}&to=${to.toISOString()}`],
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/manual-quantities", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manual-quantities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-totals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-summary"] });
      toast({ title: "Stock entry added" });
      setSelectedProductId("");
      setQuantity("");
      setNote("");
    },
    onError: (error: Error) => {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/manual-quantities/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/manual-quantities"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-totals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ingredient-summary"] });
      toast({ title: "Entry deleted" });
    },
  });

  const handleAdd = () => {
    if (!selectedProductId || !quantity) {
      toast({ title: "Select a product and enter quantity", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      productId: parseInt(selectedProductId),
      quantity: parseInt(quantity),
      note: note || null,
    });
  };

  const getProductName = (productId: number) => {
    return products?.find(p => p.id === productId)?.name || `Product #${productId}`;
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-stock-title">Manual Stock</h1>
          <p className="text-sm text-muted-foreground">
            Track quantities for local shops and non-website orders
          </p>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w - 1)} data-testid="button-stock-prev">
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setWeekOffset(0)} data-testid="button-stock-this-week">This Week</Button>
          <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w + 1)} data-testid="button-stock-next">
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-3">Add Stock Entry</h3>
          <div className="flex gap-3 items-end flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs">Product</Label>
              <Select value={selectedProductId} onValueChange={setSelectedProductId}>
                <SelectTrigger data-testid="select-stock-product">
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {(products || []).map(p => (
                    <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-24">
              <Label className="text-xs">Quantity</Label>
              <Input
                type="number"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
                placeholder="Qty"
                min={1}
                data-testid="input-stock-quantity"
              />
            </div>
            <div className="flex-1 min-w-[140px]">
              <Label className="text-xs">Note (optional)</Label>
              <Input
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="e.g. Local shop restock"
                data-testid="input-stock-note"
              />
            </div>
            <Button size="sm" onClick={handleAdd} disabled={createMutation.isPending} data-testid="button-add-stock">
              <Plus className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !manualQtys || manualQtys.length === 0 ? (
            <div className="p-12 text-center">
              <Package className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No manual stock entries</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add entries for items sold in local shops or ordered outside the website
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-[50px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {manualQtys.map((mq) => (
                  <TableRow key={mq.id} data-testid={`row-stock-${mq.id}`}>
                    <TableCell className="font-medium" data-testid={`text-stock-product-${mq.id}`}>
                      {getProductName(mq.productId)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums" data-testid={`text-stock-qty-${mq.id}`}>
                      {mq.quantity}
                    </TableCell>
                    <TableCell className="text-muted-foreground" data-testid={`text-stock-note-${mq.id}`}>
                      {mq.note || "-"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(mq.date), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(mq.id)} data-testid={`button-delete-stock-${mq.id}`}>
                        <Trash2 className="w-4 h-4 text-muted-foreground" />
                      </Button>
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
