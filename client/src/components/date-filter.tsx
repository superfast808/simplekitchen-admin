import { useState } from "react";
import { format, startOfMonth, endOfMonth, addDays, subDays } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

export type DateRange = { from: Date; to: Date };

export function getOrderWindow(offset: number): { from: Date; to: Date } {
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

  const friday = addDays(saturdayDate, 6);
  const to = new Date(friday);
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

export function getDeliveryDatesForWindow(windowFrom: Date): { saturday: Date; tuesday: Date } {
  return {
    saturday: addDays(windowFrom, 7),
    tuesday: addDays(windowFrom, 10),
  };
}

export function getDeliveryDateForOrder(orderDate: Date | string, isTuesday: boolean): Date {
  const d = new Date(orderDate);
  const dayOfWeek = d.getDay();
  const daysBack = dayOfWeek === 6 ? 0 : dayOfWeek === 0 ? 1 : dayOfWeek + 1;
  const windowSat = new Date(d);
  windowSat.setDate(d.getDate() - daysBack);
  windowSat.setHours(0, 0, 0, 0);
  return isTuesday ? addDays(windowSat, 10) : addDays(windowSat, 7);
}

export function useDateFilter() {
  const [windowOffset, setWindowOffset] = useState(0);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [mode, setMode] = useState<"window" | "month" | "custom">("window");

  let from: Date, to: Date;
  if (mode === "custom" && customFrom && customTo) {
    from = new Date(customFrom + "T00:00:00");
    to = new Date(customTo + "T23:59:59");
  } else if (mode === "month") {
    const now = new Date();
    from = startOfMonth(now);
    to = endOfMonth(now);
  } else {
    const window = getOrderWindow(windowOffset);
    from = window.from;
    to = window.to;
  }

  return {
    from,
    to,
    windowOffset,
    setWindowOffset,
    customFrom,
    setCustomFrom,
    customTo,
    setCustomTo,
    mode,
    setMode,
  };
}

type DateFilterProps = Omit<ReturnType<typeof useDateFilter>, "from" | "to"> & {
  testIdPrefix?: string;
  showMonth?: boolean;
};

export function DateFilter({
  windowOffset,
  setWindowOffset,
  customFrom,
  setCustomFrom,
  customTo,
  setCustomTo,
  mode,
  setMode,
  testIdPrefix = "date",
  showMonth = false,
}: DateFilterProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex gap-1">
        <Button
          size="sm"
          variant={mode === "window" ? "default" : "outline"}
          onClick={() => { setMode("window"); setWindowOffset(0); }}
          data-testid={`button-${testIdPrefix}-mode-week`}
        >
          Sat–Fri
        </Button>
        {showMonth && (
          <Button
            size="sm"
            variant={mode === "month" ? "default" : "outline"}
            onClick={() => setMode("month")}
            data-testid={`button-${testIdPrefix}-mode-month`}
          >
            Month
          </Button>
        )}
        <Button
          size="sm"
          variant={mode === "custom" ? "default" : "outline"}
          onClick={() => setMode("custom")}
          data-testid={`button-${testIdPrefix}-mode-custom`}
        >
          <Calendar className="w-3.5 h-3.5 mr-1" />
          Custom
        </Button>
      </div>
      {mode === "window" && (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setWindowOffset(w => w - 1)} data-testid={`button-${testIdPrefix}-prev`}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setWindowOffset(0)} data-testid={`button-${testIdPrefix}-this-week`}>
            Current
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setWindowOffset(w => w + 1)} data-testid={`button-${testIdPrefix}-next`}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}
      {mode === "custom" && (
        <div className="flex items-center gap-2">
          <div>
            <Label className="text-xs sr-only">From</Label>
            <Input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="h-8 text-sm"
              data-testid={`input-${testIdPrefix}-from`}
            />
          </div>
          <span className="text-xs text-muted-foreground">to</span>
          <div>
            <Label className="text-xs sr-only">To</Label>
            <Input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="h-8 text-sm"
              data-testid={`input-${testIdPrefix}-to`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function DateRangeLabel({ from, to }: { from: Date; to: Date }) {
  return (
    <span className="text-sm text-muted-foreground">
      {format(from, "EEE, MMM d")} – {format(to, "EEE, MMM d, yyyy")}
    </span>
  );
}
