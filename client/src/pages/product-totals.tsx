import { DebugExportButton } from "@/components/debug-export-button";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, ChevronUp, ChevronDown, ChevronsUpDown, ChevronRight } from "lucide-react";
import { DateFilter, DateRangeLabel, useDateFilter } from "@/components/date-filter";
import { OrderSourceFilter, useOrderSourceFilter } from "@/components/order-source-filter";

type CustomerBreakdown = { customerName: string; quantity: number };

type ProductTotal = {
  productName: string;
  productId: number | null;
  totalOrdered: number;
  manualQuantity: number;
  customerBreakdown: CustomerBreakdown[];
};

type SortCol = "productName" | "totalOrdered" | "manualQuantity" | "total";
type SortDir = "asc" | "desc";

function SortIcon({ col, active, dir }: { col: SortCol; active: SortCol; dir: SortDir }) {
  if (col !== active) return <ChevronsUpDown className="w-3 h-3 ml-1 inline text-muted-foreground/40" />;
  return dir === "asc"
    ? <ChevronUp className="w-3 h-3 ml-1 inline text-foreground" />
    : <ChevronDown className="w-3 h-3 ml-1 inline text-foreground" />;
}

export default function ProductTotalsPage() {
  const dateFilter = useDateFilter();
  const sourceFilter = useOrderSourceFilter();
  const { from, to } = dateFilter;
  const [sortCol, setSortCol] = useState<SortCol>("productName");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);

  const { data: totals, isLoading } = useQuery<ProductTotal[]>({
    queryKey: ["/api/product-totals", `?from=${from.toISOString()}&to=${to.toISOString()}&source=${sourceFilter.toQueryParam()}`],
  });

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir(col === "productName" ? "asc" : "desc");
    }
  }

  function toggleExpand(productName: string) {
    setExpandedProduct(prev => prev === productName ? null : productName);
  }

  const sorted = totals ? [...totals].sort((a, b) => {
    let av: number | string, bv: number | string;
    if (sortCol === "productName") { av = a.productName.toLowerCase(); bv = b.productName.toLowerCase(); }
    else if (sortCol === "totalOrdered") { av = a.totalOrdered; bv = b.totalOrdered; }
    else if (sortCol === "manualQuantity") { av = a.manualQuantity; bv = b.manualQuantity; }
    else { av = a.totalOrdered + a.manualQuantity; bv = b.totalOrdered + b.manualQuantity; }
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  }) : [];

  const thClass = "cursor-pointer select-none whitespace-nowrap";

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-totals-title">Product Totals</h1>
          <DateRangeLabel from={from} to={to} />
        </div>
        <DebugExportButton page="product-totals" from={from} to={to}/><DateFilter {...dateFilter} testIdPrefix="totals" showMonth />
      </div>

      <OrderSourceFilter filter={sourceFilter} testIdPrefix="totals-source" />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !totals || totals.length === 0 ? (
            <div className="p-12 text-center">
              <BarChart3 className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground font-medium">No product data for this period</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[28px]"></TableHead>
                  <TableHead className={thClass} onClick={() => handleSort("productName")} data-testid="th-product">
                    Product <SortIcon col="productName" active={sortCol} dir={sortDir} />
                  </TableHead>
                  <TableHead className={`text-right ${thClass}`} onClick={() => handleSort("totalOrdered")} data-testid="th-online">
                    Online Orders <SortIcon col="totalOrdered" active={sortCol} dir={sortDir} />
                  </TableHead>
                  <TableHead className={`text-right ${thClass}`} onClick={() => handleSort("manualQuantity")} data-testid="th-manual">
                    Manual / Shop <SortIcon col="manualQuantity" active={sortCol} dir={sortDir} />
                  </TableHead>
                  <TableHead className={`text-right ${thClass}`} onClick={() => handleSort("total")} data-testid="th-total">
                    Total <SortIcon col="total" active={sortCol} dir={sortDir} />
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((t, idx) => {
                  const isExpanded = expandedProduct === t.productName;
                  const hasBreakdown = t.customerBreakdown && t.customerBreakdown.length > 0;
                  return (
                    <>
                      <TableRow
                        key={idx}
                        data-testid={`row-total-${idx}`}
                        className={hasBreakdown ? "cursor-pointer" : ""}
                        onClick={() => hasBreakdown && toggleExpand(t.productName)}
                      >
                        <TableCell className="pr-0 pl-3 w-[28px]">
                          {hasBreakdown ? (
                            <ChevronRight
                              className={`w-4 h-4 text-muted-foreground transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                            />
                          ) : null}
                        </TableCell>
                        <TableCell className="font-medium" data-testid={`text-total-product-${idx}`}>{t.productName}</TableCell>
                        <TableCell className="text-right" data-testid={`text-total-online-${idx}`}>{t.totalOrdered}</TableCell>
                        <TableCell className="text-right" data-testid={`text-total-manual-${idx}`}>{t.manualQuantity}</TableCell>
                        <TableCell className="text-right font-semibold" data-testid={`text-total-combined-${idx}`}>
                          {t.totalOrdered + t.manualQuantity}
                        </TableCell>
                      </TableRow>
                      {isExpanded && hasBreakdown && (
                        <TableRow key={`${idx}-breakdown`} className="bg-muted/40 hover:bg-muted/40">
                          <TableCell colSpan={5} className="p-0">
                            <div className="px-8 py-3">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Customer breakdown</p>
                              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-x-6 gap-y-1">
                                {t.customerBreakdown.map((c, ci) => (
                                  <div key={ci} className="flex items-center justify-between gap-2 text-sm" data-testid={`text-breakdown-${idx}-${ci}`}>
                                    <span className="text-foreground truncate">{c.customerName}</span>
                                    <span className="font-semibold text-foreground shrink-0">{c.quantity}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
