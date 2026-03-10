import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ShoppingCart, Package, BarChart3, ChefHat, Plus, MapPin, Settings, HelpCircle } from "lucide-react";

const guides = [
  {
    icon: ShoppingCart,
    title: "Orders",
    description: "View and manage all your weekly orders",
    steps: [
      "Orders sync automatically from WooCommerce based on your configured schedule.",
      "The date filter at the top defaults to the current order window (Saturday to Wednesday). You can switch to monthly or custom date ranges.",
      "Each row shows a customer and their ordered products. Product columns show quantities.",
      "The TOTAL row at the bottom sums up all quantities for each product.",
      "Use the 'Export' button to download the orders table as an Excel (XLSX) file.",
      "Use the 'Labels' button to generate printable address labels (A4 sheets, 10 labels per page). Each label shows the customer name, delivery/collection marker, address, and a summary of their items.",
      "You can also add manual orders using the '+' button — useful for phone orders or shop orders that aren't on the website.",
    ],
  },
  {
    icon: Package,
    title: "Products",
    description: "Manage your product catalogue",
    steps: [
      "Products are imported automatically from WooCommerce when you sync.",
      "Click on any product to view or edit its ingredient list.",
      "Ingredients are used to calculate the total quantities needed on the Ingredients page.",
      "You can manually add products that aren't on WooCommerce if needed.",
    ],
  },
  {
    icon: BarChart3,
    title: "Product Totals",
    description: "See how many of each product are needed",
    steps: [
      "This page shows a summary of total quantities ordered for each product.",
      "It combines both online (WooCommerce) orders and manual/shop quantities.",
      "Use the date filter to view totals for the current week, a specific month, or a custom range.",
      "This is helpful for knowing exactly how much of each meal to prepare.",
    ],
  },
  {
    icon: ChefHat,
    title: "Ingredients",
    description: "Calculate ingredient quantities needed",
    steps: [
      "This page calculates the total amount of each ingredient you need based on current orders.",
      "It works by multiplying each product's ingredient quantities by the number of that product ordered.",
      "For this to work, you need to set up ingredients for each product on the Products page.",
      "Use the date filter to match the same period as your orders.",
    ],
  },
  {
    icon: Plus,
    title: "Manual Stock",
    description: "Track orders from shops and other sources",
    steps: [
      "Use this page to record quantities for items sold through local shops or non-website channels.",
      "Select a product, enter the quantity, and add it.",
      "These quantities are included in the Product Totals calculations.",
      "You can delete entries if you make a mistake.",
    ],
  },
  {
    icon: MapPin,
    title: "Delivery Routes",
    description: "Plan your delivery route from the depot",
    steps: [
      "This page shows a planned delivery route on a map, starting from the Unit 33 depot (Glasgow G45 9EE).",
      "Only delivery orders are shown on the route — collection orders are listed separately.",
      "The route is automatically optimised using a nearest-neighbour algorithm to minimise travel distance.",
      "The green 'S' marker shows your starting point (the depot). Numbered markers show each delivery stop in order.",
      "A summary below the map shows the breakdown of delivery vs collection customers.",
    ],
  },
  {
    icon: Settings,
    title: "Settings",
    description: "Configure the portal",
    steps: [
      "Branding — Upload your logo to display in the sidebar and on the login page.",
      "User Management — Add or remove users who can access the portal. You cannot delete the last remaining user.",
      "Auto-Sync — Enable or disable automatic syncing from WooCommerce, and set how often it runs (in minutes). You can also trigger an immediate sync with the 'Sync Now' button.",
      "Order Window — Set which day and time the order window opens and closes each week. This controls the default date filter on all pages. The default is Saturday noon to Wednesday midnight.",
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-page-title">Help & Guides</h1>
        <p className="text-sm text-muted-foreground">Quick guides on how each part of the portal works</p>
      </div>

      {guides.map((guide) => (
        <Card key={guide.title}>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-md bg-primary/10">
                <guide.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">{guide.title}</CardTitle>
                <CardDescription>{guide.description}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {guide.steps.map((step, i) => (
                <li key={i} className="flex gap-3 text-sm" data-testid={`text-help-${guide.title.toLowerCase().replace(/\s+/g, "-")}-step-${i}`}>
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">{i + 1}</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
