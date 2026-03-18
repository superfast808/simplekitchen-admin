import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UtensilsCrossed, ChefHat, Check, Minus, Plus, ArrowRight, PartyPopper } from "lucide-react";

type AvailableMeal = {
  name: string;
  popularity: number;
  price?: string;
};

type InviteData = {
  customerName: string;
  subscriptionQuantity: number;
  status: string;
  addonPaid?: boolean;
  addonAmountPence?: number;
  isTuesday?: boolean;
  weekNumber?: number;
  categoryName?: string;
  availableMeals: AvailableMeal[];
  availableExtras: AvailableMeal[];
  selections: Array<{ productName: string; quantity: number }>;
};

function BrandLogo({ size = "lg" }: { size?: "lg" | "sm" }) {
  const { data: logoData } = useQuery<{ logo: string }>({
    queryKey: ["/api/auth/logo"],
    queryFn: async () => {
      const res = await fetch("/api/auth/logo");
      if (!res.ok) return { logo: "" };
      return res.json();
    },
    retry: false,
    staleTime: Infinity,
  });

  const dims = size === "lg" ? "w-16 h-16" : "w-14 h-14";
  const iconDims = size === "lg" ? "w-8 h-8" : "w-7 h-7";

  if (logoData?.logo) {
    return (
      <div className={`${dims} mx-auto rounded-2xl overflow-hidden shadow-lg`}>
        <img src={logoData.logo} alt="Simple Kitchen Prep" className="w-full h-full object-contain" />
      </div>
    );
  }

  return (
    <div className={`${dims} mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg`}>
      <ChefHat className={`${iconDims} text-white`} />
    </div>
  );
}

export default function SubscribePage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [email, setEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [extras, setExtras] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const { data, isLoading, error } = useQuery<InviteData>({
    queryKey: ["/api/subscribe", token],
    queryFn: async () => {
      const res = await fetch(`/api/subscribe/${token}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Not found");
      }
      return res.json();
    },
  });

  // Pre-fill selections: only classify as extra if it's a confirmed non-7.50 product
  // Everything else (including unrecognised products) defaults to meal
  useEffect(() => {
    if (!data) return;
    const extraSet = new Set((data.availableExtras || []).map(e => e.name));
    const mealSels: Record<string, number> = {};
    const extSels: Record<string, number> = {};
    for (const sel of data.selections || []) {
      if (extraSet.has(sel.productName)) {
        extSels[sel.productName] = sel.quantity;
      } else {
        mealSels[sel.productName] = sel.quantity;
      }
    }
    if (Object.keys(mealSels).length) setSelections(mealSels);
    if (Object.keys(extSels).length) setExtras(extSels);
  }, [data]);

  const totalSelected = Object.values(selections).reduce((sum, q) => sum + q, 0);
  const totalExtras = Object.values(extras).reduce((sum, q) => sum + q, 0);
  const maxMeals = data?.subscriptionQuantity || 0;
  const remaining = maxMeals - totalSelected;

  const handleVerifyEmail = () => {
    setEmailError("");
    if (!email.trim()) {
      setEmailError("Please enter your email address");
      return;
    }
    setEmailVerified(true);
  };

  const addMeal = (name: string) => {
    if (remaining <= 0) return;
    setSelections(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 }));
  };

  const removeMeal = (name: string) => {
    setSelections(prev => {
      const current = prev[name] || 0;
      if (current <= 1) { const { [name]: _, ...rest } = prev; return rest; }
      return { ...prev, [name]: current - 1 };
    });
  };

  const addExtra = (name: string) => {
    setExtras(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 }));
  };

  const removeExtra = (name: string) => {
    setExtras(prev => {
      const current = prev[name] || 0;
      if (current <= 1) { const { [name]: _, ...rest } = prev; return rest; }
      return { ...prev, [name]: current - 1 };
    });
  };

  const handleSubmit = async () => {
    setSubmitError("");
    setSubmitting(true);
    try {
      const sels = Object.entries(selections)
        .filter(([_, q]) => q > 0)
        .map(([productName, quantity]) => ({ productName, quantity }));
      const extSels = Object.entries(extras)
        .filter(([_, q]) => q > 0)
        .map(([productName, quantity]) => ({ productName, quantity }));

      const res = await fetch(`/api/subscribe/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, selections: sels, extras: extSels }),
      });

      if (!res.ok) {
        const err = await res.json();
        if (err.message?.toLowerCase().includes("email")) {
          setEmailVerified(false);
          setEmailError(err.message);
        } else {
          setSubmitError(err.message || "Failed to submit");
        }
        return;
      }

      const result = await res.json();

      // If the server returned a Stripe checkout URL, redirect to it
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }

      setSubmitted(true);
    } catch {
      setSubmitError("Could not connect to server. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 flex items-center justify-center p-4">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8">
            <UtensilsCrossed className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <h2 className="text-xl font-bold mb-2">Link Not Found</h2>
            <p className="text-muted-foreground">
              This meal selection link may have expired or is no longer valid. Please contact us if you need assistance.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (data.status === "completed" && !submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8">
            <Check className="w-12 h-12 mx-auto text-emerald-500 mb-4" />
            <h2 className="text-xl font-bold mb-2">Already Submitted</h2>
            <p className="text-muted-foreground">
              You've already chosen your meals for this week. If you need to make changes, please get in touch.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8 space-y-4">
            <PartyPopper className="w-14 h-14 mx-auto text-emerald-500" />
            <h2 className="text-2xl font-bold">You're all set!</h2>
            <p className="text-muted-foreground">
              Your meal choices have been saved. We'll have them ready for you this week.
            </p>
            <div className="pt-4 space-y-2">
              {Object.entries(selections).map(([name, qty]) => (
                <div key={name} className="flex items-center justify-between px-4 py-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
                  <span className="font-medium text-sm">{name}</span>
                  <Badge className="bg-emerald-500 text-white">×{qty}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!emailVerified) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-3">
            <BrandLogo size="lg" />
            <div>
              <CardTitle className="text-xl">Simple Kitchen Prep</CardTitle>
              <CardDescription className="mt-1">
                Hi{data.customerName ? ` ${data.customerName.split(" ")[0]}` : ""}! Enter your email to choose your {maxMeals} meals for this week.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sub-email">Email Address</Label>
              <Input
                id="sub-email"
                type="email"
                value={email}
                onChange={e => { setEmail(e.target.value); setEmailError(""); }}
                placeholder="your@email.com"
                onKeyDown={e => e.key === "Enter" && handleVerifyEmail()}
                data-testid="input-subscribe-email"
              />
              {emailError && (
                <p className="text-sm text-red-500" data-testid="text-email-error">{emailError}</p>
              )}
            </div>
            <Button className="w-full bg-emerald-600" onClick={handleVerifyEmail} data-testid="button-verify-email">
              Continue
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-lg mx-auto p-4 pb-32">
        <div className="text-center py-6">
          <div className="mb-3">
            <BrandLogo size="sm" />
          </div>
          <h1 className="text-xl font-bold" data-testid="text-subscribe-title">
            Choose Your Meals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Select {maxMeals} meals for this week{data.categoryName ? ` (${data.categoryName})` : ""}
            {data.isTuesday !== undefined && (
              <span className={`ml-2 text-xs font-semibold px-1.5 py-0.5 rounded ${data.isTuesday ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"}`}>
                {data.isTuesday ? "Tuesday delivery" : "Saturday delivery"}
              </span>
            )}
          </p>
        </div>

        <div className="mb-4 flex items-center justify-center gap-2">
          <Badge
            className={`text-sm px-3 py-1 ${remaining === 0 ? "bg-emerald-500 text-white" : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"}`}
            data-testid="badge-remaining"
          >
            {remaining === 0 ? `All ${maxMeals} chosen` : `${remaining} of ${maxMeals} remaining`}
          </Badge>
        </div>

        <div className="space-y-2">
          {data.availableMeals.map((meal) => {
            const qty = selections[meal.name] || 0;
            const isSelected = qty > 0;
            return (
              <Card
                key={meal.name}
                className={`transition-all ${isSelected ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm" : ""}`}
                data-testid={`card-meal-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}
              >
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{meal.name}</p>
                    <p className="text-xs text-muted-foreground">£7.50</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isSelected ? (
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 rounded-full"
                          onClick={() => removeMeal(meal.name)}
                          data-testid={`button-remove-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-6 text-center font-bold text-sm" data-testid={`text-qty-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>
                          {qty}
                        </span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-8 w-8 rounded-full"
                          onClick={() => addMeal(meal.name)}
                          disabled={remaining <= 0}
                          data-testid={`button-add-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addMeal(meal.name)}
                        disabled={remaining <= 0}
                        className="text-emerald-600 border-emerald-300"
                        data-testid={`button-select-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {data.availableMeals.length === 0 && (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <UtensilsCrossed className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>No meals available yet this week. Please check back later.</p>
            </CardContent>
          </Card>
        )}

        {/* Extras / Add-ons section */}
        {(data.availableExtras || []).length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 border-t" />
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">Add-ons (optional)</p>
              <div className="flex-1 border-t" />
            </div>
            {(data.availableExtras || []).map((extra) => {
              const qty = extras[extra.name] || 0;
              const isSelected = qty > 0;
              const unitPrice = extra.price ? parseFloat(extra.price) : 0;
              return (
                <Card
                  key={extra.name}
                  className={`transition-all ${isSelected ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20 shadow-sm" : ""}`}
                  data-testid={`card-extra-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{extra.name}</p>
                      {unitPrice > 0 && (
                        <p className="text-xs text-muted-foreground">£{unitPrice.toFixed(2)}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isSelected ? (
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
                            onClick={() => removeExtra(extra.name)}
                            data-testid={`button-remove-extra-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-6 text-center font-bold text-sm" data-testid={`text-extra-qty-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>{qty}</span>
                          <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
                            onClick={() => addExtra(extra.name)}
                            data-testid={`button-add-extra-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => addExtra(extra.name)}
                          className="text-blue-600 border-blue-300"
                          data-testid={`button-select-extra-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
                          <Plus className="w-3 h-3 mr-1" />
                          Add
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {submitError && (
          <p className="text-sm text-red-500 text-center mt-3" data-testid="text-submit-error">{submitError}</p>
        )}
      </div>

      {totalSelected > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t p-4 shadow-lg">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center gap-2 mb-2 text-xs text-muted-foreground overflow-x-auto">
              {Object.entries(selections).filter(([_, q]) => q > 0).map(([name, qty]) => (
                <Badge key={name} variant="secondary" className="shrink-0 text-xs">{name} ×{qty}</Badge>
              ))}
              {Object.entries(extras).filter(([_, q]) => q > 0).map(([name, qty]) => {
                const extraProduct = data.availableExtras.find(e => e.name === name);
                const price = extraProduct?.price ? parseFloat(extraProduct.price) : 0;
                return (
                  <Badge key={name} className="shrink-0 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                    {name} ×{qty}{price > 0 ? ` (£${(price * qty).toFixed(2)})` : ""}
                  </Badge>
                );
              })}
            </div>
            {totalExtras > 0 && (() => {
              const addonTotal = Object.entries(extras).reduce((sum, [name, qty]) => {
                const extraProduct = data.availableExtras.find(e => e.name === name);
                const price = extraProduct?.price ? parseFloat(extraProduct.price) : 0;
                return sum + price * qty;
              }, 0);
              return addonTotal > 0 ? (
                <p className="text-xs text-blue-700 dark:text-blue-300 mb-2 font-medium">
                  Add-ons total: £{addonTotal.toFixed(2)} — payment required at checkout
                </p>
              ) : null;
            })()}
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              size="lg"
              onClick={handleSubmit}
              disabled={submitting || totalSelected === 0}
              data-testid="button-submit-selections"
            >
              {submitting ? "Processing..." : `Confirm ${totalSelected} Meal${totalSelected !== 1 ? "s" : ""}${totalExtras > 0 ? ` + ${totalExtras} add-on${totalExtras !== 1 ? "s" : ""}` : ""}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
