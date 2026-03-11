import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Send, CheckCircle2, Clock, Mail, Users, Eye, Pencil, Minus, Plus, UtensilsCrossed } from "lucide-react";
import { format } from "date-fns";

type Selection = {
  id: number;
  inviteId: number;
  productName: string;
  quantity: number;
};

type Invite = {
  id: number;
  orderId: number | null;
  customerEmail: string;
  customerName: string;
  token: string;
  subscriptionQuantity: number;
  status: string;
  weekFrom: string;
  weekTo: string;
  createdAt: string;
  selections: Selection[];
};

type MealData = {
  customerName: string;
  subscriptionQuantity: number;
  availableMeals: Array<{ name: string; popularity: number }>;
  selections: Array<{ productName: string; quantity: number }>;
};

export default function SubscriptionOverviewPage() {
  const { toast } = useToast();
  const [overrideEmail, setOverrideEmail] = useState("");
  const [showOverview, setShowOverview] = useState(false);
  const [editingInvite, setEditingInvite] = useState<Invite | null>(null);

  const { data: invites = [], isLoading } = useQuery<Invite[]>({
    queryKey: ["/api/subscription-invites"],
    queryFn: async () => {
      const res = await fetch("/api/subscription-invites", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const body: any = {};
      if (overrideEmail.trim()) body.overrideEmail = overrideEmail.trim();
      return apiRequest("POST", "/api/subscription-invites/send", body);
    },
    onSuccess: async (res) => {
      const data = await res.json();
      let desc = "";
      if (data.sent > 0) desc = `${data.sent} email${data.sent !== 1 ? "s" : ""} sent successfully.`;
      if (data.skipped > 0) desc += `${desc ? " " : ""}${data.skipped} already invited this week (skipped).`;
      if (data.sent === 0 && data.skipped === 0 && data.message) desc = data.message;
      if (data.errors?.length) desc += ` Errors: ${data.errors.join(", ")}`;
      toast({
        title: data.sent > 0 ? "Emails sent" : (data.skipped > 0 ? "Already sent" : "No emails sent"),
        description: desc || "No subscription customers found this week.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/subscription-invites"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  const completed = invites.filter(i => i.status === "completed");
  const pending = invites.filter(i => i.status === "pending");

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-subscriptions-title">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">Manage weekly meal subscription preferences</p>
        </div>
      </div>

      <Card data-testid="card-send-invites">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Send className="w-5 h-5 text-emerald-500" />
            Send Preference Emails
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="override-email">Override Email (optional — for testing)</Label>
            <Input
              id="override-email"
              type="email"
              value={overrideEmail}
              onChange={e => setOverrideEmail(e.target.value)}
              placeholder="Leave blank to email actual customers"
              data-testid="input-override-email"
            />
            <p className="text-xs text-muted-foreground">
              If set, all emails will be sent to this address instead of individual customers.
            </p>
          </div>
          <Button
            onClick={() => sendMutation.mutate()}
            disabled={sendMutation.isPending}
            data-testid="button-send-invites"
          >
            <Mail className="w-4 h-4 mr-2" />
            {sendMutation.isPending ? "Sending..." : "Send This Week's Emails"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-4">
        <Button
          variant={showOverview ? "default" : "outline"}
          onClick={() => setShowOverview(!showOverview)}
          data-testid="button-toggle-overview"
        >
          <Eye className="w-4 h-4 mr-2" />
          {showOverview ? "Hide Overview" : "Show Overview"}
        </Button>
        {invites.length > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <Badge variant="outline" className="gap-1">
              <Users className="w-3 h-3" /> {invites.length} total
            </Badge>
            <Badge className="gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
              <CheckCircle2 className="w-3 h-3" /> {completed.length} chosen
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Clock className="w-3 h-3" /> {pending.length} waiting
            </Badge>
          </div>
        )}
      </div>

      {showOverview && (
        <div className="space-y-4">
          {isLoading ? (
            <Card>
              <CardContent className="p-6">
                <div className="h-8 w-48 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ) : invites.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-center text-muted-foreground">
                No subscription invites sent yet this week. Use the button above to send them.
              </CardContent>
            </Card>
          ) : (
            <>
              {completed.length > 0 && (
                <Card className="border-l-4 border-l-emerald-500" data-testid="card-completed-invites">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      Chosen ({completed.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {completed.map(invite => (
                        <div key={invite.id} className="flex items-start justify-between p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20" data-testid={`invite-completed-${invite.id}`}>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium">{invite.customerName}</p>
                            <p className="text-xs text-muted-foreground">{invite.customerEmail}</p>
                            <div className="flex flex-wrap gap-1 mt-2">
                              {invite.selections.map((sel, idx) => (
                                <Badge key={idx} variant="secondary" className="text-xs">
                                  {sel.productName} ×{sel.quantity}
                                </Badge>
                              ))}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-3 shrink-0">
                            <Badge className="bg-emerald-500 text-white">
                              {invite.selections.reduce((s, sel) => s + sel.quantity, 0)}/{invite.subscriptionQuantity}
                            </Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => setEditingInvite(invite)}
                              data-testid={`button-edit-invite-${invite.id}`}
                            >
                              <Pencil className="w-3 h-3 mr-1" />
                              Edit
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {pending.length > 0 && (
                <Card className="border-l-4 border-l-amber-500" data-testid="card-pending-invites">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="w-4 h-4 text-amber-500" />
                      Waiting ({pending.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {pending.map(invite => (
                        <div key={invite.id} className="flex items-center justify-between p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20" data-testid={`invite-pending-${invite.id}`}>
                          <div>
                            <p className="font-medium">{invite.customerName}</p>
                            <p className="text-xs text-muted-foreground">{invite.customerEmail}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-right">
                              <Badge variant="outline" className="text-amber-600 border-amber-300">
                                {invite.subscriptionQuantity} meals
                              </Badge>
                              <p className="text-xs text-muted-foreground mt-1">
                                Sent {format(new Date(invite.createdAt), "EEE d MMM, HH:mm")}
                              </p>
                            </div>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => setEditingInvite(invite)}
                              data-testid={`button-edit-invite-${invite.id}`}
                            >
                              <Pencil className="w-3 h-3 mr-1" />
                              Fill In
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {editingInvite && (
        <AdminSelectionDialog
          invite={editingInvite}
          open={!!editingInvite}
          onOpenChange={(v) => { if (!v) setEditingInvite(null); }}
        />
      )}
    </div>
  );
}

function AdminSelectionDialog({ invite, open, onOpenChange }: {
  invite: Invite;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [selections, setSelections] = useState<Record<string, number>>(() => {
    const initial: Record<string, number> = {};
    for (const sel of invite.selections) {
      initial[sel.productName] = sel.quantity;
    }
    return initial;
  });

  const { data: mealData, isLoading } = useQuery<MealData>({
    queryKey: ["/api/subscription-invites", invite.id, "meals"],
    queryFn: async () => {
      const res = await fetch(`/api/subscription-invites/${invite.id}/meals`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load meals");
      return res.json();
    },
    staleTime: 30000,
  });

  const saveMutation = useMutation({
    mutationFn: (sels: Array<{ productName: string; quantity: number }>) =>
      apiRequest("PATCH", `/api/subscription-invites/${invite.id}/selections`, { selections: sels }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription-invites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: `Meals saved for ${invite.customerName}` });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  const maxMeals = invite.subscriptionQuantity;
  const totalSelected = Object.values(selections).reduce((sum, q) => sum + q, 0);
  const remaining = maxMeals - totalSelected;

  const addMeal = (name: string) => {
    if (remaining <= 0) return;
    setSelections(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 }));
  };

  const removeMeal = (name: string) => {
    setSelections(prev => {
      const current = prev[name] || 0;
      if (current <= 1) {
        const { [name]: _, ...rest } = prev;
        return rest;
      }
      return { ...prev, [name]: current - 1 };
    });
  };

  const handleSave = () => {
    const sels = Object.entries(selections)
      .filter(([_, q]) => q > 0)
      .map(([productName, quantity]) => ({ productName, quantity }));
    if (sels.length === 0) {
      toast({ title: "Select at least one meal", variant: "destructive" });
      return;
    }
    saveMutation.mutate(sels);
  };

  const availableMeals = mealData?.availableMeals || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UtensilsCrossed className="w-4 h-4" />
            {invite.customerName}'s Meals
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-center mb-2">
          <Badge
            className={`text-sm px-3 py-1 ${remaining === 0 ? "bg-emerald-500 text-white" : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"}`}
            data-testid="badge-admin-remaining"
          >
            {remaining === 0 ? `All ${maxMeals} chosen` : `${remaining} of ${maxMeals} remaining`}
          </Badge>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : availableMeals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <UtensilsCrossed className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No meals available for this week yet.</p>
            <p className="text-xs mt-1">Meals appear once orders are synced from WooCommerce.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {availableMeals.map((meal) => {
              const qty = selections[meal.name] || 0;
              const isSelected = qty > 0;
              return (
                <div
                  key={meal.name}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-all ${isSelected ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20" : "border-border"}`}
                  data-testid={`meal-row-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  <p className="font-medium text-sm flex-1 min-w-0 truncate pr-2">{meal.name}</p>
                  <div className="flex items-center gap-1 shrink-0">
                    {isSelected ? (
                      <>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 rounded-full"
                          onClick={() => removeMeal(meal.name)}
                          data-testid={`button-admin-remove-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          <Minus className="w-3 h-3" />
                        </Button>
                        <span className="w-6 text-center font-bold text-sm" data-testid={`text-admin-qty-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>
                          {qty}
                        </span>
                        <Button
                          size="icon"
                          variant="outline"
                          className="h-7 w-7 rounded-full"
                          onClick={() => addMeal(meal.name)}
                          disabled={remaining <= 0}
                          data-testid={`button-admin-add-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}
                        >
                          <Plus className="w-3 h-3" />
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => addMeal(meal.name)}
                        disabled={remaining <= 0}
                        className="h-7 text-xs text-emerald-600 border-emerald-300"
                        data-testid={`button-admin-select-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        <Plus className="w-3 h-3 mr-1" />
                        Add
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {totalSelected > 0 && (
          <div className="border-t pt-3 mt-2">
            <div className="flex flex-wrap gap-1 mb-3">
              {Object.entries(selections).filter(([_, q]) => q > 0).map(([name, qty]) => (
                <Badge key={name} variant="secondary" className="text-xs">
                  {name} ×{qty}
                </Badge>
              ))}
            </div>
            <Button
              className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={handleSave}
              disabled={saveMutation.isPending}
              data-testid="button-save-admin-selections"
            >
              {saveMutation.isPending ? "Saving..." : `Save ${totalSelected} Meal${totalSelected !== 1 ? "s" : ""} for ${invite.customerName}`}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
