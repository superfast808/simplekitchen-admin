import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { addDays, format, parseISO } from "date-fns";
import {
  Store, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Minus, Plus, CheckCircle2,
  Circle, Settings2, Stamp, Undo2, PackageCheck, Loader2,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Day = "sat" | "tue";
type Line = { productName: string; productKey: string; supplied: number; sold: number | null; returned: number | null; unitPricePence: number };
type Drop = { day: Day; stamped: boolean; lines: Line[] };
type HistoryWeek = { weekStart: string; supplied: number; sold: number; returned: number; toCount: number };
type Shop = { key: string; name: string; pricePerItemPence: number | null; drops: Drop[]; history: HistoryWeek[] };
type WeekData = { week: { offset: number; start: string }; shops: Shop[] };
type ShopList = { shops: { key: string; name: string; pricePerItemPence: number | null }[]; consistentCustomers: { key: string; name: string }[] };
type Count = { sold: number | null; returned: number | null };

const DAY_LABEL: Record<Day, string> = { sat: "Saturday drop", tue: "Tuesday drop" };
const money = (pence: number) => `£${(pence / 100).toFixed(2)}`;
const lineId = (shop: string, day: Day, product: string) => `${shop}|${day}|${product}`;

function weekLabel(start: string) {
  const sat = parseISO(start);
  return `${format(sat, "EEE d MMM")} – ${format(addDays(sat, 5), "EEE d MMM")}`;
}

function totalsOf(lines: (Line & Count)[]) {
  let supplied = 0, sold = 0, returned = 0, toCount = 0, owed = 0, uncounted = 0;
  for (const l of lines) {
    supplied += l.supplied;
    sold += l.sold ?? 0;
    returned += l.returned ?? 0;
    owed += (l.sold ?? 0) * l.unitPricePence;
    const counted = l.sold !== null || l.returned !== null;
    if (!counted && l.supplied > 0) uncounted++;
    toCount += counted ? Math.max(0, l.supplied - (l.sold ?? 0) - (l.returned ?? 0)) : l.supplied;
  }
  return { supplied, sold, returned, toCount, owed, uncounted };
}

/** Big, thumb-friendly number control. */
function Stepper({ value, max, onChange, label, tone, testId }: {
  value: number | null; max: number | null; onChange: (v: number) => void; label: string; tone: "sold" | "back"; testId: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.max(0, max === null ? n : Math.min(max, n));
  const commit = (raw: string) => {
    setDraft(null);
    if (raw.trim() === "") return;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) onChange(clamp(n));
  };
  const color = tone === "sold" ? "text-emerald-700 dark:text-emerald-400" : "text-sky-700 dark:text-sky-400";
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-[11px] font-semibold uppercase tracking-wide ${color}`}>{label}</span>
      <div className="flex items-center rounded-lg border bg-background">
        <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-r-none"
          aria-label={`One less ${label.toLowerCase()}`} disabled={(value ?? 0) <= 0}
          onClick={() => onChange(clamp((value ?? 0) - 1))} data-testid={`${testId}-minus`}>
          <Minus className="h-4 w-4" />
        </Button>
        <Input
          inputMode="numeric" pattern="[0-9]*" aria-label={label}
          className="h-10 w-12 rounded-none border-0 border-x px-0 text-center text-lg font-semibold focus-visible:ring-0"
          placeholder="?"
          value={draft ?? (value === null ? "" : String(value))}
          onFocus={e => e.currentTarget.select()}
          onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={e => commit(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          data-testid={`${testId}-input`}
        />
        <Button type="button" variant="ghost" size="icon" className="h-10 w-10 rounded-l-none"
          aria-label={`One more ${label.toLowerCase()}`} disabled={max !== null && (value ?? 0) >= max}
          onClick={() => onChange(clamp((value ?? 0) + 1))} data-testid={`${testId}-plus`}>
          <Plus className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** Tiny bar chart of the last 6 weeks' sell-through. */
function SellThrough({ history }: { history: HistoryWeek[] }) {
  const counted = history.filter(h => h.supplied > 0 && h.toCount === 0);
  const supplied = counted.reduce((n, h) => n + h.supplied, 0);
  const sold = counted.reduce((n, h) => n + h.sold, 0);
  if (!history.some(h => h.supplied > 0)) return null;
  return (
    <div className="flex items-end gap-2" title="Share of supplied items sold, last 6 weeks">
      <div className="flex h-7 items-end gap-0.5">
        {history.map(h => {
          const pct = h.supplied > 0 ? h.sold / h.supplied : 0;
          const done = h.supplied > 0 && h.toCount === 0;
          return (
            <div key={h.weekStart}
              title={h.supplied === 0 ? `w/c ${format(parseISO(h.weekStart), "d MMM")}: nothing supplied`
                : done ? `w/c ${format(parseISO(h.weekStart), "d MMM")}: sold ${h.sold} of ${h.supplied}`
                : `w/c ${format(parseISO(h.weekStart), "d MMM")}: not fully counted`}
              className="flex h-7 w-2 items-end rounded-sm bg-muted">
              <div className={`w-full rounded-sm ${done ? "bg-emerald-500" : "bg-amber-300"}`}
                style={{ height: h.supplied === 0 ? 0 : done ? `${Math.max(8, pct * 100)}%` : "100%" }} />
            </div>
          );
        })}
      </div>
      {supplied > 0 && (
        <span className="text-xs text-muted-foreground leading-tight">
          <span className="font-semibold text-foreground">{Math.round((sold / supplied) * 100)}%</span> sold<br />last 6 wks
        </span>
      )}
    </div>
  );
}

export default function ShopReturnsPage() {
  const { toast } = useToast();
  const [offset, setOffset] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, Count>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [manageOpen, setManageOpen] = useState(false);
  const [saving, setSaving] = useState<Record<string, "saving" | "saved" | "error">>({});
  const pending = useRef<Record<string, { shopKey: string; day: Day; weekStart: string; lines: Record<string, { productName: string } & Count> }>>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const focusShop = useMemo(() => new URLSearchParams(window.location.search).get("shop"), []);

  const { data, isLoading, isError } = useQuery<WeekData>({
    queryKey: ["/api/shop-returns/week", `?offset=${offset}`],
    staleTime: 0,
  });

  // Once the server reflects an edit, drop the local override for it.
  useEffect(() => {
    if (!data) return;
    setOverrides(prev => {
      const next = { ...prev };
      for (const shop of data.shops) for (const drop of shop.drops) for (const l of drop.lines) {
        const id = lineId(shop.key, drop.day, l.productKey);
        const o = next[id];
        if (o && o.sold === l.sold && o.returned === l.returned) delete next[id];
      }
      return next;
    });
  }, [data]);

  // Flush unsaved counts before leaving the week or the page.
  const flushAll = () => Object.keys(timers.current).forEach(k => { clearTimeout(timers.current[k]); void save(k); });
  useEffect(() => () => flushAll(), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(groupId: string) {
    const group = pending.current[groupId];
    delete pending.current[groupId];
    delete timers.current[groupId];
    if (!group) return;
    setSaving(s => ({ ...s, [group.shopKey]: "saving" }));
    try {
      await apiRequest("PUT", "/api/shop-returns/counts", {
        shopKey: group.shopKey, weekStart: group.weekStart, day: group.day,
        lines: Object.values(group.lines),
      });
      setSaving(s => ({ ...s, [group.shopKey]: "saved" }));
      queryClient.invalidateQueries({ queryKey: ["/api/shop-returns/week"] });
    } catch (e: any) {
      setSaving(s => ({ ...s, [group.shopKey]: "error" }));
      toast({ title: "Couldn't save that count", description: e.message, variant: "destructive" });
    }
  }

  function setCounts(shop: Shop, day: Day, changes: { line: Line; value: Count }[]) {
    if (!data) return;
    setOverrides(prev => {
      const next = { ...prev };
      for (const { line, value } of changes) next[lineId(shop.key, day, line.productKey)] = value;
      return next;
    });
    const groupId = `${shop.key}|${data.week.start}|${day}`;
    const group = pending.current[groupId] ??= { shopKey: shop.key, day, weekStart: data.week.start, lines: {} };
    for (const { line, value } of changes) group.lines[line.productKey] = { productName: line.productName, ...value };
    clearTimeout(timers.current[groupId]);
    timers.current[groupId] = setTimeout(() => void save(groupId), 600);
    setSaving(s => ({ ...s, [shop.key]: "saving" }));
  }

  const merged = (shop: Shop, day: Day, l: Line): Line => {
    const o = overrides[lineId(shop.key, day, l.productKey)];
    return o ? { ...l, ...o } : l;
  };

  /** Sold + back always add up to what was supplied — whatever doesn't come back is sold. */
  function changeOne(shop: Shop, day: Day, line: Line, field: "sold" | "returned", value: number) {
    const balance = line.supplied > 0;
    const other = balance ? Math.max(0, line.supplied - value) : (field === "sold" ? line.returned : line.sold) ?? 0;
    setCounts(shop, day, [{ line, value: field === "sold" ? { sold: value, returned: other } : { sold: other, returned: value } }]);
  }

  const goToWeek = (o: number) => { flushAll(); setOffset(o); };

  const shops = data?.shops ?? [];
  const weekTotals = totalsOf(shops.flatMap(s => s.drops.flatMap(d => d.lines.map(l => merged(s, d.day, l)))));
  const anyPrices = shops.some(s => s.drops.some(d => d.lines.some(l => l.unitPricePence > 0)));

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 pb-28 md:p-6 md:pb-28">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight" data-testid="text-shop-returns-title">
            <Store className="h-6 w-6" />Shop Sales &amp; Returns
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sale or return: count what each shop sent back. Whatever didn't come back is counted as sold.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setManageOpen(true)} data-testid="button-manage-shops">
          <Settings2 className="mr-1.5 h-4 w-4" />Choose shops
        </Button>
      </div>

      {/* Week picker */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-3">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => goToWeek(offset - 1)} aria-label="Previous week" data-testid="button-week-prev">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-[11rem] px-2 text-center">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {offset === 0 ? "This week" : offset === -1 ? "Last week" : offset < 0 ? `${-offset} weeks ago` : "Next week"}
              </div>
              <div className="font-semibold" data-testid="text-week-label">{data ? weekLabel(data.week.start) : "…"}</div>
            </div>
            <Button variant="outline" size="icon" className="h-10 w-10" onClick={() => goToWeek(offset + 1)} disabled={offset >= 0} aria-label="Next week" data-testid="button-week-next">
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant={offset === -1 ? "default" : "outline"} onClick={() => goToWeek(-1)} data-testid="button-last-week">Last week</Button>
            <Button size="sm" variant={offset === 0 ? "default" : "outline"} onClick={() => goToWeek(0)} data-testid="button-this-week">This week</Button>
          </div>
        </CardContent>
      </Card>

      {isError && <p className="text-destructive">Couldn't load shop counts. Please refresh.</p>}

      {isLoading ? (
        <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-40 w-full" />)}</div>
      ) : shops.length === 0 ? (
        <Card>
          <CardContent className="space-y-3 p-8 text-center">
            <Store className="mx-auto h-10 w-10 text-muted-foreground/50" />
            <p className="font-medium">No sale-or-return shops yet</p>
            <p className="text-sm text-muted-foreground">Pick which of your consistent customers are shops. Their stamped orders become what you supplied.</p>
            <Button onClick={() => setManageOpen(true)} data-testid="button-choose-shops-empty">Choose shops</Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Week summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryTile label="Supplied" value={weekTotals.supplied} />
            <SummaryTile label="Sold" value={weekTotals.sold} tone="text-emerald-700 dark:text-emerald-400" />
            <SummaryTile label="Came back" value={weekTotals.returned} tone="text-sky-700 dark:text-sky-400" />
            {anyPrices
              ? <SummaryTile label="Owed by shops" value={money(weekTotals.owed)} />
              : <SummaryTile label="Still to count" value={weekTotals.toCount} tone={weekTotals.toCount ? "text-amber-600" : undefined} />}
          </div>

          {shops.map(shop => {
            const drops = shop.drops.map(d => ({ ...d, lines: d.lines.map(l => merged(shop, d.day, l)) }));
            const t = totalsOf(drops.flatMap(d => d.lines));
            const nothing = t.supplied === 0 && drops.every(d => d.lines.length === 0);
            const done = !nothing && t.uncounted === 0;
            const open = expanded[shop.key] ?? (focusShop ? focusShop === shop.key : !done);
            const status = saving[shop.key];
            return (
              <Card key={shop.key} className={done ? "border-emerald-300 dark:border-emerald-800" : undefined} data-testid={`card-shop-${shop.key}`}>
                <CardContent className="p-0">
                  <button className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left"
                    onClick={() => setExpanded(e => ({ ...e, [shop.key]: !open }))} data-testid={`button-toggle-shop-${shop.key}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-lg font-semibold">{shop.name}</span>
                        {nothing ? <Badge variant="secondary">Nothing supplied</Badge>
                          : done ? <Badge className="bg-emerald-600 hover:bg-emerald-600"><CheckCircle2 className="mr-1 h-3 w-3" />All counted</Badge>
                          : <Badge className="bg-amber-500 hover:bg-amber-500">{t.uncounted} to count</Badge>}
                        {status === "saving" && <span className="flex items-center text-xs text-muted-foreground"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Saving</span>}
                        {status === "saved" && <span className="text-xs text-emerald-600">Saved</span>}
                        {status === "error" && <span className="text-xs text-destructive">Not saved</span>}
                      </div>
                      {!nothing && (
                        <div className="mt-1 text-sm text-muted-foreground">
                          {t.supplied} supplied · <span className="text-emerald-700 dark:text-emerald-400">{t.sold} sold</span> · <span className="text-sky-700 dark:text-sky-400">{t.returned} back</span>
                          {t.owed > 0 && <> · <span className="font-semibold text-foreground">{money(t.owed)} owed</span></>}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <SellThrough history={shop.history} />
                      {open ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
                    </div>
                  </button>

                  {open && (
                    <div className="space-y-4 border-t p-3 sm:p-4">
                      {drops.length === 0 && (
                        <p className="text-sm text-muted-foreground">This shop has no Saturday or Tuesday consistent order set up.</p>
                      )}
                      {drops.map(drop => {
                        const dt = totalsOf(drop.lines);
                        return (
                          <div key={drop.day} className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className={`h-2.5 w-2.5 rounded-full ${drop.day === "sat" ? "bg-primary" : "bg-amber-500"}`} />
                                <span className="font-medium">{DAY_LABEL[drop.day]}</span>
                                {dt.supplied > 0 && <span className="text-sm text-muted-foreground">{dt.supplied} items</span>}
                              </div>
                              {drop.lines.some(l => l.supplied > 0) && (
                                <div className="flex gap-2">
                                  <Button size="sm" variant="outline" className="h-8"
                                    onClick={() => setCounts(shop, drop.day, drop.lines.filter(l => l.supplied > 0).map(line => ({ line, value: { sold: line.supplied, returned: 0 } })))}
                                    data-testid={`button-all-sold-${shop.key}-${drop.day}`}>
                                    <PackageCheck className="mr-1 h-4 w-4" />All sold
                                  </Button>
                                  {drop.lines.some(l => l.sold !== null || l.returned !== null) && (
                                    <Button size="sm" variant="ghost" className="h-8 text-muted-foreground"
                                      onClick={() => setCounts(shop, drop.day, drop.lines.map(line => ({ line, value: { sold: null, returned: null } })))}
                                      data-testid={`button-clear-${shop.key}-${drop.day}`}>
                                      <Undo2 className="mr-1 h-4 w-4" />Clear
                                    </Button>
                                  )}
                                </div>
                              )}
                            </div>

                            {drop.lines.length === 0 ? (
                              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                                <span><Stamp className="mr-1 inline h-4 w-4" />Not stamped this week, so there's nothing to count.</span>
                                <Link href="/" className="font-medium text-primary underline-offset-2 hover:underline">Go to Consistent Customers</Link>
                              </div>
                            ) : (
                              <div className="divide-y rounded-lg border">
                                {drop.lines.map(line => {
                                  const counted = line.sold !== null || line.returned !== null;
                                  const id = `${shop.key}-${drop.day}-${line.productKey}`.replace(/[^a-z0-9-]/gi, "_");
                                  return (
                                    <div key={line.productKey} className={`flex flex-col gap-3 p-3 sm:flex-row sm:items-center ${counted ? "" : "bg-amber-50/60 dark:bg-amber-950/20"}`}>
                                      <div className="flex min-w-0 flex-1 items-start gap-2">
                                        {counted
                                          ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
                                          : <Circle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />}
                                        <div className="min-w-0">
                                          <div className="font-medium leading-snug">{line.productName}</div>
                                          <div className="text-sm text-muted-foreground">
                                            {line.supplied > 0 ? <><span className="font-semibold text-foreground">{line.supplied}</span> supplied</> : "Not on this week's stamp"}
                                            {counted && line.unitPricePence > 0 && (line.sold ?? 0) > 0 && <> · {money((line.sold ?? 0) * line.unitPricePence)}</>}
                                          </div>
                                        </div>
                                      </div>
                                      <div className="flex justify-center gap-3 sm:justify-end">
                                        <Stepper label="Sold" tone="sold" value={line.sold} max={line.supplied > 0 ? line.supplied : null}
                                          onChange={v => changeOne(shop, drop.day, line, "sold", v)} testId={`sold-${id}`} />
                                        <Stepper label="Came back" tone="back" value={line.returned} max={line.supplied > 0 ? line.supplied : null}
                                          onChange={v => changeOne(shop, drop.day, line, "returned", v)} testId={`back-${id}`} />
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          <p className="text-center text-xs text-muted-foreground">
            "Supplied" comes from each shop's stamped orders. If a delivery changed, amend the stamp on the Orders page and it updates here.
          </p>
        </>
      )}

      <ManageShopsDialog open={manageOpen} onOpenChange={setManageOpen} />
    </div>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function ManageShopsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const { data } = useQuery<ShopList>({ queryKey: ["/api/shop-returns/shops"], enabled: open, staleTime: 0 });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/shop-returns/shops"] });
    queryClient.invalidateQueries({ queryKey: ["/api/shop-returns/week"] });
  };
  const onError = (e: Error) => toast({ title: "Couldn't update shop", description: e.message, variant: "destructive" });
  const toggle = useMutation({
    mutationFn: ({ name, key, on }: { name: string; key: string; on: boolean }) => on
      ? apiRequest("POST", "/api/shop-returns/shops", { name })
      : apiRequest("DELETE", `/api/shop-returns/shops/${encodeURIComponent(key)}`),
    onSuccess: refresh, onError,
  });
  const price = useMutation({
    mutationFn: ({ key, pence }: { key: string; pence: number | null }) =>
      apiRequest("PATCH", `/api/shop-returns/shops/${encodeURIComponent(key)}`, { pricePerItemPence: pence }),
    onSuccess: () => { refresh(); toast({ title: "Price saved" }); }, onError,
  });

  const shopKeys = new Map((data?.shops ?? []).map(s => [s.key, s]));
  const rows = [
    ...(data?.consistentCustomers ?? []),
    ...(data?.shops ?? []).filter(s => !(data?.consistentCustomers ?? []).some(c => c.key === s.key)),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Which customers are sale-or-return shops?</DialogTitle>
          <DialogDescription>
            Switch on each shop. Optionally set what the shop pays you per item; leave it blank to use each product's normal price.
          </DialogDescription>
        </DialogHeader>
        {!data ? <Skeleton className="h-32 w-full" /> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No consistent customers yet. Add them on the Orders page first.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {rows.map(row => {
              const shop = shopKeys.get(row.key);
              return (
                <div key={row.key} className="space-y-2 p-3">
                  <label className="flex cursor-pointer items-center justify-between gap-3">
                    <span className="font-medium">{row.name}</span>
                    <Switch checked={!!shop} disabled={toggle.isPending}
                      onCheckedChange={on => toggle.mutate({ name: row.name, key: row.key, on })}
                      data-testid={`switch-shop-${row.key}`} />
                  </label>
                  {shop && <PriceField key={`${shop.key}-${shop.pricePerItemPence}`} pence={shop.pricePerItemPence}
                    onSave={pence => price.mutate({ key: shop.key, pence })} />}
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PriceField({ pence, onSave }: { pence: number | null; onSave: (p: number | null) => void }) {
  const [value, setValue] = useState(pence === null ? "" : (pence / 100).toFixed(2));
  const commit = () => {
    const trimmed = value.trim();
    const next = trimmed === "" ? null : Math.round(Number(trimmed) * 100);
    if (next !== null && (!Number.isFinite(next) || next < 0)) return setValue(pence === null ? "" : (pence / 100).toFixed(2));
    if (next !== pence) onSave(next);
  };
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Shop pays per item</span>
      <div className="relative w-24">
        <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground">£</span>
        <Input inputMode="decimal" className="h-8 pl-5" placeholder="normal" value={value}
          onChange={e => setValue(e.target.value.replace(/[^0-9.]/g, ""))}
          onBlur={commit} onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </div>
    </div>
  );
}
