import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2, ChefHat } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

function BrandLogo() {
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

  if (logoData?.logo) {
    return (
      <div className="w-16 h-16 mx-auto rounded-2xl overflow-hidden shadow-lg">
        <img src={logoData.logo} alt="Simple Kitchen Prep" className="w-full h-full object-contain" />
      </div>
    );
  }

  return (
    <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg">
      <ChefHat className="w-8 h-8 text-white" />
    </div>
  );
}

export default function PaymentSuccessPage({ params }: { params: { token: string } }) {
  const sessionId = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("session_id") || ""
    : "";

  const [status, setStatus] = useState<"loading" | "success" | "failed" | "pending">("loading");
  const [customerName, setCustomerName] = useState("");
  const [amountTotal, setAmountTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStatus("failed");
      return;
    }
    fetch(`/api/stripe/session-status?session_id=${encodeURIComponent(sessionId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.status === "paid") {
          setStatus("success");
          setCustomerName(data.customerName || "");
          setAmountTotal(data.amountTotal);
        } else if (data.status === "unpaid") {
          setStatus("pending");
        } else {
          setStatus("failed");
        }
      })
      .catch(() => setStatus("failed"));
  }, [sessionId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-orange-50 dark:from-gray-900 dark:via-gray-900 dark:to-gray-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-md text-center">
        <CardContent className="p-8 space-y-5">
          <BrandLogo />

          {status === "loading" && (
            <>
              <Loader2 className="w-12 h-12 mx-auto text-emerald-500 animate-spin" />
              <h2 className="text-xl font-bold">Confirming payment…</h2>
              <p className="text-muted-foreground text-sm">Please wait while we verify your payment.</p>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle className="w-14 h-14 mx-auto text-emerald-500" data-testid="icon-payment-success" />
              <h2 className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">Payment confirmed!</h2>
              {customerName && (
                <p className="text-base font-medium">
                  Thank you, {customerName.split(" ")[0]}!
                </p>
              )}
              {amountTotal != null && (
                <p className="text-muted-foreground text-sm">
                  We've received your payment of <strong>£{(amountTotal / 100).toFixed(2)}</strong>.
                </p>
              )}
              <div className="pt-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl p-4">
                <p className="text-sm text-emerald-800 dark:text-emerald-300 font-medium">
                  Your meal order is confirmed and your add-ons are paid for.
                  We'll have everything ready for you this week!
                </p>
              </div>
            </>
          )}

          {status === "pending" && (
            <>
              <Loader2 className="w-12 h-12 mx-auto text-orange-400 animate-spin" />
              <h2 className="text-xl font-bold">Payment processing…</h2>
              <p className="text-muted-foreground text-sm">
                Your payment is being processed. This page will update shortly.
                If you have any questions, please contact us.
              </p>
            </>
          )}

          {status === "failed" && (
            <>
              <XCircle className="w-12 h-12 mx-auto text-red-500" data-testid="icon-payment-failed" />
              <h2 className="text-xl font-bold">Payment not confirmed</h2>
              <p className="text-muted-foreground text-sm">
                We couldn't confirm your payment. If you've been charged, please contact us and we'll sort it out.
                Your meal selections have been saved.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
