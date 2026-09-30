import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { MapPin, Route, Truck, Store, Loader2 } from "lucide-react";
import { DateFilter, DateRangeLabel, useDateFilter } from "@/components/date-filter";

const DEPOT = {
  customerName: "Unit 33 (Start)",
  address: "Unit 33, Enterprise Park, 147 Drakemire Dr, Glasgow G45 9EE",
  lat: 55.8156,
  lng: -4.2211,
};

type DeliveryAddress = {
  id: number;
  customerName: string;
  address: string;
  lat: number | null;
  lng: number | null;
  fulfillment: "delivery" | "collection";
  isManual: boolean;
  coordinateStatus?: "verified-local" | "recheck" | "missing";
};

type RoutePlan = {
  source: "osrm" | "none";
  orderedStopIds: number[];
  geometry: [number, number][];
  distanceMeters: number;
  durationSeconds: number;
  legs: Array<{ distanceMeters: number; durationSeconds: number }>;
};

export function DeliveryRoutesContent({ tuesday }: { tuesday: boolean }) {
  const dateFilter = useDateFilter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const polylineRef = useRef<any>(null);

  // geocodedAddresses starts as the raw API list and is updated in-place as coords resolve
  const [geocodedAddresses, setGeocodedAddresses] = useState<DeliveryAddress[]>([]);
  const [geocodeProgress, setGeocodeProgress] = useState<{ done: number; total: number } | null>(null);
  const [routePlan, setRoutePlan] = useState<RoutePlan | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);

  const { from, to } = dateFilter;

  const { data: addresses, isLoading } = useQuery<DeliveryAddress[]>({
    queryKey: ["/api/delivery-addresses", `?from=${from.toISOString()}&to=${to.toISOString()}&tuesday=${tuesday ? "true" : "false"}`],
  });

  // When the API data arrives, show it immediately then geocode missing coords incrementally
  useEffect(() => {
    if (!addresses) return;

    // Show all customers right away — counts, names, collection list are all known
    setGeocodedAddresses(addresses);

    const needsGeocode = addresses.filter(a => !a.lat || !a.lng);
    if (needsGeocode.length === 0) {
      setGeocodeProgress(null);
      return;
    }

    setGeocodeProgress({ done: 0, total: needsGeocode.length });

    let cancelled = false;
    let done = 0;

    (async () => {
      for (const addr of needsGeocode) {
        if (cancelled) break;
        try {
          const res = await apiRequest("POST", "/api/geocode", { address: addr.address, orderId: addr.id });
          const data = await res.json();
          if (!cancelled && (data.lat || data.lng)) {
            // Update just this address in state
            setGeocodedAddresses(prev =>
              prev.map(a => a.id === addr.id ? { ...a, lat: data.lat, lng: data.lng } : a)
            );
          }
        } catch {
          // skip, address stays without coords
        }
        done++;
        if (!cancelled) setGeocodeProgress({ done, total: needsGeocode.length });
        if (done < needsGeocode.length) await new Promise(r => setTimeout(r, 1100));
      }
      if (!cancelled) setGeocodeProgress(null);
    })();

    return () => { cancelled = true; };
  }, [addresses]);

  const deliveryCustomers = geocodedAddresses.filter(a => a.fulfillment === "delivery");
  const collectionCustomers = geocodedAddresses.filter(a => a.fulfillment === "collection");
  const deliveryStops = deliveryCustomers.filter(a => a.lat && a.lng);

  function optimizeRouteFallback(points: DeliveryAddress[]): DeliveryAddress[] {
    if (points.length === 0) return [];
    const remaining = [...points];
    const route: DeliveryAddress[] = [];
    let lastLat = DEPOT.lat;
    let lastLng = DEPOT.lng;

    while (remaining.length > 0) {
      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const latKm = (remaining[i].lat! - lastLat) * 111;
        const lngKm = (remaining[i].lng! - lastLng) * 111 * Math.cos(lastLat * Math.PI / 180);
        const dist = Math.sqrt(latKm * latKm + lngKm * lngKm);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }
      const next = remaining.splice(closestIdx, 1)[0];
      route.push(next);
      lastLat = next.lat!;
      lastLng = next.lng!;
    }

    return route;
  }

  // Ask the backend for a road-network route once geocoding settles. The backend
  // uses OSRM/OpenStreetMap and keeps the depot fixed as the starting point.
  useEffect(() => {
    if (deliveryStops.length === 0) {
      setRoutePlan(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setRouteLoading(true);
      try {
        const response = await apiRequest("POST", "/api/delivery-route/optimize", {
          stops: deliveryStops.map(stop => ({
            id: stop.id,
            lat: stop.lat,
            lng: stop.lng,
          })),
        });
        const plan = await response.json() as RoutePlan;
        if (!cancelled) setRoutePlan(plan);
      } catch {
        if (!cancelled) setRoutePlan(null);
      } finally {
        if (!cancelled) setRouteLoading(false);
      }
    }, 650);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [deliveryStops.map(stop => `${stop.id}:${stop.lat}:${stop.lng}`).join("|")]);

  const fallbackRouteStops = optimizeRouteFallback(deliveryStops);
  const plannedIds = routePlan?.orderedStopIds || [];
  const plannedIdSet = new Set(plannedIds);
  const routePlanIsComplete =
    plannedIds.length === deliveryStops.length &&
    deliveryStops.every(stop => plannedIdSet.has(stop.id));

  // Never allow a partial OSRM response to hide customers. If even one stop is
  // missing, fall back to the local optimiser for the complete set.
  const routeStops = routePlanIsComplete
    ? plannedIds
        .map(id => deliveryStops.find(stop => stop.id === id))
        .filter((stop): stop is DeliveryAddress => Boolean(stop))
    : fallbackRouteStops;

  // Update map markers/polyline whenever routeStops changes (incrementally as geocoding progresses)
  useEffect(() => {
    if (!mapRef.current) return;

    const loadMap = async () => {
      if (!document.querySelector('link[href*="leaflet"]')) {
        const cssLink = document.createElement("link");
        cssLink.rel = "stylesheet";
        cssLink.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
        document.head.appendChild(cssLink);
      }
      if (!(window as any).L) {
        await new Promise<void>((resolve) => {
          const script = document.createElement("script");
          script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
          script.onload = () => resolve();
          document.head.appendChild(script);
        });
      }

      const L = (window as any).L;

      // Initialise map once
      if (!mapInstanceRef.current) {
        const map = L.map(mapRef.current).setView([DEPOT.lat, DEPOT.lng], 11);
        mapInstanceRef.current = map;
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);

        const depotIcon = L.divIcon({
          html: '<div style="background:#16a34a;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);">S</div>',
          className: '', iconSize: [28, 28], iconAnchor: [14, 14],
        });
        const depotMarker = L.marker([DEPOT.lat, DEPOT.lng], { icon: depotIcon }).addTo(map);
        depotMarker.bindPopup(`<strong>Start: ${DEPOT.customerName}</strong><br/>${DEPOT.address}`);
      }

      const map = mapInstanceRef.current;

      // Clear existing stop markers and polyline
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      if (polylineRef.current) { polylineRef.current.remove(); polylineRef.current = null; }

      const bounds: [number, number][] = [[DEPOT.lat, DEPOT.lng]];

      routeStops.forEach((addr, idx) => {
        const stopIcon = L.divIcon({
          html: `<div style="background:#2563eb;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);">${idx + 1}</div>`,
          className: '', iconSize: [24, 24], iconAnchor: [12, 12],
        });
        const marker = L.marker([addr.lat!, addr.lng!], { icon: stopIcon }).addTo(map);
        marker.bindPopup(`<strong>${idx + 1}. ${addr.customerName}</strong><br/>${addr.address}`);
        markersRef.current.push(marker);
        bounds.push([addr.lat!, addr.lng!]);
      });

      if (routeStops.length > 0) {
        const routeCoords: [number, number][] =
          routePlanIsComplete && routePlan?.geometry?.length
            ? routePlan.geometry
            : [
                [DEPOT.lat, DEPOT.lng],
                ...routeStops.map(a => [a.lat!, a.lng!] as [number, number]),
              ];

        polylineRef.current = L.polyline(routeCoords, {
          color: "#2563eb",
          weight: 4,
          opacity: 0.82,
          lineJoin: "round",
          lineCap: "round",
        }).addTo(map);

        for (const coord of routeCoords) bounds.push(coord);
        map.fitBounds(bounds, { padding: [35, 35] });
      }
    };

    loadMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersRef.current = [];
        polylineRef.current = null;
      }
    };
  }, [routeStops.map(s => s.id).join(","), routePlan?.geometry?.length ?? 0]);

  const title = tuesday ? "Tuesday Delivery Route" : "Saturday Delivery Route";
  const testPrefix = tuesday ? "tuesday" : "saturday";

  const routeMiles = routePlan?.distanceMeters
    ? routePlan.distanceMeters / 1609.344
    : null;
  const routeMinutes = routePlan?.durationSeconds
    ? Math.round(routePlan.durationSeconds / 60)
    : null;
  const unresolvedCount = deliveryCustomers.filter(customer => !customer.lat || !customer.lng).length;

  const formatLegDistance = (meters: number) => {
    const miles = meters / 1609.344;
    return miles < 0.1 ? `${Math.round(meters)} m` : `${miles.toFixed(1)} mi`;
  };

  const formatLegTime = (seconds: number) => {
    const minutes = Math.max(1, Math.round(seconds / 60));
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };
  const geocodingRemaining = geocodeProgress ? geocodeProgress.total - geocodeProgress.done : 0;
  const geocodingPct = geocodeProgress
    ? Math.round((geocodeProgress.done / geocodeProgress.total) * 100)
    : 100;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid={`text-${testPrefix}-routes-title`}>
            {title}
          </h1>
          <DateRangeLabel from={from} to={to} />
        </div>
        <DateFilter {...dateFilter} testIdPrefix={`${testPrefix}-route`} />
      </div>

      {/* Geocoding progress banner — visible only while resolving addresses */}
      {geocodeProgress && (
        <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 px-4 py-3 space-y-2" data-testid="banner-geocoding-progress">
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-medium">
              <Loader2 className="w-4 h-4 animate-spin" />
              Resolving addresses — {geocodingRemaining} remaining
            </span>
            <span className="text-blue-600 dark:text-blue-400 tabular-nums text-xs">
              {geocodeProgress.done} / {geocodeProgress.total}
            </span>
          </div>
          <Progress value={geocodingPct} className="h-1.5" />
        </div>
      )}

      <Card data-testid="card-fulfillment-breakdown">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-3">Customer Breakdown</h3>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[1,2,3].map(i => <Skeleton key={i} className="h-16 w-full rounded-md" />)}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50" data-testid="tile-delivery-count">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex-shrink-0">
                  <Truck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold leading-none" data-testid="text-delivery-count">{deliveryCustomers.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Delivery</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {deliveryCustomers.filter(c => !c.isManual).length} website · {deliveryCustomers.filter(c => c.isManual).length} custom
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50" data-testid="tile-collection-count">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30 flex-shrink-0">
                  <Store className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold leading-none" data-testid="text-collection-count">{collectionCustomers.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Collection</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {collectionCustomers.filter(c => !c.isManual).length} website · {collectionCustomers.filter(c => c.isManual).length} custom
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50" data-testid="tile-total-count">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30 flex-shrink-0">
                  <MapPin className="w-5 h-5 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-2xl font-bold leading-none" data-testid="text-total-customers">{geocodedAddresses.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Total</p>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {geocodedAddresses.filter(c => !c.isManual).length} website · {geocodedAddresses.filter(c => c.isManual).length} custom
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Customer lists — shown immediately from API data, no waiting for geocoding */}
          {(deliveryCustomers.length > 0 || collectionCustomers.length > 0) && (
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {deliveryCustomers.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <Truck className="w-3 h-3" /> Delivery Customers
                  </h4>
                  <div className="space-y-1">
                    {deliveryCustomers.map(c => (
                      <div key={c.id} className="flex items-center gap-2 text-sm py-1" data-testid={`text-delivery-customer-${c.id}`}>
                        <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-blue-600 shrink-0">Delivery</Badge>
                        <span className="truncate">{c.customerName}</span>
                        {(!c.lat || !c.lng) && geocodeProgress && (
                          <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/50 shrink-0 ml-auto" />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {collectionCustomers.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                    <Store className="w-3 h-3" /> Collection Customers
                  </h4>
                  <div className="space-y-1">
                    {collectionCustomers.map(c => (
                      <div key={c.id} className="flex items-center gap-2 text-sm py-1" data-testid={`text-collection-customer-${c.id}`}>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">Collection</Badge>
                        <span className="truncate">{c.customerName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-0 relative">
              {isLoading ? (
                <div className="h-[500px] flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  </div>
                </div>
              ) : deliveryCustomers.length === 0 ? (
                <div className="h-[500px] flex items-center justify-center">
                  <div className="text-center">
                    <Truck className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
                    <p className="text-muted-foreground font-medium">No delivery stops to map</p>
                    <p className="text-sm text-muted-foreground mt-1">Only delivery orders appear on this route</p>
                  </div>
                </div>
              ) : (
                <>
                  <div ref={mapRef} className="h-[500px] rounded-md" data-testid="map-container" />
                  {/* Overlay progress on map corner while geocoding */}
                  {geocodeProgress && (
                    <div className="absolute bottom-3 left-3 bg-white/90 dark:bg-black/80 backdrop-blur-sm rounded-md px-3 py-2 shadow text-xs flex items-center gap-2 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-700">
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      <span>Mapping {deliveryStops.length} of {deliveryCustomers.length} stops on UK roads…</span>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 space-y-2">
                <h3 className="text-sm font-medium flex items-center gap-2">
                  <Route className="w-4 h-4" />
                  Planned Route
                  <Badge variant="secondary">{routeStops.length} stops</Badge>
                  {(geocodeProgress || routeLoading) && (
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {routeLoading ? "optimising roads…" : "updating…"}
                    </span>
                  )}
                </h3>

                <div className="flex flex-wrap gap-2 text-[11px]">
                  {routeMiles !== null && (
                    <Badge variant="outline">{routeMiles.toFixed(1)} miles</Badge>
                  )}
                  {routeMinutes !== null && (
                    <Badge variant="outline">{formatLegTime(routePlan!.durationSeconds)}</Badge>
                  )}
                  <Badge variant="outline">
                    {routePlan?.source === "osrm" && routePlanIsComplete ? "Road-network route" : "Complete fallback route"}
                  </Badge>
                  {unresolvedCount > 0 && (
                    <Badge variant="outline" className="border-amber-300 text-amber-700">
                      {unresolvedCount} address{unresolvedCount !== 1 ? "es" : ""} unresolved
                    </Badge>
                  )}
                </div>
              </div>
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : (
                <div className="space-y-2 max-h-[440px] overflow-y-auto">
                  <div
                    className="flex items-start gap-3 p-2 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                    data-testid="card-stop-depot"
                  >
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-green-600 text-white text-xs font-bold flex-shrink-0 mt-0.5">
                      S
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium" data-testid="text-stop-depot-name">Unit 33 (Start)</p>
                      <p className="text-xs text-muted-foreground truncate">Enterprise Park, 147 Drakemire Dr, Glasgow G45 9EE</p>
                    </div>
                  </div>

                  {routeStops.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                      {geocodeProgress
                        ? `Resolving addresses… (${geocodeProgress.done}/${geocodeProgress.total})`
                        : "No delivery stops for this period"}
                    </p>
                  ) : (
                    routeStops.map((addr, idx) => (
                      <div
                        key={addr.id}
                        className="flex items-start gap-3 p-2 rounded-md bg-muted/50"
                        data-testid={`card-stop-${addr.id}`}
                      >
                        <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-medium flex-shrink-0 mt-0.5">
                          {idx + 1}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate" data-testid={`text-stop-name-${addr.id}`}>{addr.customerName}</p>
                          <p className="text-xs text-muted-foreground truncate" data-testid={`text-stop-address-${addr.id}`}>{addr.address}</p>
                          {routePlanIsComplete && routePlan?.legs?.[idx] && (
                            <p className="text-[10px] text-muted-foreground/80 mt-0.5">
                              from previous: {formatLegDistance(routePlan.legs[idx].distanceMeters)} · {formatLegTime(routePlan.legs[idx].durationSeconds)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))
                  )}

                  {/* Unresolved delivery customers shown at the bottom while geocoding */}
                  {geocodeProgress && deliveryCustomers.filter(c => !c.lat || !c.lng).map(c => (
                    <div
                      key={c.id}
                      className="flex items-start gap-3 p-2 rounded-md bg-muted/30 opacity-60"
                      data-testid={`card-stop-pending-${c.id}`}
                    >
                      <div className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-dashed border-muted-foreground/40 flex-shrink-0 mt-0.5">
                        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/50" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{c.customerName}</p>
                        <p className="text-xs text-muted-foreground/60 truncate">resolving address…</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function DeliveryRoutesPage() {
  return <DeliveryRoutesContent tuesday={false} />;
}
