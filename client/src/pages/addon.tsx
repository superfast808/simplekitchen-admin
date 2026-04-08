import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ShoppingBasket, Plus, Minus, CheckCircle, AlertTriangle, Loader2 } from "lucide-react";

interface AddonProduct {
  id: number;
  name: string;
  price: string;
  imageUrl: string | null;
  category: string | null;
}

interface AddonOrderItem {
  id: number;
  productName: string;
  quantity: number;
  price: string;
}

interface AddonData {
  order: {
    id: number;
    customerName: string;
    orderDate: string;
    items: AddonOrderItem[];
  };
  products: AddonProduct[];
  expiresAt: string;
}

export default function AddonPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [success, setSuccess] = useState(false);

  const { data, isLoading, error } = useQuery<AddonData>({
    queryKey: ["/api/addon", token],
    queryFn: async () => {
      const res = await fetch(`/api/addon/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Failed to load");
      }
      return res.json();
    },
    retry: false,
  });

  const checkoutMutation = useMutation({
    mutationFn: async (items: Array<{ productId: number; quantity: number }>) => {
      const res = await fetch(`/api/addon/${token}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Checkout failed");
      }
      return res.json() as Promise<{ checkoutUrl: string }>;
    },
    onSuccess: (data) => {
      window.location.href = data.checkoutUrl;
    },
  });

  const adjust = (productId: number, delta: number) => {
    setQuantities(prev => {
      const next = (prev[productId] ?? 0) + delta;
      if (next <= 0) {
        const { [productId]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [productId]: next };
    });
  };

  const selectedItems = Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({ productId: parseInt(id), quantity: qty }));

  const totalPrice = selectedItems.reduce((sum, sel) => {
    const product = data?.products.find(p => p.id === sel.productId);
    return sum + (parseFloat(product?.price ?? "0") * sel.quantity);
  }, 0);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-sm">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Link unavailable</h2>
          <p className="text-gray-500 text-sm">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-sm">
          <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Items added!</h2>
          <p className="text-gray-500 text-sm">Your extra items have been added to your order. No further action needed.</p>
        </div>
      </div>
    );
  }

  const groups: Record<string, AddonProduct[]> = {};
  for (const p of (data?.products ?? [])) {
    const cat = p.category ?? "Other";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-32">
      <div className="max-w-lg mx-auto px-4 pt-8">
        <div className="flex items-center gap-2 mb-1">
          <ShoppingBasket className="w-6 h-6 text-green-600" />
          <h1 className="text-xl font-bold text-gray-900">Add items to your order</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">Hi {data?.order.customerName}, pick anything you'd like to add and pay securely below.</p>

        {/* Existing order */}
        <Card className="mb-6">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wide">Your current order</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {(data?.order.items ?? []).length === 0 ? (
              <p className="text-sm text-gray-400">No items yet</p>
            ) : (
              <ul className="space-y-1">
                {data?.order.items.map(item => (
                  <li key={item.id} className="flex justify-between text-sm text-gray-700">
                    <span>{item.productName}</span>
                    <span className="text-gray-400">×{item.quantity}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Product picker */}
        {Object.entries(groups).map(([category, products]) => (
          <div key={category} className="mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">{category}</h2>
            <div className="space-y-3">
              {products.map(product => {
                const qty = quantities[product.id] ?? 0;
                return (
                  <div key={product.id} className="flex items-center justify-between bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3" data-testid={`card-addon-product-${product.id}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      {product.imageUrl && (
                        <img src={product.imageUrl} alt={product.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 leading-tight">{product.name}</p>
                        <p className="text-sm text-green-600 font-semibold">£{parseFloat(product.price).toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {qty > 0 && (
                        <>
                          <Button size="icon" variant="outline" className="w-7 h-7 rounded-full" onClick={() => adjust(product.id, -1)} data-testid={`button-minus-${product.id}`}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-5 text-center text-sm font-semibold" data-testid={`text-qty-${product.id}`}>{qty}</span>
                        </>
                      )}
                      <Button size="icon" variant={qty > 0 ? "outline" : "default"} className="w-7 h-7 rounded-full" onClick={() => adjust(product.id, 1)} data-testid={`button-plus-${product.id}`}>
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Sticky checkout bar */}
      {selectedItems.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-white border-t border-gray-200 p-4 shadow-lg">
          <div className="max-w-lg mx-auto flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-500">{selectedItems.reduce((s, i) => s + i.quantity, 0)} item{selectedItems.reduce((s, i) => s + i.quantity, 0) !== 1 ? "s" : ""}</p>
              <p className="text-base font-bold text-gray-900">£{totalPrice.toFixed(2)}</p>
            </div>
            <Button
              className="flex-shrink-0 bg-green-600 hover:bg-green-700 text-white px-6"
              onClick={() => checkoutMutation.mutate(selectedItems)}
              disabled={checkoutMutation.isPending}
              data-testid="button-checkout"
            >
              {checkoutMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Pay & add to order"}
            </Button>
          </div>
          {checkoutMutation.isError && (
            <p className="text-xs text-red-500 text-center mt-2">{(checkoutMutation.error as Error).message}</p>
          )}
        </div>
      )}
    </div>
  );
}
