import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShoppingBasket, Plus, Minus, CheckCircle, AlertTriangle, Loader2, Mail } from "lucide-react";

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
  const [email, setEmail] = useState("");
  const [addonData, setAddonData] = useState<AddonData | null>(null);
  const [quantities, setQuantities] = useState<Record<number, number>>({});

  // Step 1: check link validity
  const { data: validity, isLoading: validityLoading, error: validityError } = useQuery<{
    valid: boolean;
    expiresAt: string;
    requiresEmail: boolean;
  }>({
    queryKey: ["/api/addon", token, "validity"],
    queryFn: async () => {
      const res = await fetch(`/api/addon/${token}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Link unavailable");
      }
      return res.json();
    },
    retry: false,
  });

  // Step 2: verify email → get full order data
  const verifyMutation = useMutation({
    mutationFn: async (emailValue: string) => {
      const res = await fetch(`/api/addon/${token}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailValue }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Verification failed");
      }
      return res.json() as Promise<AddonData>;
    },
    onSuccess: (data) => {
      setAddonData(data);
    },
  });

  // Auto-verify if no email required
  useEffect(() => {
    if (validity && !validity.requiresEmail && !addonData && !verifyMutation.isPending && !verifyMutation.isError) {
      verifyMutation.mutate("");
    }
  }, [validity?.requiresEmail]);

  // Step 3: checkout
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
    const product = addonData?.products.find(p => p.id === sel.productId);
    return sum + (parseFloat(product?.price ?? "0") * sel.quantity);
  }, 0);

  // Loading
  if (validityLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Link invalid / expired
  if (validityError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="text-center max-w-sm">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Link unavailable</h2>
          <p className="text-gray-500 text-sm">{(validityError as Error).message}</p>
        </div>
      </div>
    );
  }

  // Email gate
  if (validity?.requiresEmail && !addonData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
              <Mail className="w-7 h-7 text-green-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900">Add items to your order</h1>
            <p className="text-sm text-gray-500 mt-1">Enter the email address used when placing your order to continue.</p>
          </div>
          <Card>
            <CardContent className="pt-5 pb-5">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="email-input" className="text-sm font-medium text-gray-700">Email address</Label>
                  <Input
                    id="email-input"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") verifyMutation.mutate(email); }}
                    className="mt-1"
                    data-testid="input-addon-email"
                    autoFocus
                  />
                </div>
                {verifyMutation.isError && (
                  <p className="text-sm text-red-600" data-testid="text-addon-error">
                    {(verifyMutation.error as Error).message}
                  </p>
                )}
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => verifyMutation.mutate(email)}
                  disabled={verifyMutation.isPending || !email.trim()}
                  data-testid="button-addon-verify"
                >
                  {verifyMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Continue"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Loading order data (no email required, auto-verifying)
  if (!addonData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Product picker
  const groups: Record<string, AddonProduct[]> = {};
  for (const p of addonData.products) {
    const cat = p.category ?? "Other";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(p);
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-36">
      <div className="max-w-lg mx-auto px-4 pt-8">
        <div className="flex items-center gap-2 mb-1">
          <ShoppingBasket className="w-6 h-6 text-green-600" />
          <h1 className="text-xl font-bold text-gray-900">Add items to your order</h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Hi {addonData.order.customerName}, pick anything you'd like to add and pay securely below.
        </p>

        {/* Existing order */}
        {addonData.order.items.length > 0 && (
          <Card className="mb-6">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm font-medium text-gray-500 uppercase tracking-wide">Your current order</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <ul className="space-y-1">
                {addonData.order.items.map(item => (
                  <li key={item.id} className="flex justify-between text-sm text-gray-700">
                    <span>{item.productName}</span>
                    <span className="text-gray-400">×{item.quantity}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Product picker */}
        {Object.entries(groups).map(([category, products]) => (
          <div key={category} className="mb-6">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">{category}</h2>
            <div className="space-y-3">
              {products.map(product => {
                const qty = quantities[product.id] ?? 0;
                return (
                  <div
                    key={product.id}
                    className="flex items-center justify-between bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3"
                    data-testid={`card-addon-product-${product.id}`}
                  >
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
                          <Button
                            size="icon"
                            variant="outline"
                            className="w-7 h-7 rounded-full"
                            onClick={() => adjust(product.id, -1)}
                            data-testid={`button-minus-${product.id}`}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-5 text-center text-sm font-semibold" data-testid={`text-qty-${product.id}`}>{qty}</span>
                        </>
                      )}
                      <Button
                        size="icon"
                        variant={qty > 0 ? "outline" : "default"}
                        className="w-7 h-7 rounded-full"
                        onClick={() => adjust(product.id, 1)}
                        data-testid={`button-plus-${product.id}`}
                      >
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
              <p className="text-sm text-gray-500">
                {selectedItems.reduce((s, i) => s + i.quantity, 0)} item{selectedItems.reduce((s, i) => s + i.quantity, 0) !== 1 ? "s" : ""}
              </p>
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
