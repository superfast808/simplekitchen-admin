import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { enrolPasskey, passkeySupported } from "@/lib/passkeys";
import { ShieldCheck, Fingerprint, Mail, Smartphone } from "lucide-react";

type Status = {
  stage: string;
  methods?: { passkey: boolean; authenticator: boolean; email: boolean };
  emailMasked?: string | null;
  passkeys?: number;
};
async function send(path: string, data: object = {}) {
  const response = await fetch(path, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.message || "Security request failed");
  return value;
}

export function StaffMfaSettings() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [factor, setFactor] = useState<"authenticator" | "email" | null>(null);
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const { data: status, refetch } = useQuery<Status>({
    queryKey: ["/api/auth/mfa/status"],
    queryFn: async () => {
      const response = await fetch("/api/auth/mfa/status", { credentials: "include" });
      if (!response.ok) throw new Error("Could not load MFA methods");
      return response.json();
    },
    staleTime: 0,
  });

  async function run(task: () => Promise<unknown>, done = false) {
    setBusy(true);
    try {
      await task();
      if (done) {
        setFactor(null); setSetup(null); setCode(""); setEmailSent(false);
        await refetch();
        toast({ title: "Security method verified", description: "Your new method is ready for future sign-ins." });
      }
    } catch (error: any) {
      toast({ title: "Could not finish enrolment", description: String(error?.message || error), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card data-testid="staff-security-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-4 h-4" /> Your account security</CardTitle>
        <CardDescription>
          Passkeys are preferred. Add an authenticator or verified email fallback so you can
          still sign in if you change devices. For security, adding a method requires a recent
          MFA login (within ten minutes).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-muted px-3 py-1">{status?.passkeys || 0} passkey(s)</span>
          <span className="rounded-full bg-muted px-3 py-1">Authenticator: {status?.methods?.authenticator ? "Enabled" : "Not set up"}</span>
          <span className="rounded-full bg-muted px-3 py-1">Email: {status?.emailMasked || "Not set up"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {passkeySupported() && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => run(enrolPasskey, true)}>
              <Fingerprint className="mr-2 w-4 h-4" /> Add another passkey
            </Button>
          )}
          <Button type="button" variant="outline" disabled={busy}
            onClick={() => run(async () => {
              setFactor("authenticator"); setEmailSent(false);
              setSetup(await send("/api/auth/mfa/authenticator/start"));
            })}>
            <Smartphone className="mr-2 w-4 h-4" /> Set up authenticator
          </Button>
          <Button type="button" variant="outline" disabled={busy}
            onClick={() => { setFactor("email"); setSetup(null); setEmailSent(false); setCode(""); }}>
            <Mail className="mr-2 w-4 h-4" /> {status?.methods?.email ? "Change verified email" : "Add email fallback"}
          </Button>
        </div>
        {factor === "authenticator" && setup && (
          <div className="border rounded-lg p-4 space-y-2">
            <p className="text-sm">Scan this code in an authenticator app, then enter the six-digit code to confirm.</p>
            <img src={setup.qr} alt="Authenticator QR code" className="mx-auto h-48 w-48" />
            <p className="text-xs">Manual setup key: <code className="select-all break-all">{setup.secret}</code></p>
            <Label htmlFor="security-totp-code">Authenticator code</Label>
            <Input id="security-totp-code" inputMode="numeric" maxLength={6}
              value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
            <Button type="button" disabled={busy || code.length !== 6} onClick={() =>
              run(() => send("/api/auth/mfa/authenticator/verify", { code }), true)}>
              Verify authenticator
            </Button>
          </div>
        )}
        {factor === "email" && (
          <div className="border rounded-lg p-4 space-y-2">
            <Label htmlFor="security-staff-email">Individual staff email</Label>
            <Input id="security-staff-email" type="email" value={email}
              onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            {!emailSent ? (
              <Button type="button" disabled={busy || !email.includes("@")} onClick={() =>
                run(async () => {
                  await send("/api/auth/mfa/email/send", { setup: true, email: email.trim() });
                  setEmailSent(true);
                  toast({ title: "Security code sent", description: "Check your email to verify this address." });
                })}>
                Send verification code
              </Button>
            ) : (
              <>
                <Label htmlFor="security-email-code">Six-digit code</Label>
                <Input id="security-email-code" inputMode="numeric" maxLength={6}
                  value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} placeholder="000000" />
                <Button type="button" disabled={busy || code.length !== 6}
                  onClick={() => run(() => send("/api/auth/mfa/email/verify", { code }), true)}>
                  Verify email
                </Button>
              </>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Email and authenticator codes are fallbacks, not replacements for the account password.
          If all methods are lost, another MFA-verified administrator must securely reset your enrolment.
        </p>
      </CardContent>
    </Card>
  );
}
