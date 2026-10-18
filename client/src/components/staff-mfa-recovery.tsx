import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export function StaffMfaRecovery() {
  const { toast } = useToast();
  const [target, setTarget] = useState<{ id: string; username: string } | null>(null);
  const [password, setPassword] = useState("");
  const { data: users = [] } = useQuery<Array<{ id: string; username: string }>>({
    queryKey: ["/api/users"],
  });
  const { data: me } = useQuery<{ id: string }>({ queryKey: ["/api/auth/me"] });
  const reset = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error("Select a user");
      const response = await fetch("/api/users/" + encodeURIComponent(target.id) + "/mfa-reset", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirm: "RESET_MFA" }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || "MFA reset refused");
      return result;
    },
    onSuccess: () => {
      setTarget(null); setPassword("");
      toast({ title: "Staff enrolment reset", description: "Their existing sessions were revoked. They must enrol MFA again on their next login." });
    },
    onError: (error: Error) => toast({ title: "Reset failed", description: error.message, variant: "destructive" }),
  });

  return (
    <Card data-testid="staff-mfa-recovery">
      <CardHeader>
        <CardTitle className="text-base">Staff MFA recovery</CardTitle>
        <CardDescription>
          If a colleague loses all their enrolled methods, another MFA-verified administrator
          can reset their enrolment. This requires your password and a recent MFA login.
          You cannot reset your own enrolment.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!target ? (
          <div className="flex flex-wrap gap-2">
            {users.filter(u => u.id !== me?.id).map(u => (
              <Button key={u.id} size="sm" variant="outline" type="button"
                onClick={() => { setPassword(""); setTarget(u); }}>
                Reset {u.username}'s MFA
              </Button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border bg-amber-50 p-4 space-y-3">
            <p className="font-semibold text-sm">Reset all MFA methods for {target.username}?</p>
            <p className="text-sm">
              Their passkeys, authenticator secret and verified email will be removed, and their
              signed-in sessions revoked. They must set up a new method after entering their password.
            </p>
            <Input aria-label="Your own admin password" type="password" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="Enter your own admin password" />
            <div className="flex gap-2">
              <Button type="button" variant="destructive" disabled={!password || reset.isPending}
                onClick={() => reset.mutate()}>
                {reset.isPending ? "Resetting…" : "Confirm staff MFA reset"}
              </Button>
              <Button variant="outline" type="button" onClick={() => { setTarget(null); setPassword(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
