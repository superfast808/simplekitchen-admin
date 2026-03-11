import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { useState, useCallback, useEffect } from "react";

export type OrderSource = "website" | "tuesday" | "manual";

export interface OrderSourceFilterState {
  website: boolean;
  tuesday: boolean;
  manual: boolean;
}

const ALL_ON: OrderSourceFilterState = { website: true, tuesday: true, manual: true };
const ALL_OFF: OrderSourceFilterState = { website: false, tuesday: false, manual: false };

export function useOrderSourceFilter(initial: OrderSourceFilterState = ALL_ON) {
  const [sources, setSources] = useState<OrderSourceFilterState>(initial);

  const toggle = useCallback((key: OrderSource) => {
    setSources(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const showAll = useCallback(() => setSources(ALL_ON), []);
  const showNone = useCallback(() => setSources(ALL_OFF), []);

  const allOn = sources.website && sources.tuesday && sources.manual;
  const allOff = !sources.website && !sources.tuesday && !sources.manual;

  const filterOrder = useCallback((order: { isManual?: boolean | null; isTuesday?: boolean | null }) => {
    if (order.isTuesday) return sources.tuesday;
    if (order.isManual) return sources.manual;
    return sources.website;
  }, [sources]);

  const toQueryParam = useCallback(() => {
    const parts: string[] = [];
    if (sources.website) parts.push("website");
    if (sources.tuesday) parts.push("tuesday");
    if (sources.manual) parts.push("manual");
    return parts.join(",");
  }, [sources]);

  return { sources, toggle, showAll, showNone, allOn, allOff, filterOrder, toQueryParam };
}

export type OrderSourceFilterHook = ReturnType<typeof useOrderSourceFilter>;

interface OrderSourceFilterProps {
  filter: OrderSourceFilterHook;
  testIdPrefix?: string;
}

export function OrderSourceFilter({ filter, testIdPrefix = "source" }: OrderSourceFilterProps) {
  const { sources, toggle, showAll, showNone, allOn, allOff } = filter;

  return (
    <div className="flex items-center gap-3 flex-wrap" data-testid={`${testIdPrefix}-filter`}>
      <label className="flex items-center gap-1.5 cursor-pointer text-sm" data-testid={`${testIdPrefix}-filter-website`}>
        <Checkbox
          checked={sources.website}
          onCheckedChange={() => toggle("website")}
          data-testid={`${testIdPrefix}-check-website`}
        />
        Website
      </label>
      <label className="flex items-center gap-1.5 cursor-pointer text-sm" data-testid={`${testIdPrefix}-filter-tuesday`}>
        <Checkbox
          checked={sources.tuesday}
          onCheckedChange={() => toggle("tuesday")}
          data-testid={`${testIdPrefix}-check-tuesday`}
        />
        Tuesday
      </label>
      <label className="flex items-center gap-1.5 cursor-pointer text-sm" data-testid={`${testIdPrefix}-filter-manual`}>
        <Checkbox
          checked={sources.manual}
          onCheckedChange={() => toggle("manual")}
          data-testid={`${testIdPrefix}-check-manual`}
        />
        Manual
      </label>
      <div className="flex items-center gap-1 ml-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={showAll}
          disabled={allOn}
          data-testid={`${testIdPrefix}-show-all`}
        >
          All
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={showNone}
          disabled={allOff}
          data-testid={`${testIdPrefix}-show-none`}
        >
          None
        </Button>
      </div>
    </div>
  );
}
