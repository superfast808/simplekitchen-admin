import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { SIMPLE_KITCHEN_LOGO_URL } from "@/lib/brand";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Login failed", description: data.message, variant: "destructive" });
        return;
      }
      onLogin();
    } catch {
      toast({ title: "Login failed", description: "Could not connect to server", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="brand-login-page min-h-screen flex items-center justify-center p-4">
      <Card className="brand-login-card w-full max-w-sm bg-[#fffdf9] text-[#20241e]">
        <CardHeader className="text-center space-y-4 pt-8">
          <img
            src={SIMPLE_KITCHEN_LOGO_URL}
            alt="Simple Kitchen"
            className="brand-login-logo h-20 w-20 mx-auto object-contain"
          />
          <div>
            <div className="brand-kicker mb-2">Operations Portal</div>
            <CardTitle className="text-3xl tracking-tight">Simple Kitchen</CardTitle>
            <CardDescription className="mt-2">Sign in to manage orders, subscriptions and kitchen operations.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                data-testid="input-login-username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                data-testid="input-login-password"
              />
            </div>
            <Button type="submit" className="w-full rounded-xl" disabled={isLoading} data-testid="button-login">
              {isLoading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
