import { Package, ShoppingCart, ChefHat, MapPin, BarChart3, Plus, Settings, HelpCircle, Activity, Mail, CalendarCheck, CalendarDays, BookOpen, Server } from "lucide-react";
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
  { title: "Tuesday Orders", url: "/tuesday", icon: CalendarCheck },
  { title: "Saturday Orders", url: "/saturday", icon: CalendarDays },
  { title: "Product Totals", url: "/product-totals", icon: BarChart3 },
  { title: "Ingredients", url: "/ingredients", icon: ChefHat },
  { title: "Manual Stock", url: "/manual-stock", icon: Plus },
  { title: "Tue Routes", url: "/routes/tuesday", icon: MapPin },
  { title: "Sat Routes", url: "/routes/saturday", icon: MapPin },
  { title: "Subscriptions", url: "/subscriptions", icon: Mail },
  { title: "Weekly Stats", url: "/weekly-stats", icon: Activity },
  { title: "Monthly Stats", url: "/monthly-stats", icon: CalendarDays },
  { title: "Ingredient Library", url: "/ingredient-library", icon: BookOpen },
  { title: "Products", url: "/products", icon: Package },
  { title: "Settings", url: "/settings", icon: Settings },
  { title: "System Status", url: "/system-status", icon: Server },
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
    <Sidebar className="brand-sidebar">
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2">
          {hasLogo ? (
            <div className="brand-logo-frame flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl p-1">
              <img
                src={logoData.logo}
                alt="Logo"
                className="h-full w-full object-contain"
                data-testid="img-sidebar-logo"
              />
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#d9e2ce] text-sm font-black tracking-tight text-[#293721] shadow-sm">
              SK
            </div>
          )}
          <div>
            <h2 className="text-sm font-semibold" data-testid="text-app-title">Simple Kitchen</h2>
            <p className="text-xs text-sidebar-foreground/60">Operations Portal</p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Operations</SidebarGroupLabel>
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
        <p className="text-xs text-sidebar-foreground/55">Simple Kitchen · Live operations</p>
      </SidebarFooter>
    </Sidebar>
  );
}
