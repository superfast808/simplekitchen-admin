import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import NotFound from "@/pages/not-found";
import OrdersPage from "@/pages/orders";
import ProductsPage from "@/pages/products";
import ProductTotalsPage from "@/pages/product-totals";
import IngredientsPage from "@/pages/ingredients";
import ManualStockPage from "@/pages/manual-stock";
import DeliveryRoutesPage from "@/pages/delivery-routes";
import SettingsPage from "@/pages/settings";
import HelpPage from "@/pages/help";
import LoginPage from "@/pages/login";

function PageRouter() {
  return (
    <Switch>
      <Route path="/" component={OrdersPage} />
      <Route path="/products" component={ProductsPage} />
      <Route path="/product-totals" component={ProductTotalsPage} />
      <Route path="/ingredients" component={IngredientsPage} />
      <Route path="/manual-stock" component={ManualStockPage} />
      <Route path="/routes" component={DeliveryRoutesPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/help" component={HelpPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const sidebarStyle = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3rem",
};

function AuthenticatedApp({ username, onLogout }: { username: string; onLogout: () => void }) {
  return (
    <SidebarProvider style={sidebarStyle as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-1 p-2 border-b">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground" data-testid="text-current-user">{username}</span>
              <Button size="icon" variant="ghost" onClick={onLogout} data-testid="button-logout" title="Sign out">
                <LogOut className="w-4 h-4" />
              </Button>
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <PageRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function AppContent() {
  const { data: user, isLoading, refetch } = useQuery<{ id: string; username: string } | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me", { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error("Failed to check auth");
      return res.json();
    },
    retry: false,
    staleTime: Infinity,
  });

  const handleLogin = () => {
    refetch();
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    queryClient.clear();
    refetch();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  return <AuthenticatedApp username={user.username} onLogout={handleLogout} />;
}

export default function App() {
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AppContent />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
