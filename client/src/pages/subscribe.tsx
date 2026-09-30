import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { UtensilsCrossed, ChefHat, Check, Minus, Plus, ArrowRight, PartyPopper, CalendarDays } from "lucide-react";

type AvailableMeal = {
  name: string;
  popularity: number;
  price?: string;
};

type SelectionMap = Record<string, number>;

type InviteData = {
  customerName: string;
  subscriptionQuantity: number;
  status: string;
  addonPaid?: boolean;
  addonAmountPence?: number;
  paymentUrl?: string | null;
  includedOats?: number;
  includedSweetTreats?: number;
  isTuesday?: boolean;
  isDual?: boolean;
  weekNumber?: number;
  categoryName?: string;
  availableMeals: AvailableMeal[];
  availableExtras: AvailableMeal[];
  // Day-specific lists for dual (and single-day) invites
  satAvailableMeals?: AvailableMeal[];
  satAvailableExtras?: AvailableMeal[];
  tueAvailableMeals?: AvailableMeal[];
  tueAvailableExtras?: AvailableMeal[];
  selections: Array<{ productName: string; quantity: number; deliveryDay?: string }>;
  satSelections?: Array<{ productName: string; quantity: number }>;
  tueSelections?: Array<{ productName: string; quantity: number }>;
};

function getChargeableExtrasTotal(
  selectionsByDelivery: Array<{ selections: SelectionMap; availableExtras: AvailableMeal[] }>,
  includedOats: number,
  includedSweetTreats: number,
) {
  let oatsLeft = includedOats;
  let treatsLeft = includedSweetTreats;
  let total = 0;

  for (const { selections, availableExtras } of selectionsByDelivery) {
    for (const [name, quantity] of Object.entries(selections)) {
      const product = availableExtras.find(extra => extra.name === name);
      const price = product?.price ? parseFloat(product.price) : 0;
      if (price <= 0) continue;

      const isOat = /oat/i.test(name);
      const isSoup = /soup/i.test(name);
      let chargeableQuantity = quantity;
      if (isOat && oatsLeft > 0) {
        const included = Math.min(chargeableQuantity, oatsLeft);
        oatsLeft -= included;
        chargeableQuantity -= included;
      } else if (!isOat && !isSoup && treatsLeft > 0) {
        const included = Math.min(chargeableQuantity, treatsLeft);
        treatsLeft -= included;
        chargeableQuantity -= included;
      }
      total += price * chargeableQuantity;
    }
  }

  return total;
}

function getChargeableExtraQuantities(
  selections: SelectionMap,
  availableExtras: AvailableMeal[],
  includedOats: number,
  includedSweetTreats: number,
) {
  let oatsLeft = includedOats;
  let treatsLeft = includedSweetTreats;
  const chargeable: Record<string, number> = {};

  for (const [name, quantity] of Object.entries(selections)) {
    const product = availableExtras.find(extra => extra.name === name);
    const price = product?.price ? parseFloat(product.price) : 0;
    let chargeableQuantity = price > 0 ? quantity : 0;
    const isOat = /oat/i.test(name);
    const isSoup = /soup/i.test(name);
    if (isOat && oatsLeft > 0) {
      const included = Math.min(chargeableQuantity, oatsLeft);
      oatsLeft -= included;
      chargeableQuantity -= included;
    } else if (!isOat && !isSoup && treatsLeft > 0) {
      const included = Math.min(chargeableQuantity, treatsLeft);
      treatsLeft -= included;
      chargeableQuantity -= included;
    }
    chargeable[name] = chargeableQuantity;
  }

  return chargeable;
}

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

// Reusable single-day meal selector panel
function MealSelectorPanel({
  label,
  colorScheme,
  availableMeals,
  availableExtras,
  selections,
  extras,
  maxMeals,
  onAddMeal,
  onRemoveMeal,
  onAddExtra,
  onRemoveExtra,
  testPrefix,
}: {
  label: string;
  colorScheme: "emerald" | "blue";
  availableMeals: AvailableMeal[];
  availableExtras: AvailableMeal[];
  selections: SelectionMap;
  extras: SelectionMap;
  maxMeals: number;
  onAddMeal: (name: string) => void;
  onRemoveMeal: (name: string) => void;
  onAddExtra: (name: string) => void;
  onRemoveExtra: (name: string) => void;
  testPrefix: string;
}) {
  const totalSelected = Object.values(selections).reduce((s, q) => s + q, 0);
  const remaining = maxMeals - totalSelected;
  const totalExtras = Object.values(extras).reduce((s, q) => s + q, 0);

  const borderColor = colorScheme === "emerald" ? "border-emerald-400" : "border-blue-400";
  const bgColor = colorScheme === "emerald" ? "bg-emerald-50/50 dark:bg-emerald-950/20" : "bg-blue-50/50 dark:bg-blue-950/20";
  const badgeActive = colorScheme === "emerald" ? "bg-emerald-500 text-white" : "bg-blue-500 text-white";
  const badgePending = colorScheme === "emerald" ? "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" : "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
  const btnColor = colorScheme === "emerald" ? "text-emerald-600 border-emerald-300" : "text-blue-600 border-blue-300";
  const headerBg = colorScheme === "emerald" ? "bg-orange-50 dark:bg-orange-950/10 border-orange-200" : "bg-blue-50 dark:bg-blue-950/10 border-blue-200";
  const headerText = colorScheme === "emerald" ? "text-orange-700 dark:text-orange-300" : "text-blue-700 dark:text-blue-300";

  return (
    <div className="space-y-2">
      <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${headerBg}`}>
        <div className="flex items-center gap-2">
          <CalendarDays className={`w-4 h-4 ${headerText}`} />
          <span className={`font-semibold text-sm ${headerText}`}>{label}</span>
        </div>
        <Badge
          className={`text-xs px-2 py-0.5 ${remaining === 0 ? badgeActive : badgePending}`}
          data-testid={`badge-remaining-${testPrefix}`}
        >
          {remaining === 0 ? `All ${maxMeals} chosen` : `${remaining} of ${maxMeals} remaining`}
        </Badge>
      </div>

      {availableMeals.map((meal) => {
        const qty = selections[meal.name] || 0;
        const isSelected = qty > 0;
        const mealPrice = meal.price ? parseFloat(meal.price) : 7.75;
        const isSpecialMeal = mealPrice > 7.75;
        const surcharge = isSpecialMeal ? (mealPrice - 7.75).toFixed(2) : null;
        return (
          <Card
            key={meal.name}
            className={`transition-all ${isSelected ? `${borderColor} ${bgColor} shadow-sm` : ""}`}
            data-testid={`card-meal-${testPrefix}-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}
          >
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{meal.name}</p>
                {isSpecialMeal ? (
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    £{mealPrice.toFixed(2)} <span className="text-muted-foreground font-normal">(+£{surcharge} special)</span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">£7.75</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isSelected ? (
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
                      onClick={() => onRemoveMeal(meal.name)}
                      data-testid={`button-remove-${testPrefix}-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>
                      <Minus className="w-3 h-3" />
                    </Button>
                    <span className="w-6 text-center font-bold text-sm">{qty}</span>
                    <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
                      onClick={() => onAddMeal(meal.name)}
                      disabled={remaining <= 0}
                      data-testid={`button-add-${testPrefix}-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>
                      <Plus className="w-3 h-3" />
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onAddMeal(meal.name)}
                    disabled={remaining <= 0}
                    className={btnColor}
                    data-testid={`button-select-${testPrefix}-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>
                    <Plus className="w-3 h-3 mr-1" />
                    Add
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {availableMeals.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center text-muted-foreground">
            <UtensilsCrossed className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No meals available yet this week.</p>
          </CardContent>
        </Card>
      )}

      {(availableExtras || []).length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 border-t" />
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">Add-ons (optional)</p>
            <div className="flex-1 border-t" />
          </div>
          {(availableExtras || []).map((extra) => {
            const qty = extras[extra.name] || 0;
            const isSelected = qty > 0;
            const unitPrice = extra.price ? parseFloat(extra.price) : 0;
            return (
              <Card key={extra.name}
                className={`transition-all ${isSelected ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20 shadow-sm" : ""}`}
                data-testid={`card-extra-${testPrefix}-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{extra.name}</p>
                    {unitPrice > 0 && <p className="text-xs text-muted-foreground">£{unitPrice.toFixed(2)}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isSelected ? (
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
                          onClick={() => onRemoveExtra(extra.name)}
                          data-testid={`button-remove-extra-${testPrefix}-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-6 text-center font-bold text-sm">{qty}</span>
                        <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
                          onClick={() => onAddExtra(extra.name)}
                          data-testid={`button-add-extra-${testPrefix}-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => onAddExtra(extra.name)}
                        className="text-blue-600 border-blue-300"
                        data-testid={`button-select-extra-${testPrefix}-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
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
    </div>
  );
}

export default function SubscribePage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [email, setEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailError, setEmailError] = useState("");

  // Single-day state
  const [selections, setSelections] = useState<SelectionMap>({});
  const [extras, setExtras] = useState<SelectionMap>({});

  // Dual-day state
  const [satSelections, setSatSelections] = useState<SelectionMap>({});
  const [satExtras, setSatExtras] = useState<SelectionMap>({});
  const [tueSelections, setTueSelections] = useState<SelectionMap>({});
  const [tueExtras, setTueExtras] = useState<SelectionMap>({});

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

  // Pre-fill selections from server data
  useEffect(() => {
    if (!data) return;

    if (data.isDual) {
      // Use day-specific extra sets so specials stay in meals, oats/soups go into extras
      const satExtraSet = new Set((data.satAvailableExtras || data.availableExtras || []).map(e => e.name));
      const tueExtraSet = new Set((data.tueAvailableExtras || data.availableExtras || []).map(e => e.name));
      const satMeals: SelectionMap = {};
      const satExt: SelectionMap = {};
      const tueMeals: SelectionMap = {};
      const tueExt: SelectionMap = {};
      for (const sel of data.satSelections || []) {
        if (satExtraSet.has(sel.productName)) satExt[sel.productName] = sel.quantity;
        else satMeals[sel.productName] = sel.quantity;
      }
      for (const sel of data.tueSelections || []) {
        if (tueExtraSet.has(sel.productName)) tueExt[sel.productName] = sel.quantity;
        else tueMeals[sel.productName] = sel.quantity;
      }
      if (Object.keys(satMeals).length) setSatSelections(satMeals);
      if (Object.keys(satExt).length) setSatExtras(satExt);
      if (Object.keys(tueMeals).length) setTueSelections(tueMeals);
      if (Object.keys(tueExt).length) setTueExtras(tueExt);
    } else {
      const extraSet = new Set((data.availableExtras || []).map(e => e.name));
      const mealSels: SelectionMap = {};
      const extSels: SelectionMap = {};
      for (const sel of data.selections || []) {
        if (extraSet.has(sel.productName)) extSels[sel.productName] = sel.quantity;
        else mealSels[sel.productName] = sel.quantity;
      }
      if (Object.keys(mealSels).length) setSelections(mealSels);
      if (Object.keys(extSels).length) setExtras(extSels);
    }
  }, [data]);

  const maxMeals = data?.subscriptionQuantity || 0;
  const totalSelected = Object.values(selections).reduce((s, q) => s + q, 0);
  const totalExtras = Object.values(extras).reduce((s, q) => s + q, 0);
  const remaining = maxMeals - totalSelected;

  const satTotal = Object.values(satSelections).reduce((s, q) => s + q, 0);
  const tueTotal = Object.values(tueSelections).reduce((s, q) => s + q, 0);

  const makeAdder = (setter: React.Dispatch<React.SetStateAction<SelectionMap>>, total: number) =>
    (name: string) => { if (total >= maxMeals) return; setter(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 })); };

  const makeRemover = (setter: React.Dispatch<React.SetStateAction<SelectionMap>>) =>
    (name: string) => setter(prev => { const c = prev[name] || 0; if (c <= 1) { const { [name]: _, ...rest } = prev; return rest; } return { ...prev, [name]: c - 1 }; });

  const makeExtraAdder = (setter: React.Dispatch<React.SetStateAction<SelectionMap>>) =>
    (name: string) => setter(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 }));

  const makeExtraRemover = (setter: React.Dispatch<React.SetStateAction<SelectionMap>>) =>
    (name: string) => setter(prev => { const c = prev[name] || 0; if (c <= 1) { const { [name]: _, ...rest } = prev; return rest; } return { ...prev, [name]: c - 1 }; });

  const handleVerifyEmail = () => {
    setEmailError("");
    if (!email.trim()) { setEmailError("Please enter your email address"); return; }
    setEmailVerified(true);
  };

  const handleSubmit = async () => {
    setSubmitError("");
    setSubmitting(true);
    try {
      let body: Record<string, unknown>;

      if (data?.isDual) {
        const satSels = Object.entries(satSelections).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
        const tueSels = Object.entries(tueSelections).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
        const satExt = Object.entries(satExtras).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
        const tueExt = Object.entries(tueExtras).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
        body = { email, satSelections: satSels, tueSelections: tueSels, satExtras: satExt, tueExtras: tueExt };
      } else {
        const sels = Object.entries(selections).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
        const extSels = Object.entries(extras).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
        body = { email, selections: sels, extras: extSels };
      }

      const res = await fetch(`/api/subscribe/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      if (result.checkoutUrl) { window.location.href = result.checkoutUrl; return; }
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
            <p className="text-muted-foreground">This meal selection link may have expired or is no longer valid. Please contact us if you need assistance.</p>
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
            <h2 className="text-xl font-bold mb-2">{!data.addonPaid && data.addonAmountPence ? "Payment pending" : "Already Submitted"}</h2>
            <p className="text-muted-foreground">
              {!data.addonPaid && data.addonAmountPence
                ? "Your meals are saved but will not be processed until the add-on payment is complete."
                : "You've already chosen your meals for this week. If you need to make changes, please get in touch."}
            </p>
            {!data.addonPaid && data.paymentUrl && (
              <Button className="mt-4 bg-emerald-600" onClick={() => window.location.assign(data.paymentUrl!)}>
                Continue to payment
              </Button>
            )}
            {!data.addonPaid && data.addonAmountPence && !data.paymentUrl && (
              <p className="text-sm text-muted-foreground mt-4">Please get in touch for a new payment link.</p>
            )}
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
            <p className="text-muted-foreground">Your meal choices have been saved. We'll have them ready for you this week.</p>
            {data.isDual ? (
              <div className="pt-2 space-y-3 text-left">
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">Saturday</p>
                {Object.entries(satSelections).map(([name, qty]) => (
                  <div key={name} className="flex items-center justify-between px-3 py-2 bg-orange-50 dark:bg-orange-950/20 rounded-lg">
                    <span className="font-medium text-sm">{name}</span>
                    <Badge className="bg-orange-500 text-white">×{qty}</Badge>
                  </div>
                ))}
                <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mt-2">Tuesday</p>
                {Object.entries(tueSelections).map(([name, qty]) => (
                  <div key={name} className="flex items-center justify-between px-3 py-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                    <span className="font-medium text-sm">{name}</span>
                    <Badge className="bg-blue-500 text-white">×{qty}</Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="pt-4 space-y-2">
                {Object.entries(selections).map(([name, qty]) => (
                  <div key={name} className="flex items-center justify-between px-4 py-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg">
                    <span className="font-medium text-sm">{name}</span>
                    <Badge className="bg-emerald-500 text-white">×{qty}</Badge>
                  </div>
                ))}
              </div>
            )}
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
                Hi{data.customerName ? ` ${data.customerName.split(" ")[0]}` : ""}! Enter your email to choose your {maxMeals} meals for this week{data.isDual ? " (Saturday + Tuesday)" : ""}.
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
              {emailError && <p className="text-sm text-red-500" data-testid="text-email-error">{emailError}</p>}
            </div>
            <Button className="w-full bg-emerald-600" onClick={handleVerifyEmail} data-testid="button-verify-email">
              Continue <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- DUAL DAY ----
  if (data.isDual) {
    const canSubmit = satTotal > 0 && tueTotal > 0;
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
        <div className="max-w-lg mx-auto p-4 pb-36">
          <div className="text-center py-6">
            <div className="mb-3"><BrandLogo size="sm" /></div>
            <h1 className="text-xl font-bold" data-testid="text-subscribe-title">Choose Your Meals</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {maxMeals} meals per delivery — Saturday <span className="font-semibold text-orange-600">+</span> Tuesday
            </p>
            <Badge className="mt-2 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 text-xs">
              2-week subscription (Sat + Tue)
            </Badge>
          </div>

          <div className="space-y-6">
            {((data.includedOats || 0) > 0 || (data.includedSweetTreats || 0) > 0) && (
              <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg px-3 py-2">
                Across both deliveries, {data.includedOats || 0} oats and {data.includedSweetTreats || 0} sweet treats are included at no extra charge. Additional add-ons are charged at the prices shown.
              </p>
            )}
            <MealSelectorPanel
              label="Saturday Delivery"
              colorScheme="emerald"
              availableMeals={data.satAvailableMeals || data.availableMeals}
              availableExtras={data.satAvailableExtras || data.availableExtras}
              selections={satSelections}
              extras={satExtras}
              maxMeals={maxMeals}
              onAddMeal={makeAdder(setSatSelections, satTotal)}
              onRemoveMeal={makeRemover(setSatSelections)}
              onAddExtra={makeExtraAdder(setSatExtras)}
              onRemoveExtra={makeExtraRemover(setSatExtras)}
              testPrefix="sat"
            />

            <div className="flex items-center gap-3">
              <div className="flex-1 border-t border-dashed" />
              <span className="text-xs text-muted-foreground font-medium uppercase tracking-wide shrink-0">Tuesday Delivery</span>
              <div className="flex-1 border-t border-dashed" />
            </div>

            <MealSelectorPanel
              label="Tuesday Delivery"
              colorScheme="blue"
              availableMeals={data.tueAvailableMeals || data.availableMeals}
              availableExtras={data.tueAvailableExtras || data.availableExtras}
              selections={tueSelections}
              extras={tueExtras}
              maxMeals={maxMeals}
              onAddMeal={makeAdder(setTueSelections, tueTotal)}
              onRemoveMeal={makeRemover(setTueSelections)}
              onAddExtra={makeExtraAdder(setTueExtras)}
              onRemoveExtra={makeExtraRemover(setTueExtras)}
              testPrefix="tue"
            />
          </div>

          {submitError && <p className="text-sm text-red-500 text-center mt-3" data-testid="text-submit-error">{submitError}</p>}
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-gray-900/95 backdrop-blur border-t p-4 shadow-lg">
          <div className="max-w-lg mx-auto">
            <div className="flex items-center gap-4 mb-2 text-xs text-muted-foreground">
              <span className="text-orange-600 font-medium">Sat: {satTotal}/{maxMeals}</span>
              <span className="text-blue-600 font-medium">Tue: {tueTotal}/{maxMeals}</span>
            </div>
            {(() => {
              const specialsSurcharge = [
                { selections: satSelections, meals: data.satAvailableMeals || data.availableMeals },
                { selections: tueSelections, meals: data.tueAvailableMeals || data.availableMeals },
              ].reduce((total, delivery) => total + Object.entries(delivery.selections).reduce((subtotal, [name, quantity]) => {
                const meal = delivery.meals.find(item => item.name === name);
                const price = meal?.price ? parseFloat(meal.price) : 7.75;
                return subtotal + Math.max(0, price - 7.75) * quantity;
              }, 0), 0);
              const addonTotal = getChargeableExtrasTotal([
                { selections: satExtras, availableExtras: data.satAvailableExtras || data.availableExtras || [] },
                { selections: tueExtras, availableExtras: data.tueAvailableExtras || data.availableExtras || [] },
              ], data.includedOats || 0, data.includedSweetTreats || 0);
              return specialsSurcharge > 0 || addonTotal > 0 ? (
                <div className="mb-2 space-y-0.5">
                  {specialsSurcharge > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                      Premium meal surcharge: £{specialsSurcharge.toFixed(2)} — payment required at checkout
                    </p>
                  )}
                  {addonTotal > 0 && (
                    <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">
                      Chargeable add-ons: £{addonTotal.toFixed(2)} — included allowances have been applied
                    </p>
                  )}
                </div>
              ) : null;
            })()}
            {!canSubmit && (
              <p className="text-xs text-muted-foreground mb-2">
                {satTotal === 0 && tueTotal === 0 ? "Select meals for both deliveries to continue" :
                  satTotal === 0 ? "Select your Saturday meals to continue" :
                    "Select your Tuesday meals to continue"}
              </p>
            )}
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              size="lg"
              onClick={handleSubmit}
              disabled={submitting || !canSubmit}
              data-testid="button-submit-selections"
            >
              {submitting ? "Processing..." : `Confirm Both Deliveries (${satTotal} Sat + ${tueTotal} Tue)`}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const chargeableExtraQuantities = getChargeableExtraQuantities(
    extras,
    data.availableExtras || [],
    data.includedOats || 0,
    data.includedSweetTreats || 0,
  );

  // ---- SINGLE DAY ----
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900">
      <div className="max-w-lg mx-auto p-4 pb-32">
        <div className="text-center py-6">
          <div className="mb-3"><BrandLogo size="sm" /></div>
          <h1 className="text-xl font-bold" data-testid="text-subscribe-title">Choose Your Meals</h1>
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
            const mealPrice = meal.price ? parseFloat(meal.price) : 7.75;
            const isSpecialMeal = mealPrice > 7.75;
            const surcharge = isSpecialMeal ? (mealPrice - 7.75).toFixed(2) : null;
            return (
              <Card key={meal.name}
                className={`transition-all ${isSelected ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm" : ""}`}
                data-testid={`card-meal-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{meal.name}</p>
                    {isSpecialMeal ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                        £{mealPrice.toFixed(2)} <span className="text-muted-foreground font-normal">(+£{surcharge} special)</span>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">£7.75</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isSelected ? (
                      <div className="flex items-center gap-1">
                        <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
                          onClick={() => makeRemover(setSelections)(meal.name)}
                          data-testid={`button-remove-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-6 text-center font-bold text-sm" data-testid={`text-qty-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>{qty}</span>
                        <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
                          onClick={() => makeAdder(setSelections, totalSelected)(meal.name)}
                          disabled={remaining <= 0}
                          data-testid={`button-add-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>
                          <Plus className="w-3 h-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button size="sm" variant="outline"
                        onClick={() => makeAdder(setSelections, totalSelected)(meal.name)}
                        disabled={remaining <= 0}
                        className="text-emerald-600 border-emerald-300"
                        data-testid={`button-select-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>
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

        {((data.includedOats || 0) > 0 || (data.includedSweetTreats || 0) > 0) && (
          <p className="mt-6 text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg px-3 py-2">
            Included at no extra charge: {data.includedOats || 0} oats and {data.includedSweetTreats || 0} sweet treats. Additional add-ons are charged at the prices shown.
          </p>
        )}
        {(data.availableExtras || []).length > 0 && (
          <div className="mt-2 space-y-2">
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
                <Card key={extra.name}
                  className={`transition-all ${isSelected ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20 shadow-sm" : ""}`}
                  data-testid={`card-extra-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
                  <CardContent className="p-4 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{extra.name}</p>
                      {unitPrice > 0 && <p className="text-xs text-muted-foreground">£{unitPrice.toFixed(2)}</p>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isSelected ? (
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
                            onClick={() => makeExtraRemover(setExtras)(extra.name)}
                            data-testid={`button-remove-extra-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
                            <Minus className="w-3 h-3" />
                          </Button>
                          <span className="w-6 text-center font-bold text-sm">{qty}</span>
                          <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
                            onClick={() => makeExtraAdder(setExtras)(extra.name)}
                            data-testid={`button-add-extra-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => makeExtraAdder(setExtras)(extra.name)}
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
                const chargeableQuantity = chargeableExtraQuantities[name] || 0;
                const includedQuantity = qty - chargeableQuantity;
                return (
                  <Badge key={name} className="shrink-0 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                    {name} ×{qty}{price > 0
                      ? includedQuantity > 0
                        ? ` (${includedQuantity} included${chargeableQuantity > 0 ? `; £${(price * chargeableQuantity).toFixed(2)} charged` : ""})`
                        : ` (£${(price * chargeableQuantity).toFixed(2)} charged)`
                      : ""}
                  </Badge>
                );
              })}
            </div>
            {(() => {
              const specialsSurcharge = !data.isTuesday ? Object.entries(selections).reduce((sum, [name, qty]) => {
                const mp = data.availableMeals.find(m => m.name === name);
                const price = mp?.price ? parseFloat(mp.price) : 7.75;
                return price > 7.75 ? sum + (price - 7.75) * qty : sum;
              }, 0) : 0;
              const addonTotal = getChargeableExtrasTotal(
                [{ selections: extras, availableExtras: data.availableExtras || [] }],
                data.includedOats || 0,
                data.includedSweetTreats || 0,
              );
              const totalCharge = specialsSurcharge + addonTotal;
              return totalCharge > 0 ? (
                <div className="mb-2 space-y-0.5">
                  {specialsSurcharge > 0 && (
                    <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                      Premium meal surcharge: £{specialsSurcharge.toFixed(2)} — payment required at checkout
                    </p>
                  )}
                  {addonTotal > 0 && (
                    <p className="text-xs text-blue-700 dark:text-blue-300 font-medium">
                      Add-ons total: £{addonTotal.toFixed(2)} — payment required at checkout
                    </p>
                  )}
                </div>
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
