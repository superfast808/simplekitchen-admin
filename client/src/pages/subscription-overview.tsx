import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Send, CheckCircle2, Clock, Mail, Pencil, Minus, Plus, UtensilsCrossed, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, RotateCcw, CreditCard, ExternalLink, Trash2, X, ListPlus, RefreshCw, UserPlus, Users } from "lucide-react";
import { format, addWeeks } from "date-fns";

type Selection = {
  id: number;
  inviteId: number;
  productName: string;
  quantity: number;
  deliveryDay?: string;
};

type Invite = {
  id: number;
  orderId: number | null;
  selectionsOrderId?: number | null;
  orderMissing?: boolean;
  customerEmail: string;
  customerName: string;
  token: string;
  subscriptionQuantity: number;
  status: string;
  weekFrom: string;
  weekTo: string;
  createdAt: string;
  selections: Selection[];
  addonPaid?: boolean;
  addonAmountPence?: number;
  computedAddonAmountPence?: number;
  addonPaymentToken?: string;
  stripePaymentIntentId?: string;
  isTuesday?: boolean;
  isDual?: boolean;
  subscriberId?: number | null;
};

type Subscriber = {
  id: number;
  customerName: string;
  customerEmail: string;
  deliveryDay: string;
  quantity: number;
  paymentIntervalWeeks: number;
  active: boolean;
  lastPaymentSentAt: string | null;
  nextPaymentDueAt: string | null;
  notes: string | null;
  createdAt: string;
};

type MealData = {
  customerName: string;
  subscriptionQuantity: number;
  isTuesday?: boolean;
  isDual?: boolean;
  weekNumber?: number;
  categoryName?: string;
  availableMeals: Array<{ name: string; popularity: number }>;
  availableExtras: Array<{ name: string; popularity: number }>;
  selections: Array<{ productName: string; quantity: number; deliveryDay?: string }>;
  satSelections?: Array<{ productName: string; quantity: number }>;
  tueSelections?: Array<{ productName: string; quantity: number }>;
  tuesdaySelectionsOrderId?: number | null;
};

function getCurrentWeekRange(offsetWeeks: number = 0): { from: Date; to: Date } {
  // Use UTC throughout so dates match what the backend stores (server runs in UTC).
  const now = new Date();
  const day = now.getUTCDay();
  // Find the most recent or upcoming Saturday (day 6)
  const daysUntilSat = (6 - day + 7) % 7;
  const daysFromSat = day === 6 ? 0 : -(7 - daysUntilSat);
  let satOffset = 0;
  if (day >= 4 && day < 6) {
    // Thu/Fri — upcoming Saturday
    satOffset = daysUntilSat;
  } else if (day === 0 || day === 1 || day === 2 || day === 3) {
    // Sun–Wed — last Saturday
    satOffset = daysFromSat;
  }
  // day === 6 → satOffset = 0 (today is Saturday)
  const satUtcDate = now.getUTCDate() + satOffset + offsetWeeks * 7;
  // Build UTC-anchored dates to match backend storage
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), satUtcDate, 0, 0, 0, 0));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), satUtcDate + 4, 23, 59, 59, 999));
  return { from, to };
}

export default function SubscriptionOverviewPage() {
  const { toast } = useToast();
  const [overrideEmail, setOverrideEmail] = useState("");
  const [showSendPanel, setShowSendPanel] = useState(false);
  const [editingInvite, setEditingInvite] = useState<Invite | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [sendingPaymentLinkId, setSendingPaymentLinkId] = useState<number | null>(null);
  const [resettingId, setResettingId] = useState<number | null>(null);
  const [confirmResetId, setConfirmResetId] = useState<number | null>(null);
  const [receiptingId, setReceiptingId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [recoveringId, setRecoveringId] = useState<number | null>(null);
  const [regenLoadingId, setRegenLoadingId] = useState<number | null>(null);
  type RegenPreview = { oldAmountPence: number; newAmountPence: number; lineItems: Array<{ name: string; pricePence: number; quantity: number; reason: string }>; hasExistingSession: boolean };
  const [regenDialog, setRegenDialog] = useState<{ invite: Invite; preview: RegenPreview } | null>(null);

  const weekRange = getCurrentWeekRange(weekOffset);
  const isCurrentWeek = weekOffset === 0;

  const { data: invites = [], isLoading } = useQuery<Invite[]>({
    queryKey: ["/api/subscription-invites", weekRange.from.toISOString(), weekRange.to.toISOString()],
    queryFn: async () => {
      const url = `/api/subscription-invites?from=${weekRange.from.toISOString()}&to=${weekRange.to.toISOString()}`;
      const res = await fetch(url, { credentials: "include" });
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
      setShowSendPanel(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send", description: err.message, variant: "destructive" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: async (inviteId: number) => {
      return apiRequest("POST", `/api/subscription-invites/${inviteId}/resend`, {});
    },
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Email resent", description: `Resent to ${data.to}` });
      setResendingId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to resend", description: err.message, variant: "destructive" });
      setResendingId(null);
    },
  });

  const receiptMutation = useMutation({
    mutationFn: async (inviteId: number) => {
      return apiRequest("POST", `/api/subscription-invites/${inviteId}/resend-receipt`, {});
    },
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Receipt sent", description: `Sent to ${data.to}` });
      setReceiptingId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to send receipt", description: err.message, variant: "destructive" });
      setReceiptingId(null);
    },
  });

  const sendPaymentLinkMutation = useMutation({
    mutationFn: async ({ inviteId, amountPence, items }: { inviteId: number; amountPence: number; items: Array<{ name: string; pricePence: number; quantity: number }> }) => {
      return apiRequest("POST", `/api/subscription-invites/${inviteId}/send-payment-link`, { amountPence, items });
    },
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Payment link sent", description: `Sent to ${data.to}` });
      setSendingPaymentLinkId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription-invites"] });
    },
    onError: (err: Error) => {
      let description = err.message;
      try {
        const jsonPart = err.message.replace(/^\d+:\s*/, "");
        const parsed = JSON.parse(jsonPart);
        if (parsed?.message) description = parsed.message;
      } catch {}
      toast({ title: "Failed to send payment link", description, variant: "destructive" });
      setSendingPaymentLinkId(null);
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (inviteId: number) => {
      return apiRequest("POST", `/api/subscription-invites/${inviteId}/reset`, {});
    },
    onSuccess: async (res) => {
      const data = await res.json();
      toast({
        title: "Selections wiped",
        description: data.emailSent
          ? "Meal choices cleared and invite email resent."
          : "Meal choices cleared. (Email not sent — SMTP not configured.)",
      });
      setResettingId(null);
      setConfirmResetId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription-invites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders/"] });
    },
    onError: (err: Error) => {
      let description = err.message;
      try {
        const parsed = JSON.parse(err.message.replace(/^\d+:\s*/, ""));
        if (parsed?.message) description = parsed.message;
      } catch {}
      toast({ title: "Failed to reset", description, variant: "destructive" });
      setResettingId(null);
      setConfirmResetId(null);
    },
  });

  const recoverOrderMutation = useMutation({
    mutationFn: async (inviteId: number) => {
      return apiRequest("POST", `/api/subscription-invites/${inviteId}/recover-order`, {});
    },
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Order recovered", description: `Manual order #${data.orderId} created from saved selections.` });
      setRecoveringId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription-invites"] });
    },
    onError: (err: Error) => {
      let description = err.message;
      try {
        const parsed = JSON.parse(err.message.replace(/^\d+:\s*/, ""));
        if (parsed?.message) description = parsed.message;
      } catch {}
      toast({ title: "Failed to recover order", description, variant: "destructive" });
      setRecoveringId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (inviteId: number) => {
      return apiRequest("DELETE", `/api/subscription-invites/${inviteId}`, {});
    },
    onSuccess: () => {
      toast({ title: "Invite deleted" });
      setDeletingId(null);
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription-invites"] });
    },
    onError: (err: Error) => {
      let description = err.message;
      try {
        const parsed = JSON.parse(err.message.replace(/^\d+:\s*/, ""));
        if (parsed?.message) description = parsed.message;
      } catch {}
      toast({ title: "Failed to delete", description, variant: "destructive" });
      setDeletingId(null);
      setConfirmDeleteId(null);
    },
  });

  // ── Subscribers state ──────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState("invites");
  const [subDialog, setSubDialog] = useState<{ open: boolean; editing: Subscriber | null }>({ open: false, editing: null });
  const [subForm, setSubForm] = useState({ customerName: "", customerEmail: "", deliveryDay: "sat", quantity: "1", paymentIntervalWeeks: "1", deliveryAddress: "", deliveryFeePence: "0", notes: "" });
  const [sendingSubPaymentId, setSendingSubPaymentId] = useState<number | null>(null);
  const [confirmDeleteSubId, setConfirmDeleteSubId] = useState<number | null>(null);

  const { data: subscribersList = [], isLoading: subsLoading } = useQuery<Subscriber[]>({
    queryKey: ["/api/subscribers"],
    queryFn: async () => {
      const res = await fetch("/api/subscribers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const createSubMutation = useMutation({
    mutationFn: async (body: typeof subForm) => apiRequest("POST", "/api/subscribers", { ...body, quantity: parseInt(body.quantity), paymentIntervalWeeks: parseInt(body.paymentIntervalWeeks) }),
    onSuccess: async () => {
      toast({ title: "Subscriber added" });
      setSubDialog({ open: false, editing: null });
      queryClient.invalidateQueries({ queryKey: ["/api/subscribers"] });
    },
    onError: (err: Error) => toast({ title: "Failed to add subscriber", description: err.message, variant: "destructive" }),
  });

  const updateSubMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Subscriber> }) => apiRequest("PATCH", `/api/subscribers/${id}`, data),
    onSuccess: async () => {
      toast({ title: "Subscriber updated" });
      setSubDialog({ open: false, editing: null });
      queryClient.invalidateQueries({ queryKey: ["/api/subscribers"] });
    },
    onError: (err: Error) => toast({ title: "Failed to update", description: err.message, variant: "destructive" }),
  });

  const deleteSubMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/subscribers/${id}`, {}),
    onSuccess: () => {
      toast({ title: "Subscriber removed" });
      setConfirmDeleteSubId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/subscribers"] });
    },
    onError: (err: Error) => toast({ title: "Failed to remove", description: err.message, variant: "destructive" }),
  });

  const sendSubPaymentMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("POST", `/api/subscribers/${id}/send-payment-link`, {}),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Payment link sent", description: `£${(data.amountPence / 100).toFixed(2)} link sent to ${data.to}` });
      setSendingSubPaymentId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/subscribers"] });
    },
    onError: (err: Error) => {
      let description = err.message;
      try { const p = JSON.parse(err.message.replace(/^\d+:\s*/, "")); if (p?.message) description = p.message; } catch {}
      toast({ title: "Failed to send payment link", description, variant: "destructive" });
      setSendingSubPaymentId(null);
    },
  });

  const openAddSub = () => {
    setSubForm({ customerName: "", customerEmail: "", deliveryDay: "sat", quantity: "1", paymentIntervalWeeks: "1", deliveryAddress: "", deliveryFeePence: "0", notes: "" });
    setSubDialog({ open: true, editing: null });
  };

  const openEditSub = (sub: Subscriber) => {
    setSubForm({ customerName: sub.customerName, customerEmail: sub.customerEmail, deliveryDay: sub.deliveryDay, quantity: String(sub.quantity), paymentIntervalWeeks: String(sub.paymentIntervalWeeks), deliveryAddress: sub.deliveryAddress || "", deliveryFeePence: String(sub.deliveryFeePence ?? 0), notes: sub.notes || "" });
    setSubDialog({ open: true, editing: sub });
  };

  const submitSubForm = () => {
    const payload = { ...subForm, quantity: parseInt(subForm.quantity), paymentIntervalWeeks: parseInt(subForm.paymentIntervalWeeks), deliveryFeePence: Math.round(parseFloat(subForm.deliveryFeePence || "0") * 100) };
    if (subDialog.editing) {
      updateSubMutation.mutate({ id: subDialog.editing.id, data: payload as any });
    } else {
      createSubMutation.mutate(payload as any);
    }
  };

  const regenPaymentMutation = useMutation({
    mutationFn: async (inviteId: number) => {
      return apiRequest("POST", `/api/subscription-invites/${inviteId}/regenerate-payment`, {});
    },
    onSuccess: async (res) => {
      const data = await res.json();
      const oldGbp = (data.oldAmountPence / 100).toFixed(2);
      const newGbp = (data.newAmountPence / 100).toFixed(2);
      toast({ title: "Payment regenerated", description: `Session updated from £${oldGbp} → £${newGbp}. Email sent to ${data.to}.` });
      setRegenDialog(null);
      queryClient.invalidateQueries({ queryKey: ["/api/subscription-invites"] });
    },
    onError: (err: Error) => {
      let description = err.message;
      try { const p = JSON.parse(err.message.replace(/^\d+:\s*/, "")); if (p?.message) description = p.message; } catch {}
      toast({ title: "Failed to regenerate payment", description, variant: "destructive" });
      setRegenDialog(null);
    },
  });

  const handleRegenClick = async (invite: Invite) => {
    setRegenLoadingId(invite.id);
    try {
      const res = await fetch(`/api/subscription-invites/${invite.id}/regenerate-payment-preview`, { credentials: "include" });
      const preview: RegenPreview = await res.json();
      if (!res.ok) throw new Error((preview as any).message || "Failed to load preview");
      setRegenDialog({ invite, preview });
    } catch (e: any) {
      toast({ title: "Could not load preview", description: e.message, variant: "destructive" });
    } finally {
      setRegenLoadingId(null);
    }
  };

  const completed = invites.filter(i => i.status === "completed");
  const pending = invites.filter(i => i.status === "pending");

  const weekLabel = isCurrentWeek
    ? `This week (${format(weekRange.from, "d MMM")} – ${format(weekRange.to, "d MMM")})`
    : weekOffset < 0
      ? `${Math.abs(weekOffset)} week${Math.abs(weekOffset) > 1 ? "s" : ""} ago (${format(weekRange.from, "d MMM")} – ${format(weekRange.to, "d MMM")})`
      : `${weekOffset} week${weekOffset > 1 ? "s" : ""} ahead (${format(weekRange.from, "d MMM")} – ${format(weekRange.to, "d MMM")})`;

  const DAY_LABELS: Record<string, string> = { sat: "Saturday", tue: "Tuesday", dual: "Sat + Tue" };
  const INTERVAL_LABELS: Record<number, string> = { 1: "Weekly", 2: "Every 2 wks", 4: "Every 4 wks" };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">

      {/* Subscriber form dialog */}
      <Dialog open={subDialog.open} onOpenChange={(v) => setSubDialog(d => ({ ...d, open: v }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{subDialog.editing ? "Edit Subscriber" : "Add Subscriber"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Customer name</Label>
              <Input value={subForm.customerName} onChange={e => setSubForm(f => ({ ...f, customerName: e.target.value }))} placeholder="Jane Smith" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={subForm.customerEmail} onChange={e => setSubForm(f => ({ ...f, customerEmail: e.target.value }))} placeholder="jane@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Delivery day</Label>
                <Select value={subForm.deliveryDay} onValueChange={v => setSubForm(f => ({ ...f, deliveryDay: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sat">Saturday</SelectItem>
                    <SelectItem value="tue">Tuesday</SelectItem>
                    <SelectItem value="dual">Sat + Tue</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Meals / week</Label>
                <Input type="number" min="1" max="30" value={subForm.quantity} onChange={e => setSubForm(f => ({ ...f, quantity: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Payment interval</Label>
              <Select value={subForm.paymentIntervalWeeks} onValueChange={v => setSubForm(f => ({ ...f, paymentIntervalWeeks: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Every week</SelectItem>
                  <SelectItem value="2">Every 2 weeks</SelectItem>
                  <SelectItem value="4">Every 4 weeks</SelectItem>
                </SelectContent>
              </Select>
              {(() => {
                const meals = parseInt(subForm.quantity || "0") * 7.75 * parseInt(subForm.paymentIntervalWeeks || "1");
                const delivery = parseFloat(subForm.deliveryFeePence || "0");
                const total = meals + delivery;
                return (
                  <p className="text-xs text-muted-foreground">
                    {subForm.quantity || 0} meals × £7.75 × {subForm.paymentIntervalWeeks} wk{parseInt(subForm.paymentIntervalWeeks) > 1 ? "s" : ""}
                    {delivery > 0 ? ` + £${delivery.toFixed(2)} delivery` : ""}
                    {" = "}<strong>£{total.toFixed(2)}</strong>
                  </p>
                );
              })()}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Delivery fee (£)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={subForm.deliveryFeePence}
                  onChange={e => setSubForm(f => ({ ...f, deliveryFeePence: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Delivery address (optional)</Label>
              <Textarea value={subForm.deliveryAddress} onChange={e => setSubForm(f => ({ ...f, deliveryAddress: e.target.value }))} placeholder="123 Example St, City, Postcode" rows={2} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea value={subForm.notes} onChange={e => setSubForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any notes…" rows={2} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setSubDialog(d => ({ ...d, open: false }))}>Cancel</Button>
            <Button
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={!subForm.customerName || !subForm.customerEmail || createSubMutation.isPending || updateSubMutation.isPending}
              onClick={submitSubForm}
            >
              {(createSubMutation.isPending || updateSubMutation.isPending) ? <RotateCcw className="w-3 h-3 animate-spin mr-1" /> : null}
              {subDialog.editing ? "Save changes" : "Add subscriber"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Regenerate Payment Confirmation Dialog */}
      {regenDialog && (
        <Dialog open onOpenChange={() => setRegenDialog(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Correct payment for {regenDialog.invite.customerName}?</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg px-4 py-3">
                <span className="text-muted-foreground">Current session</span>
                <span className="font-semibold text-orange-700 dark:text-orange-400 line-through">
                  £{(regenDialog.preview.oldAmountPence / 100).toFixed(2)}
                </span>
              </div>
              <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-3">
                <span className="text-muted-foreground">Correct amount</span>
                <span className="font-semibold text-emerald-700 dark:text-emerald-400">
                  £{(regenDialog.preview.newAmountPence / 100).toFixed(2)}
                </span>
              </div>
              {regenDialog.preview.lineItems.length > 0 && (
                <div className="border rounded-lg divide-y text-xs">
                  {regenDialog.preview.lineItems.map((item, i) => (
                    <div key={i} className="flex items-start justify-between px-3 py-2 gap-2">
                      <div>
                        <p className="font-medium">{item.name} ×{item.quantity}</p>
                        <p className="text-muted-foreground">{item.reason}</p>
                      </div>
                      <span className="shrink-0 font-medium">£{((item.pricePence * item.quantity) / 100).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-muted-foreground text-xs">
                {regenDialog.preview.hasExistingSession
                  ? "The old Stripe session will be cancelled and a new one created."
                  : "A new Stripe payment session will be created."}{" "}
                A payment email will be sent to {regenDialog.invite.customerEmail}.
              </p>
            </div>
            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" size="sm" onClick={() => setRegenDialog(null)}>Cancel</Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={regenPaymentMutation.isPending}
                onClick={() => regenPaymentMutation.mutate(regenDialog.invite.id)}
              >
                {regenPaymentMutation.isPending ? <RotateCcw className="w-3 h-3 animate-spin mr-1" /> : null}
                Confirm & send
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-subscriptions-title">Subscriptions</h1>
          <p className="text-sm text-muted-foreground">Manage weekly meal preferences for subscription customers</p>
        </div>
        <div className="flex items-center gap-3">
          {invites.length > 0 && (
            <>
              <Badge className="gap-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                <CheckCircle2 className="w-3 h-3" /> {completed.length} chosen
              </Badge>
              <Badge variant="secondary" className="gap-1">
                <Clock className="w-3 h-3" /> {pending.length} waiting
              </Badge>
            </>
          )}
          {isCurrentWeek && (
            <Button
              onClick={() => setShowSendPanel(v => !v)}
              variant="outline"
              size="sm"
              data-testid="button-toggle-send-panel"
            >
              <Mail className="w-4 h-4 mr-2" />
              Send Emails
              {showSendPanel ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="invites">Invites</TabsTrigger>
          <TabsTrigger value="subscribers" className="gap-1.5">
            <Users className="w-3.5 h-3.5" />Subscribers
            {subscribersList.length > 0 && (
              <span className="ml-1 text-xs bg-muted rounded-full px-1.5 py-0.5 font-medium">{subscribersList.filter(s => s.active).length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invites" className="space-y-6 mt-4">

      {/* Week navigation */}
      <div className="flex items-center justify-between bg-muted/40 rounded-lg px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWeekOffset(w => w - 1)}
          data-testid="button-prev-week"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />Previous
        </Button>
        <span className="text-sm font-medium" data-testid="text-week-label">{weekLabel}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setWeekOffset(w => w + 1)}
          disabled={weekOffset >= 0}
          data-testid="button-next-week"
        >
          Next<ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {isCurrentWeek && showSendPanel && (
        <Card data-testid="card-send-invites">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="w-4 h-4 text-emerald-500" />
              Send This Week's Preference Emails
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
              {sendMutation.isPending ? "Sending..." : "Send Emails"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : invites.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground space-y-3">
              <UtensilsCrossed className="w-10 h-10 mx-auto opacity-30" />
              {isCurrentWeek ? (
                <>
                  <p className="font-medium">New week — no preference emails sent yet</p>
                  <p className="text-sm">Click "Send Emails" above to send this week's meal choice emails to all subscription customers.</p>
                  <Button
                    onClick={() => setShowSendPanel(true)}
                    className="mt-2"
                    data-testid="button-send-invites-empty"
                  >
                    <Mail className="w-4 h-4 mr-2" />
                    Send This Week's Emails
                  </Button>
                </>
              ) : (
                <>
                  <p className="font-medium">No subscription invites for this week</p>
                  <p className="text-sm">No preference emails were sent for the week of {format(weekRange.from, "d MMM yyyy")}.</p>
                </>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-center">Meals</TableHead>
                  <TableHead>Selections</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="w-[160px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.map(invite => {
                  const isComplete = invite.status === "completed";
                  const totalSelected = invite.selections.reduce((s, sel) => s + sel.quantity, 0);
                  const effectiveAddonPence = invite.addonAmountPence ?? invite.computedAddonAmountPence ?? 0;
                  const hasUnpaidAddon = isComplete && effectiveAddonPence >= 50 && !invite.addonPaid;
                  const addonAmountGbp = effectiveAddonPence > 0 ? (effectiveAddonPence / 100).toFixed(2) : "0.00";
                  return (
                    <TableRow key={invite.id} data-testid={`invite-row-${invite.id}`}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {invite.customerName}
                          {invite.subscriberId && (
                            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                              Manual
                            </span>
                          )}
                          {invite.isDual ? (
                            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                              Sat+Tue
                            </span>
                          ) : invite.isTuesday !== undefined && (
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${invite.isTuesday ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" : "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"}`}>
                              {invite.isTuesday ? "Tue" : "Sat"}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{invite.customerEmail}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs">
                          {isComplete ? `${totalSelected}/` : ""}{invite.subscriptionQuantity}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {isComplete ? (
                          <div className="flex flex-wrap gap-1">
                            {invite.selections.map((sel, idx) => (
                              <Badge key={idx} variant="secondary" className="text-xs">
                                {sel.productName} ×{sel.quantity}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">
                            Sent {format(new Date(invite.createdAt), "EEE d MMM, HH:mm")}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          {isComplete ? (
                            <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Chosen
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1">
                              <Clock className="w-3 h-3" /> Waiting
                            </Badge>
                          )}
                          {isComplete && effectiveAddonPence >= 50 ? (
                            invite.addonPaid ? (
                              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 gap-1 text-xs">
                                <CreditCard className="w-3 h-3" /> £{addonAmountGbp} paid
                              </Badge>
                            ) : (
                              <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 gap-1 text-xs">
                                <CreditCard className="w-3 h-3" /> £{addonAmountGbp} unpaid
                              </Badge>
                            )
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          <Button
                            size="sm"
                            variant={isComplete ? "outline" : "default"}
                            className="h-7 text-xs flex-1"
                            onClick={() => setEditingInvite(invite)}
                            data-testid={`button-edit-invite-${invite.id}`}
                          >
                            <Pencil className="w-3 h-3 mr-1" />
                            {isComplete ? "Edit" : "Fill in"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs px-2"
                            title="Resend invitation email"
                            disabled={resendingId === invite.id && resendMutation.isPending}
                            onClick={() => {
                              setResendingId(invite.id);
                              resendMutation.mutate(invite.id);
                            }}
                            data-testid={`button-resend-invite-${invite.id}`}
                          >
                            <RotateCcw className={`w-3 h-3 ${resendingId === invite.id && resendMutation.isPending ? "animate-spin" : ""}`} />
                          </Button>
                          {isComplete && invite.orderMissing && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2 border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400"
                              title="Meals chosen but order is missing — click to recreate it"
                              disabled={recoveringId === invite.id && recoverOrderMutation.isPending}
                              onClick={() => {
                                setRecoveringId(invite.id);
                                recoverOrderMutation.mutate(invite.id);
                              }}
                              data-testid={`button-recover-order-${invite.id}`}
                            >
                              {recoveringId === invite.id && recoverOrderMutation.isPending
                                ? <RotateCcw className="w-3 h-3 animate-spin" />
                                : <ListPlus className="w-3 h-3" />}
                            </Button>
                          )}
                          {isComplete && invite.addonPaid && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2 border-emerald-300 text-emerald-700"
                              title="Re-issue payment receipt"
                              disabled={receiptingId === invite.id && receiptMutation.isPending}
                              onClick={() => {
                                setReceiptingId(invite.id);
                                receiptMutation.mutate(invite.id);
                              }}
                              data-testid={`button-resend-receipt-${invite.id}`}
                            >
                              <Mail className={`w-3 h-3 ${receiptingId === invite.id && receiptMutation.isPending ? "animate-pulse" : ""}`} />
                            </Button>
                          )}
                          {confirmResetId === invite.id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-red-600 whitespace-nowrap">Wipe choices?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-xs px-2"
                                disabled={resettingId === invite.id && resetMutation.isPending}
                                onClick={() => {
                                  setResettingId(invite.id);
                                  resetMutation.mutate(invite.id);
                                }}
                                data-testid={`button-confirm-reset-${invite.id}`}
                              >
                                {resettingId === invite.id && resetMutation.isPending ? (
                                  <RotateCcw className="w-3 h-3 animate-spin" />
                                ) : "Yes"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-2"
                                onClick={() => setConfirmResetId(null)}
                                data-testid={`button-cancel-reset-${invite.id}`}
                              >
                                No
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2 border-red-200 text-red-600"
                              title="Wipe meal choices and resend invite"
                              onClick={() => setConfirmResetId(invite.id)}
                              data-testid={`button-reset-invite-${invite.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                          {hasUnpaidAddon && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2 border-orange-300 text-orange-700"
                              title={`Send payment link for £${addonAmountGbp}`}
                              disabled={sendingPaymentLinkId === invite.id && sendPaymentLinkMutation.isPending}
                              onClick={() => {
                                setSendingPaymentLinkId(invite.id);
                                sendPaymentLinkMutation.mutate({
                                  inviteId: invite.id,
                                  amountPence: effectiveAddonPence,
                                  items: [],
                                });
                              }}
                              data-testid={`button-send-payment-link-${invite.id}`}
                            >
                              {sendingPaymentLinkId === invite.id && sendPaymentLinkMutation.isPending ? (
                                <RotateCcw className="w-3 h-3 animate-spin" />
                              ) : (
                                <CreditCard className="w-3 h-3" />
                              )}
                            </Button>
                          )}
                          {hasUnpaidAddon && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2 border-amber-400 text-amber-700 dark:border-amber-600 dark:text-amber-400"
                              title="Recalculate & correct this payment session"
                              disabled={regenLoadingId === invite.id}
                              onClick={() => handleRegenClick(invite)}
                              data-testid={`button-regen-payment-${invite.id}`}
                            >
                              {regenLoadingId === invite.id
                                ? <RotateCcw className="w-3 h-3 animate-spin" />
                                : <RefreshCw className="w-3 h-3" />}
                            </Button>
                          )}
                          {confirmDeleteId === invite.id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-red-600 whitespace-nowrap">Delete invite?</span>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="h-7 text-xs px-2"
                                disabled={deletingId === invite.id && deleteMutation.isPending}
                                onClick={() => {
                                  setDeletingId(invite.id);
                                  deleteMutation.mutate(invite.id);
                                }}
                                data-testid={`button-confirm-delete-invite-${invite.id}`}
                              >
                                {deletingId === invite.id && deleteMutation.isPending ? (
                                  <RotateCcw className="w-3 h-3 animate-spin" />
                                ) : "Yes"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs px-2"
                                onClick={() => setConfirmDeleteId(null)}
                                data-testid={`button-cancel-delete-invite-${invite.id}`}
                              >
                                No
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                              title="Delete this invite record"
                              onClick={() => setConfirmDeleteId(invite.id)}
                              data-testid={`button-delete-invite-${invite.id}`}
                            >
                              <X className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

        </TabsContent>

        {/* ─── Subscribers tab ─────────────────────────────────────────── */}
        <TabsContent value="subscribers" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Manual Subscribers</h2>
              <p className="text-xs text-muted-foreground">Subscribers managed independently of WooCommerce. Weekly invites &amp; payments are sent automatically.</p>
            </div>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1" onClick={openAddSub}>
              <UserPlus className="w-4 h-4" />Add Subscriber
            </Button>
          </div>

          <Card>
            <CardContent className="p-0">
              {subsLoading ? (
                <div className="p-6 space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
              ) : subscribersList.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground space-y-3">
                  <Users className="w-10 h-10 mx-auto opacity-30" />
                  <p className="font-medium">No manual subscribers yet</p>
                  <p className="text-sm">Add a subscriber to start sending automatic weekly invites and payment links.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="text-center">Day</TableHead>
                      <TableHead className="text-center">Meals</TableHead>
                      <TableHead className="text-center">Payment</TableHead>
                      <TableHead className="text-center">Last paid</TableHead>
                      <TableHead className="text-center">Next due</TableHead>
                      <TableHead className="text-center">Active</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscribersList.map(sub => (
                      <TableRow key={sub.id} className={!sub.active ? "opacity-50" : ""}>
                        <TableCell className="font-medium">{sub.customerName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{sub.customerEmail}</TableCell>
                        <TableCell className="text-center">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                            sub.deliveryDay === "dual" ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300" :
                            sub.deliveryDay === "tue" ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300" :
                            "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300"
                          }`}>
                            {DAY_LABELS[sub.deliveryDay] ?? sub.deliveryDay}
                          </span>
                        </TableCell>
                        <TableCell className="text-center font-medium">{sub.quantity}</TableCell>
                        <TableCell className="text-center">
                          <span className="text-xs text-muted-foreground">
                            £{(sub.quantity * 7.75 * sub.paymentIntervalWeeks).toFixed(2)}<br />
                            <span className="text-[10px]">{INTERVAL_LABELS[sub.paymentIntervalWeeks] ?? `Every ${sub.paymentIntervalWeeks} wks`}</span>
                          </span>
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {sub.lastPaymentSentAt ? format(new Date(sub.lastPaymentSentAt), "d MMM") : "—"}
                        </TableCell>
                        <TableCell className="text-center text-xs">
                          {sub.nextPaymentDueAt ? (
                            <span className={new Date(sub.nextPaymentDueAt) <= new Date() ? "text-red-600 font-medium" : "text-muted-foreground"}>
                              {format(new Date(sub.nextPaymentDueAt), "d MMM")}
                            </span>
                          ) : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="text-center">
                          <Switch
                            checked={sub.active}
                            onCheckedChange={v => updateSubMutation.mutate({ id: sub.id, data: { active: v } })}
                          />
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Button size="sm" variant="outline" className="h-7 text-xs px-2" title="Edit" onClick={() => openEditSub(sub)}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs px-2 text-emerald-700 border-emerald-300"
                              title="Send payment link now"
                              disabled={sendSubPaymentMutation.isPending && sendingSubPaymentId === sub.id}
                              onClick={() => { setSendingSubPaymentId(sub.id); sendSubPaymentMutation.mutate(sub.id); }}
                            >
                              {sendSubPaymentMutation.isPending && sendingSubPaymentId === sub.id
                                ? <RotateCcw className="w-3 h-3 animate-spin" />
                                : <CreditCard className="w-3 h-3" />}
                            </Button>
                            {confirmDeleteSubId === sub.id ? (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-red-600 whitespace-nowrap">Remove?</span>
                                <Button size="sm" variant="destructive" className="h-7 text-xs px-2" onClick={() => deleteSubMutation.mutate(sub.id)}>
                                  {deleteSubMutation.isPending ? <RotateCcw className="w-3 h-3 animate-spin" /> : "Yes"}
                                </Button>
                                <Button size="sm" variant="outline" className="h-7 text-xs px-2" onClick={() => setConfirmDeleteSubId(null)}>No</Button>
                              </div>
                            ) : (
                              <Button size="sm" variant="ghost" className="h-7 text-xs px-2 text-red-500 hover:text-red-700 hover:bg-red-50" title="Remove" onClick={() => setConfirmDeleteSubId(sub.id)}>
                                <X className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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

function MealRows({ meals, selections, maxMeals, onAdd, onRemove, onAddExtra, onRemoveExtra, prefix }: {
  meals: Array<{ name: string; popularity: number }>;
  selections: Record<string, number>;
  maxMeals: number;
  onAdd: (n: string) => void;
  onRemove: (n: string) => void;
  onAddExtra: (n: string) => void;
  onRemoveExtra: (n: string) => void;
  prefix: string;
}) {
  const totalSelected = Object.values(selections).reduce((s, q) => s + q, 0);
  const remaining = maxMeals - totalSelected;
  return (
    <div className="space-y-1.5">
      {meals.map((meal) => {
        const qty = selections[meal.name] || 0;
        const isSelected = qty > 0;
        return (
          <div key={meal.name}
            className={`flex items-center justify-between p-3 rounded-lg border transition-all ${isSelected ? "border-emerald-400 bg-emerald-50/50 dark:bg-emerald-950/20" : "border-border"}`}
            data-testid={`meal-row-${prefix}-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}>
            <p className="font-medium text-sm flex-1 min-w-0 truncate pr-2">{meal.name}</p>
            <div className="flex items-center gap-1 shrink-0">
              {isSelected ? (
                <>
                  <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => onRemove(meal.name)} data-testid={`button-admin-remove-${prefix}-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}><Minus className="w-3 h-3" /></Button>
                  <span className="w-6 text-center font-bold text-sm">{qty}</span>
                  <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => onAdd(meal.name)} disabled={remaining <= 0} data-testid={`button-admin-add-${prefix}-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}><Plus className="w-3 h-3" /></Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onAdd(meal.name)} disabled={remaining <= 0} className="h-7 text-xs text-emerald-600 border-emerald-300" data-testid={`button-admin-select-${prefix}-${meal.name.replace(/\s+/g, "-").toLowerCase()}`}><Plus className="w-3 h-3 mr-1" />Add</Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExtraRows({ extrasData, extras, onAdd, onRemove, prefix }: {
  extrasData: Array<{ name: string; popularity: number }>;
  extras: Record<string, number>;
  onAdd: (n: string) => void;
  onRemove: (n: string) => void;
  prefix: string;
}) {
  if (extrasData.length === 0) return null;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 pt-1">
        <div className="flex-1 border-t" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide shrink-0">Add-ons</p>
        <div className="flex-1 border-t" />
      </div>
      {extrasData.map((extra) => {
        const qty = extras[extra.name] || 0;
        const isSelected = qty > 0;
        return (
          <div key={extra.name}
            className={`flex items-center justify-between p-3 rounded-lg border transition-all ${isSelected ? "border-blue-400 bg-blue-50/50 dark:bg-blue-950/20" : "border-border"}`}
            data-testid={`extra-row-${prefix}-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}>
            <p className="font-medium text-sm flex-1 min-w-0 truncate pr-2">{extra.name}</p>
            <div className="flex items-center gap-1 shrink-0">
              {isSelected ? (
                <>
                  <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => onRemove(extra.name)} data-testid={`button-admin-remove-extra-${prefix}-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}><Minus className="w-3 h-3" /></Button>
                  <span className="w-6 text-center font-bold text-sm">{qty}</span>
                  <Button size="icon" variant="outline" className="h-7 w-7 rounded-full" onClick={() => onAdd(extra.name)} data-testid={`button-admin-add-extra-${prefix}-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}><Plus className="w-3 h-3" /></Button>
                </>
              ) : (
                <Button size="sm" variant="outline" onClick={() => onAdd(extra.name)} className="h-7 text-xs text-blue-600 border-blue-300" data-testid={`button-admin-select-extra-${prefix}-${extra.name.replace(/\s+/g, "-").toLowerCase()}`}><Plus className="w-3 h-3 mr-1" />Add</Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AdminSelectionDialog({ invite, open, onOpenChange }: {
  invite: Invite;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { toast } = useToast();
  const [localMax, setLocalMax] = useState(invite.subscriptionQuantity);

  // Single-day state
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [extras, setExtras] = useState<Record<string, number>>({});

  // Dual-day state
  const [satSelections, setSatSelections] = useState<Record<string, number>>({});
  const [satExtras, setSatExtras] = useState<Record<string, number>>({});
  const [tueSelections, setTueSelections] = useState<Record<string, number>>({});
  const [tueExtras, setTueExtras] = useState<Record<string, number>>({});

  const { data: mealData, isLoading } = useQuery<MealData>({
    queryKey: ["/api/subscription-invites", invite.id, "meals"],
    queryFn: async () => {
      const res = await fetch(`/api/subscription-invites/${invite.id}/meals`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load meals");
      return res.json();
    },
    staleTime: 30000,
  });

  useEffect(() => {
    if (!mealData) return;
    const extraSet = new Set((mealData.availableExtras || []).map(e => e.name));

    if (mealData.isDual) {
      const toMap = (arr: Array<{ productName: string; quantity: number }>, isExtra: boolean) => {
        const m: Record<string, number> = {};
        for (const s of arr || []) {
          if (isExtra ? extraSet.has(s.productName) : !extraSet.has(s.productName)) m[s.productName] = s.quantity;
        }
        return m;
      };
      setSatSelections(toMap(mealData.satSelections || [], false));
      setSatExtras(toMap(mealData.satSelections || [], true));
      setTueSelections(toMap(mealData.tueSelections || [], false));
      setTueExtras(toMap(mealData.tueSelections || [], true));
    } else {
      const mealSels: Record<string, number> = {};
      const extraSels: Record<string, number> = {};
      for (const sel of invite.selections) {
        if (extraSet.has(sel.productName)) extraSels[sel.productName] = sel.quantity;
        else mealSels[sel.productName] = sel.quantity;
      }
      setSelections(mealSels);
      setExtras(extraSels);
    }
  }, [mealData]);

  const saveMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest("PATCH", `/api/subscription-invites/${invite.id}/selections`, { ...body, subscriptionQuantity: localMax }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscription-invites"] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: `Saved selections for ${invite.customerName}` });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  const isDual = mealData?.isDual === true;

  const totalSelected = Object.values(selections).reduce((sum, q) => sum + q, 0);
  const remaining = localMax - totalSelected;
  const totalExtras = Object.values(extras).reduce((sum, q) => sum + q, 0);

  const satTotal = Object.values(satSelections).reduce((s, q) => s + q, 0);
  const tueTotal = Object.values(tueSelections).reduce((s, q) => s + q, 0);

  const makeAdd = (setter: React.Dispatch<React.SetStateAction<Record<string, number>>>, total: number) =>
    (name: string) => { if (total >= localMax) return; setter(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 })); };
  const makeRemove = (setter: React.Dispatch<React.SetStateAction<Record<string, number>>>) =>
    (name: string) => setter(prev => { const c = prev[name] || 0; if (c <= 1) { const { [name]: _, ...r } = prev; return r; } return { ...prev, [name]: c - 1 }; });
  const makeExtraAdd = (setter: React.Dispatch<React.SetStateAction<Record<string, number>>>) =>
    (name: string) => setter(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 }));
  const makeExtraRemove = (setter: React.Dispatch<React.SetStateAction<Record<string, number>>>) =>
    (name: string) => setter(prev => { const c = prev[name] || 0; if (c <= 1) { const { [name]: _, ...r } = prev; return r; } return { ...prev, [name]: c - 1 }; });

  const handleSave = () => {
    if (isDual) {
      const satSels = Object.entries(satSelections).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
      const tueSels = Object.entries(tueSelections).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
      const satExtList = Object.entries(satExtras).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
      const tueExtList = Object.entries(tueExtras).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
      if (satSels.length === 0 || tueSels.length === 0) {
        toast({ title: "Select meals for both Saturday and Tuesday", variant: "destructive" });
        return;
      }
      saveMutation.mutate({ satSelections: satSels, tueSelections: tueSels, satExtras: satExtList, tueExtras: tueExtList });
    } else {
      const sels = Object.entries(selections).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
      const extSels = Object.entries(extras).filter(([_, q]) => q > 0).map(([productName, quantity]) => ({ productName, quantity }));
      if (sels.length === 0) { toast({ title: "Select at least one meal", variant: "destructive" }); return; }
      saveMutation.mutate({ selections: sels, extras: extSels });
    }
  };

  const availableMeals = mealData?.availableMeals || [];
  const availableExtras = mealData?.availableExtras || [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <UtensilsCrossed className="w-4 h-4" />
            {invite.customerName}'s Meals
            {isDual && <Badge className="bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300 text-xs">Sat + Tue</Badge>}
            {mealData?.categoryName && (
              <span className="text-sm font-normal text-muted-foreground ml-1">— {mealData.categoryName}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/30">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Meals per delivery</p>
            <p className="text-xs text-muted-foreground mt-0.5">Adjust if extra added off-record</p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-full"
              onClick={() => setLocalMax(m => Math.max(1, m - 1))}
              disabled={isDual ? (localMax <= satTotal || localMax <= tueTotal) : localMax <= totalSelected}
              data-testid="button-decrease-max">
              <Minus className="w-3 h-3" />
            </Button>
            <span className="w-8 text-center font-bold text-lg" data-testid="text-local-max">{localMax}</span>
            <Button size="icon" variant="outline" className="h-8 w-8 rounded-full" onClick={() => setLocalMax(m => m + 1)} data-testid="button-increase-max">
              <Plus className="w-3 h-3" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-14 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : availableMeals.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <UtensilsCrossed className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No meals available for this week yet.</p>
            <p className="text-xs mt-1">Meals appear once orders are synced from WooCommerce.</p>
          </div>
        ) : isDual ? (
          <div className="space-y-4">
            {/* Saturday */}
            <div className="rounded-xl border border-orange-200 bg-orange-50/30 dark:bg-orange-950/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-orange-700 dark:text-orange-300">Saturday Delivery</span>
                <Badge className={`text-xs ${satTotal >= localMax ? "bg-emerald-500 text-white" : "bg-orange-100 text-orange-800"}`}>{satTotal}/{localMax}</Badge>
              </div>
              <MealRows meals={availableMeals} selections={satSelections} maxMeals={localMax}
                onAdd={makeAdd(setSatSelections, satTotal)} onRemove={makeRemove(setSatSelections)}
                onAddExtra={makeExtraAdd(setSatExtras)} onRemoveExtra={makeExtraRemove(setSatExtras)} prefix="sat" />
              <ExtraRows extrasData={availableExtras} extras={satExtras}
                onAdd={makeExtraAdd(setSatExtras)} onRemove={makeExtraRemove(setSatExtras)} prefix="sat-extra" />
            </div>

            {/* Tuesday */}
            <div className="rounded-xl border border-blue-200 bg-blue-50/30 dark:bg-blue-950/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-blue-700 dark:text-blue-300">Tuesday Delivery</span>
                <Badge className={`text-xs ${tueTotal >= localMax ? "bg-emerald-500 text-white" : "bg-blue-100 text-blue-800"}`}>{tueTotal}/{localMax}</Badge>
              </div>
              <MealRows meals={availableMeals} selections={tueSelections} maxMeals={localMax}
                onAdd={makeAdd(setTueSelections, tueTotal)} onRemove={makeRemove(setTueSelections)}
                onAddExtra={makeExtraAdd(setTueExtras)} onRemoveExtra={makeExtraRemove(setTueExtras)} prefix="tue" />
              <ExtraRows extrasData={availableExtras} extras={tueExtras}
                onAdd={makeExtraAdd(setTueExtras)} onRemove={makeExtraRemove(setTueExtras)} prefix="tue-extra" />
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-center">
              <Badge className={`text-sm px-3 py-1 ${remaining === 0 ? "bg-emerald-500 text-white" : "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300"}`} data-testid="badge-admin-remaining">
                {remaining === 0 ? `All ${localMax} chosen` : `${remaining} of ${localMax} remaining`}
              </Badge>
            </div>
            <MealRows meals={availableMeals} selections={selections} maxMeals={localMax}
              onAdd={(name) => { if (remaining <= 0) return; setSelections(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 })); }}
              onRemove={(name) => setSelections(prev => { const c = prev[name] || 0; if (c <= 1) { const { [name]: _, ...r } = prev; return r; } return { ...prev, [name]: c - 1 }; })}
              onAddExtra={(name) => setExtras(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 }))}
              onRemoveExtra={(name) => setExtras(prev => { const c = prev[name] || 0; if (c <= 1) { const { [name]: _, ...r } = prev; return r; } return { ...prev, [name]: c - 1 }; })}
              prefix="single" />
            <ExtraRows extrasData={availableExtras} extras={extras}
              onAdd={(name) => setExtras(prev => ({ ...prev, [name]: (prev[name] || 0) + 1 }))}
              onRemove={(name) => setExtras(prev => { const c = prev[name] || 0; if (c <= 1) { const { [name]: _, ...r } = prev; return r; } return { ...prev, [name]: c - 1 }; })}
              prefix="single-extra" />
          </>
        )}

        <div className="border-t pt-3 mt-2">
          {isDual ? (
            <div className="flex flex-wrap gap-1 mb-3 text-xs text-muted-foreground">
              <span className="text-orange-600 font-medium">Sat ({satTotal}):</span>
              {Object.entries(satSelections).filter(([_, q]) => q > 0).map(([n, q]) => <Badge key={n} variant="secondary" className="text-xs">{n} ×{q}</Badge>)}
              <span className="text-blue-600 font-medium ml-2">Tue ({tueTotal}):</span>
              {Object.entries(tueSelections).filter(([_, q]) => q > 0).map(([n, q]) => <Badge key={n} className="text-xs bg-blue-100 text-blue-800">{n} ×{q}</Badge>)}
            </div>
          ) : (totalSelected > 0 || totalExtras > 0) && (
            <div className="flex flex-wrap gap-1 mb-3">
              {Object.entries(selections).filter(([_, q]) => q > 0).map(([n, q]) => <Badge key={n} variant="secondary" className="text-xs">{n} ×{q}</Badge>)}
              {Object.entries(extras).filter(([_, q]) => q > 0).map(([n, q]) => <Badge key={n} className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">{n} ×{q}</Badge>)}
            </div>
          )}
          <Button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={handleSave}
            disabled={saveMutation.isPending || (isDual ? (satTotal === 0 || tueTotal === 0) : totalSelected === 0)}
            data-testid="button-save-admin-selections">
            {saveMutation.isPending ? "Saving..." : isDual
              ? `Save Both Deliveries (${satTotal} Sat + ${tueTotal} Tue)`
              : `Save for ${invite.customerName}${totalExtras > 0 ? ` + ${totalExtras} add-on${totalExtras !== 1 ? "s" : ""}` : ""}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
