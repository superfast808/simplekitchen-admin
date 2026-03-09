import { useState } from "react";
import { format, startOfWeek, endOfWeek, startOfMonth, endOfMonth, addWeeks } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";

export type DateRange = { from: Date; to: Date };

export function useDateFilter() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [mode, setMode] = useState<"week" | "month" | "custom">("week");

  const now = new Date();
  let from: Date, to: Date;
  if (mode === "custom" && customFrom && customTo) {
    from = new Date(customFrom + "T00:00:00");
    to = new Date(customTo + "T23:59:59");
  } else if (mode === "month") {
    from = startOfMonth(now);
    to = endOfMonth(now);
  } else {
    from = startOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });
    to = endOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });
  }

  return {
    from,
    to,
    weekOffset,
    setWeekOffset,
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
  weekOffset,
  setWeekOffset,
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
          variant={mode === "week" ? "default" : "outline"}
          onClick={() => { setMode("week"); setWeekOffset(0); }}
          data-testid={`button-${testIdPrefix}-mode-week`}
        >
          Week
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
      {mode === "week" && (
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w - 1)} data-testid={`button-${testIdPrefix}-prev`}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setWeekOffset(0)} data-testid={`button-${testIdPrefix}-this-week`}>
            This Week
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w + 1)} data-testid={`button-${testIdPrefix}-next`}>
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
      {format(from, "MMM d")} - {format(to, "MMM d, yyyy")}
    </span>
  );
}
