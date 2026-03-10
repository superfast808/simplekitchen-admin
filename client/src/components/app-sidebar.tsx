import { Package, ShoppingCart, ChefHat, MapPin, BarChart3, Plus, Settings, HelpCircle } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";

const menuItems = [
  { title: "Orders", url: "/", icon: ShoppingCart },
  { title: "Products", url: "/products", icon: Package },
  { title: "Product Totals", url: "/product-totals", icon: BarChart3 },
  { title: "Ingredients", url: "/ingredients", icon: ChefHat },
  { title: "Manual Stock", url: "/manual-stock", icon: Plus },
  { title: "Delivery Routes", url: "/routes", icon: MapPin },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "Help", url: "/help", icon: HelpCircle },
];

export function AppSidebar() {
  const [location] = useLocation();

  const { data: logoData } = useQuery<{ logo: string }>({
    queryKey: ["/api/settings/logo"],
    retry: false,
  });

  const hasLogo = logoData?.logo && logoData.logo.length > 0;

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          {hasLogo ? (
            <div className="flex items-center justify-center w-8 h-8 rounded-md overflow-hidden">
              <img
                src={logoData.logo}
                alt="Logo"
                className="w-full h-full object-contain"
                data-testid="img-sidebar-logo"
              />
            </div>
          ) : (
            <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary">
              <Package className="w-4 h-4 text-primary-foreground" />
            </div>
          )}
          <div>
            <h2 className="text-sm font-semibold" data-testid="text-app-title">Partner Portal</h2>
            <p className="text-xs text-muted-foreground">WooCommerce Manager</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild data-active={location === item.url}>
                    <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase().replace(/\s+/g, "-")}`}>
                      <item.icon />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <p className="text-xs text-muted-foreground">Syncs with WooCommerce</p>
      </SidebarFooter>
    </Sidebar>
  );
}
