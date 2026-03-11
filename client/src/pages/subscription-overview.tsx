import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Send, CheckCircle2, Clock, Mail, Users, Eye } from "lucide-react";
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

export default function SubscriptionOverviewPage() {
  const { toast } = useToast();
  const [overrideEmail, setOverrideEmail] = useState("");
  const [showOverview, setShowOverview] = useState(false);

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
      toast({
        title: "Emails sent",
        description: `${data.sent} of ${data.total || data.sent} emails sent successfully${data.errors?.length ? `. Errors: ${data.errors.join(", ")}` : ""}`,
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
                          <div>
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
                          <Badge className="bg-emerald-500 text-white shrink-0">
                            {invite.selections.reduce((s, sel) => s + sel.quantity, 0)}/{invite.subscriptionQuantity}
                          </Badge>
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
                          <div className="text-right">
                            <Badge variant="outline" className="text-amber-600 border-amber-300">
                              {invite.subscriptionQuantity} meals
                            </Badge>
                            <p className="text-xs text-muted-foreground mt-1">
                              Sent {format(new Date(invite.createdAt), "EEE d MMM, HH:mm")}
                            </p>
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
    </div>
  );
}
