import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { SIMPLE_KITCHEN_LOGO_URL } from "@/lib/brand";
import { enrolPasskey, verifyPasskey, passkeySupported } from "@/lib/passkeys";
import { Fingerprint, Mail, Smartphone, ArrowLeft, ShieldCheck, Loader2 } from "lucide-react";

type Stage = "password" | "enrol" | "verify";
type Factor = "passkey" | "authenticator" | "email";
type Methods = { passkey: boolean; authenticator: boolean; email: boolean };
type MfaStatus = { stage: "password" | "enrol" | "verify" | "authenticated"; methods?: Methods; emailMasked?: string };

async function post(path: string, body: object = {}): Promise<any> {
  const res = await fetch(path, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const value = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(value.message || "Request failed. Try again.");
  return value;
}

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const { toast } = useToast();
  const [stage, setStage] = useState<Stage>("password");
  const [methods, setMethods] = useState<Methods>({ passkey: false, authenticator: false, email: false });
  const [emailMasked, setEmailMasked] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [factor, setFactor] = useState<Factor>("passkey");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [authSetup, setAuthSetup] = useState<{ secret: string; qr: string; uri: string } | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/mfa/status", { credentials: "include", cache: "no-store" })
      .then(r => r.ok ? r.json() : null)
      .then((result: MfaStatus | null) => {
        if (!active || !result) return;
        if (result.stage === "enrol" || result.stage === "verify") {
          setStage(result.stage);
          if (result.methods) setMethods(result.methods);
          setEmailMasked(result.emailMasked || "");
          if (result.stage === "verify")
            setFactor(result.methods?.passkey && passkeySupported() ? "passkey"
              : result.methods?.authenticator ? "authenticator" : "email");
        }
      })
      .finally(() => { if (active) setLoadingStatus(false); });
    return () => { active = false; };
  }, []);

  function clearFactor() {
    setCode(""); setEmailSent(false); setAuthSetup(null);
  }
  function report(error: unknown) {
    toast({ title: "Verification unsuccessful", description: error instanceof Error ? error.message : "Try again",
      variant: "destructive" });
  }
  async function run(action: () => Promise<any>, finish = false) {
    setBusy(true);
    try {
      await action();
      if (finish) onLogin();
    } catch (error) { report(error); }
    finally { setBusy(false); }
  }
  async function passwordLogin(event: React.FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) return;
    await run(async () => {
      const result = await post("/api/auth/login", { username, password });
      setMethods(result.methods);
      setStage(result.setupRequired ? "enrol" : "verify");
      setFactor(result.setupRequired || result.methods.passkey && passkeySupported() ? "passkey"
        : result.methods.authenticator ? "authenticator" : "email");
      setPassword("");
      clearFactor();
    });
  }
  async function sendEmail() {
    await run(async () => {
      const setup = stage === "enrol";
      await post("/api/auth/mfa/email/send", setup ? { setup: true, email: address.trim() } : {});
      setEmailSent(true);
      toast({ title: "Code sent", description: "Check your email for the six-digit code. It expires in ten minutes." });
    });
  }
  function confirmCode() {
    if (!/^\d{6}$/.test(code.trim())) return report(new Error("Enter the six-digit security code"));
    run(async () => {
      const endpoint = factor === "email" ? "/api/auth/mfa/email/verify" : "/api/auth/mfa/authenticator/verify";
      await post(endpoint, { code: code.trim() });
    }, true);
  }
  function choose(next: Factor) {
    setFactor(next); clearFactor();
  }
  const enrol = stage === "enrol";
  const canPasskey = passkeySupported();
  return (
    <div className="brand-login-page min-h-screen flex items-center justify-center p-4">
      <Card className="brand-login-card w-full max-w-md bg-[#fffdf9] text-[#20241e]">
        <CardHeader className="text-center space-y-4 pt-8">
          <img src={SIMPLE_KITCHEN_LOGO_URL} alt="Simple Kitchen" className="brand-login-logo h-20 w-20 mx-auto object-contain" />
          <div>
            <div className="brand-kicker mb-2">Secure Operations Portal</div>
            <CardTitle className="text-3xl tracking-tight">Simple Kitchen</CardTitle>
            <CardDescription className="mt-2">
              {stage === "password" ? "Sign in to manage kitchen operations."
                : enrol ? "Set up account protection before accessing the admin portal."
                : "Verify your identity to finish signing in."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {stage === "password" ? (
            <form onSubmit={passwordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input id="username" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="Enter username" data-testid="input-login-username" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" autoComplete="current-password" value={password}
                  onChange={e => setPassword(e.target.value)} data-testid="input-login-password" required />
              </div>
              <Button type="submit" className="w-full rounded-xl" disabled={busy || loadingStatus}>
                {busy ? "Checking password…" : "Continue securely"}
              </Button>
            </form>
          ) : (
            <>
              <div className="rounded-lg border bg-emerald-50/60 p-3 text-sm text-emerald-950">
                <ShieldCheck className="inline h-4 w-4 mr-2" />
                {enrol ? "First-time security setup · Passkey recommended" : "Password accepted · Second step required"}
              </div>
              <div className="grid grid-cols-1 gap-2">
                {(enrol || methods.passkey) && canPasskey && (
                  <Button type="button" className="justify-start" variant={factor === "passkey" ? "default" : "outline"}
                    onClick={() => choose("passkey")} disabled={busy}>
                    <Fingerprint className="mr-2 w-4 h-4" /> Passkey {enrol ? "(recommended)" : ""}
                  </Button>
                )}
                {(enrol || methods.authenticator) && (
                  <Button type="button" className="justify-start" variant={factor === "authenticator" ? "default" : "outline"}
                    onClick={() => choose("authenticator")} disabled={busy}>
                    <Smartphone className="mr-2 w-4 h-4" /> Authenticator app
                  </Button>
                )}
                {(enrol || methods.email) && (
                  <Button type="button" className="justify-start" variant={factor === "email" ? "default" : "outline"}
                    onClick={() => choose("email")} disabled={busy}>
                    <Mail className="mr-2 w-4 h-4" /> Email verification
                  </Button>
                )}
              </div>
              {factor === "passkey" && canPasskey && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {enrol ? "Save a passkey using your device PIN, fingerprint or face unlock. No codes to remember."
                      : "Use the passkey you set up on this device, a synced device or a security key."}
                  </p>
                  <Button type="button" className="w-full" disabled={busy}
                    onClick={() => run(enrol ? enrolPasskey : verifyPasskey, true)}>
                    <Fingerprint className="mr-2 w-4 h-4" />
                    {busy ? "Waiting for your device…" : enrol ? "Create my passkey" : "Verify with passkey"}
                  </Button>
                </div>
              )}
              {factor === "authenticator" && (
                <div className="space-y-3">
                  {enrol && !authSetup && (
                    <Button type="button" className="w-full" disabled={busy} onClick={() => run(async () => {
                      setAuthSetup(await post("/api/auth/mfa/authenticator/start"));
                    })}>Set up authenticator app</Button>
                  )}
                  {authSetup && (
                    <div className="rounded-lg border p-3 space-y-3 text-center">
                      <p className="text-sm">Scan this QR code in Google Authenticator, Microsoft Authenticator or another TOTP app.</p>
                      <img src={authSetup.qr} alt="Authenticator setup QR code" className="mx-auto h-48 w-48" />
                      <p className="text-xs text-muted-foreground">Or enter this setup key manually:</p>
                      <code className="text-xs font-semibold break-all select-all">{authSetup.secret}</code>
                    </div>
                  )}
                  {(!enrol || authSetup) && (
                    <div className="space-y-2">
                      <Label htmlFor="mfa-totp-code">Six-digit authenticator code</Label>
                      <Input id="mfa-totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                        value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="000000" />
                      <Button type="button" className="w-full" disabled={busy || code.length !== 6}
                        onClick={confirmCode}>{busy ? "Verifying…" : enrol ? "Verify and finish setup" : "Verify and sign in"}</Button>
                    </div>
                  )}
                </div>
              )}
              {factor === "email" && (
                <div className="space-y-3">
                  {enrol && (
                    <div className="space-y-1">
                      <Label htmlFor="mfa-email">Your individual staff email</Label>
                      <Input id="mfa-email" type="email" autoComplete="email" value={address}
                        onChange={e => setAddress(e.target.value)}
                        placeholder="name@example.com" />
                    </div>
                  )}
                  {!enrol && !!emailMasked && <p className="text-sm text-muted-foreground">Code goes to {emailMasked}</p>}
                  {!emailSent ? (
                    <Button type="button" className="w-full" disabled={busy || (enrol && !address.includes("@"))}
                      onClick={sendEmail}>{busy ? "Sending…" : "Send verification code"}</Button>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="mfa-email-code">Six-digit code from email</Label>
                      <Input id="mfa-email-code" inputMode="numeric" autoComplete="one-time-code"
                        value={code} maxLength={6} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                        placeholder="000000" />
                      <Button type="button" className="w-full" disabled={busy || code.length !== 6}
                        onClick={confirmCode}>{busy ? "Verifying…" : "Verify and sign in"}</Button>
                      <p className="text-xs text-muted-foreground">Code expires after 10 minutes. Reload the page to request another if needed.</p>
                    </div>
                  )}
                </div>
              )}
              <Button type="button" variant="ghost" className="w-full" disabled={busy}
                onClick={() => run(async () => {
                  await post("/api/auth/logout");
                  clearFactor(); setStage("password");
                })}>
                <ArrowLeft className="mr-2 w-4 h-4" /> Back to sign in
              </Button>
            </>
          )}
          {busy && <p role="status" className="text-center text-xs text-muted-foreground">
            <Loader2 className="inline h-3 w-3 animate-spin mr-1" /> Please wait…
          </p>}
          <p className="text-center text-xs text-muted-foreground">
            Only passkey, authenticator-app and verified-email methods are supported.
            Ask another administrator for help if you've lost access to all enrolled methods.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
