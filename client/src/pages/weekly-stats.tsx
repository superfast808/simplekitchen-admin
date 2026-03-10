import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, subDays, addDays } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, UtensilsCrossed, PoundSterling, Receipt, Truck, UserPlus, UserCheck, TrendingUp, TrendingDown } from "lucide-react";

type WeeklyStats = {
  mealsSold: number;
  revenue: number;
  avgOrderValue: number;
  deliveryStops: number;
  newCustomers: number;
  returningCustomers: number;
  topSeller: string;
  worstSeller: string;
  orderCount: number;
};

function getWeekRange(offset: number): { from: Date; to: Date; isCurrent: boolean } {
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const dayOfWeek = ukNow.getDay();

  let saturdayDate: Date;
  if (dayOfWeek === 6) {
    saturdayDate = new Date(ukNow);
  } else {
    const daysBack = dayOfWeek === 0 ? 1 : dayOfWeek + 1;
    saturdayDate = subDays(ukNow, daysBack);
  }

  if (offset !== 0) {
    saturdayDate = addDays(saturdayDate, offset * 7);
  }

  const from = new Date(saturdayDate);
  from.setHours(0, 0, 0, 0);

  const wednesday = addDays(saturdayDate, 4);
  const to = new Date(wednesday);
  to.setHours(23, 59, 59, 999);

  const isCurrent = offset === 0;

  return { from, to, isCurrent };
}

function isVisibleCurrentWeek(): boolean {
  const now = new Date();
  const ukNow = new Date(now.toLocaleString("en-US", { timeZone: "Europe/London" }));
  const day = ukNow.getDay();
  const hour = ukNow.getHours();
  if (day === 6 && hour >= 12) return false;
  if (day === 0 || day === 1 || day === 2 || day === 3 || day === 4 || day === 5) return true;
  return day === 6 && hour < 12;
}

const statCards: Array<{
  key: keyof WeeklyStats;
  label: string;
  icon: typeof UtensilsCrossed;
  format?: (v: any) => string;
  span?: boolean;
}> = [
  { key: "mealsSold", label: "Meals Sold", icon: UtensilsCrossed },
  { key: "revenue", label: "Revenue", icon: PoundSterling, format: (v: number) => `£${v.toFixed(2)}` },
  { key: "avgOrderValue", label: "Avg Order Value", icon: Receipt, format: (v: number) => `£${v.toFixed(2)}` },
  { key: "deliveryStops", label: "Delivery Stops", icon: Truck },
  { key: "newCustomers", label: "New Customers", icon: UserPlus },
  { key: "returningCustomers", label: "Returning Customers", icon: UserCheck },
  { key: "topSeller", label: "Top Seller", icon: TrendingUp, span: true },
  { key: "worstSeller", label: "Worst Seller", icon: TrendingDown, span: true },
];

export default function WeeklyStatsPage() {
  const [offset, setOffset] = useState(0);
  const { from, to, isCurrent } = getWeekRange(offset);

  const canViewCurrent = isVisibleCurrentWeek();
  const effectiveRange = isCurrent && !canViewCurrent ? getWeekRange(-1) : { from, to };

  const { data: stats, isLoading } = useQuery<WeeklyStats>({
    queryKey: ["/api/weekly-stats", effectiveRange.from.toISOString(), effectiveRange.to.toISOString()],
    queryFn: async () => {
      const params = new URLSearchParams({
        from: effectiveRange.from.toISOString(),
        to: effectiveRange.to.toISOString(),
      });
      const res = await fetch(`/api/weekly-stats?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
  });

  const displayRange = isCurrent && !canViewCurrent ? getWeekRange(-1) : { from, to };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-weekly-stats-title">Weekly Stats</h1>
          <p className="text-sm text-muted-foreground" data-testid="text-weekly-stats-range">
            {format(displayRange.from, "EEE, MMM d")} – {format(displayRange.to, "EEE, MMM d, yyyy")}
          </p>
          {isCurrent && !canViewCurrent && offset === 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-400 mt-1" data-testid="text-stats-cutoff-notice">
              Current week stats hidden after Saturday noon — showing previous week
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setOffset(o => o - 1)}
            data-testid="button-stats-prev"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setOffset(0)}
            data-testid="button-stats-current"
          >
            {canViewCurrent ? "This Week" : "Latest"}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setOffset(o => o + 1)}
            disabled={offset >= 0}
            data-testid="button-stats-next"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className={i >= 6 ? "col-span-2 md:col-span-1 md:last:col-span-1" : ""}>
              <CardContent className="p-5">
                <div className="h-4 w-20 bg-muted animate-pulse rounded mb-3" />
                <div className="h-8 w-16 bg-muted animate-pulse rounded" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {statCards.map((card) => {
            const value = stats[card.key];
            const displayValue = card.format ? card.format(value) : String(value);
            const Icon = card.icon;
            return (
              <Card
                key={card.key}
                className={card.span ? "col-span-2 md:col-span-3" : ""}
                data-testid={`card-stat-${card.key}`}
              >
                <CardContent className="p-5">
                  <div className="flex items-center gap-2 text-muted-foreground mb-1">
                    <Icon className="w-4 h-4" />
                    <span className="text-xs font-medium uppercase tracking-wide">{card.label}</span>
                  </div>
                  <p className={`font-bold ${card.span ? "text-lg" : "text-2xl"} tabular-nums`} data-testid={`text-stat-${card.key}`}>
                    {displayValue}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
