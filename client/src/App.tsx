import { Switch, Route, useLocation } from "wouter";
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
import KitchenProductionPage from "@/pages/kitchen-production";
import PossibleDuplicatesPage from "@/pages/possible-duplicates";
import IngredientsPage from "@/pages/ingredients";
import ManualStockPage from "@/pages/manual-stock";
import TuesdayDeliveryRoutesPage from "@/pages/tuesday-delivery-routes";
import SaturdayDeliveryRoutesPage from "@/pages/saturday-delivery-routes";
import SettingsPage from "@/pages/settings";
import HelpPage from "@/pages/help";
import WeeklyStatsPage from "@/pages/weekly-stats";
import MonthlyStatsPage from "@/pages/monthly-stats";
import SubscriptionOverviewPage from "@/pages/subscription-overview";
import TuesdayOrdersPage from "@/pages/tuesday-orders";
import SaturdayOrdersPage from "@/pages/saturday-orders";
import SubscribePage from "@/pages/subscribe";
import PaymentSuccessPage from "@/pages/payment-success";
import AddonPage, { AddonSuccessPage } from "@/pages/addon";
import IngredientLibraryPage from "@/pages/ingredient-library";
import LoginPage from "@/pages/login";
import SystemStatusPage from "@/pages/system-status";
import CustomerPortal from "@/pages/customer-portal";

function isPublicRoute(location: string) {
  return (
    (location === "/my" || location.startsWith("/my/")) ||
    location.startsWith("/subscribe/") ||
    location.startsWith("/addon/")
  );
}

function PublicRoutes() {
  return (
    <Switch>
      <Route path="/my" component={CustomerPortal} />
      <Route path="/subscribe/:token/payment-success">
        {(params) => <PaymentSuccessPage params={params} />}
      </Route>
      <Route path="/subscribe/:token">
        {(params) => <SubscribePage params={params} />}
      </Route>
      <Route path="/addon/:token/success">
        {(params) => <AddonSuccessPage params={params} />}
      </Route>
      <Route path="/addon/:token">
        {(params) => <AddonPage params={params} />}
      </Route>
    </Switch>
  );
}

function PageRouter() {
  return (
    <Switch>
      <Route path="/" component={OrdersPage} />
      <Route path="/products" component={ProductsPage} />
      <Route path="/product-totals" component={ProductTotalsPage} />
      <Route path="/kitchen-production" component={KitchenProductionPage} />
      <Route path="/possible-duplicates" component={PossibleDuplicatesPage} />
      <Route path="/ingredients" component={IngredientsPage} />
      <Route path="/manual-stock" component={ManualStockPage} />
      <Route path="/routes/tuesday" component={TuesdayDeliveryRoutesPage} />
      <Route path="/routes/saturday" component={SaturdayDeliveryRoutesPage} />
      <Route path="/weekly-stats" component={WeeklyStatsPage} />
      <Route path="/monthly-stats" component={MonthlyStatsPage} />
      <Route path="/subscriptions" component={SubscriptionOverviewPage} />
      <Route path="/tuesday" component={TuesdayOrdersPage} />
      <Route path="/saturday" component={SaturdayOrdersPage} />
      <Route path="/ingredient-library" component={IngredientLibraryPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/system-status" component={SystemStatusPage} />
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
      <div className="brand-app-shell flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="brand-topbar flex items-center justify-between gap-1 border-b px-3 py-2">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground" data-testid="text-current-user">{username}</span>
              <Button size="icon" variant="ghost" onClick={onLogout} data-testid="button-logout" title="Sign out">
                <LogOut className="w-4 h-4" />
              </Button>
              <ThemeToggle />
            </div>
          </header>
          <main className="brand-main flex-1 overflow-auto">
            <PageRouter />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

function PortalApp() {
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

  const handleLogin = () => refetch();

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

function AppContent() {
  const [location] = useLocation();

  if (isPublicRoute(location)) {
    return <PublicRoutes />;
  }

  return <PortalApp />;
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
