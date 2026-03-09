import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MapPin, Route, Navigation, Truck, Store, Home } from "lucide-react";
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
};

export default function DeliveryRoutesPage() {
  const dateFilter = useDateFilter();
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [geocodedAddresses, setGeocodedAddresses] = useState<DeliveryAddress[]>([]);
  const [isGeocoding, setIsGeocoding] = useState(false);

  const { from, to } = dateFilter;

  const { data: addresses, isLoading } = useQuery<DeliveryAddress[]>({
    queryKey: ["/api/delivery-addresses", `?from=${from.toISOString()}&to=${to.toISOString()}`],
  });

  useEffect(() => {
    if (addresses) {
      geocodeAddresses(addresses);
    }
  }, [addresses]);

  async function geocodeAddresses(addrs: DeliveryAddress[]) {
    setIsGeocoding(true);
    const results: DeliveryAddress[] = [];
    for (const addr of addrs) {
      if (addr.lat && addr.lng) {
        results.push(addr);
      } else if (addr.address) {
        try {
          const res = await apiRequest("POST", "/api/geocode", { address: addr.address, orderId: addr.id });
          const data = await res.json();
          results.push({ ...addr, lat: data.lat, lng: data.lng });
        } catch {
          results.push(addr);
        }
        await new Promise(r => setTimeout(r, 1100));
      } else {
        results.push(addr);
      }
    }
    setGeocodedAddresses(results);
    setIsGeocoding(false);
  }

  const deliveryCustomers = geocodedAddresses.filter(a => a.fulfillment === "delivery");
  const collectionCustomers = geocodedAddresses.filter(a => a.fulfillment === "collection");
  const deliveryStops = deliveryCustomers.filter(a => a.lat && a.lng);

  function optimizeRoute(points: DeliveryAddress[]): DeliveryAddress[] {
    if (points.length === 0) return [];
    const remaining = [...points];
    const route: DeliveryAddress[] = [];
    let lastLat = DEPOT.lat;
    let lastLng = DEPOT.lng;

    while (remaining.length > 0) {
      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const dist = Math.sqrt(
          Math.pow((remaining[i].lat! - lastLat), 2) +
          Math.pow((remaining[i].lng! - lastLng), 2)
        );
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

  const routeStops = optimizeRoute(deliveryStops);

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
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
      }

      const map = L.map(mapRef.current).setView([DEPOT.lat, DEPOT.lng], 11);
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const bounds: [number, number][] = [];

      const depotIcon = L.divIcon({
        html: '<div style="background:#16a34a;color:white;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:14px;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);">S</div>',
        className: '',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      const depotMarker = L.marker([DEPOT.lat, DEPOT.lng], { icon: depotIcon }).addTo(map);
      depotMarker.bindPopup(`<strong>Start: ${DEPOT.customerName}</strong><br/>${DEPOT.address}`);
      bounds.push([DEPOT.lat, DEPOT.lng]);

      routeStops.forEach((addr, idx) => {
        const stopIcon = L.divIcon({
          html: `<div style="background:#2563eb;color:white;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3);">${idx + 1}</div>`,
          className: '',
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const marker = L.marker([addr.lat!, addr.lng!], { icon: stopIcon }).addTo(map);
        marker.bindPopup(`<strong>${idx + 1}. ${addr.customerName}</strong><br/>${addr.address}`);
        bounds.push([addr.lat!, addr.lng!]);
      });

      if (routeStops.length > 0) {
        const routeCoords: [number, number][] = [
          [DEPOT.lat, DEPOT.lng],
          ...routeStops.map(a => [a.lat!, a.lng!] as [number, number]),
        ];
        L.polyline(routeCoords, { color: "#2563eb", weight: 3, opacity: 0.7 }).addTo(map);
      }

      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    };

    loadMap();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, [routeStops]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-routes-title">Planned Delivery Route</h1>
          <DateRangeLabel from={from} to={to} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DateFilter {...dateFilter} testIdPrefix="route" />
        </div>
      </div>

      <Card data-testid="card-fulfillment-breakdown">
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-3">Customer Breakdown</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50" data-testid="tile-delivery-count">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Truck className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-delivery-count">{deliveryCustomers.length}</p>
                <p className="text-xs text-muted-foreground">Delivery</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50" data-testid="tile-collection-count">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-amber-100 dark:bg-amber-900/30">
                <Store className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-collection-count">{collectionCustomers.length}</p>
                <p className="text-xs text-muted-foreground">Collection</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-md bg-muted/50" data-testid="tile-total-count">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/30">
                <MapPin className="w-5 h-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-customers">{geocodedAddresses.length}</p>
                <p className="text-xs text-muted-foreground">Total</p>
              </div>
            </div>
          </div>

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
                        <Badge variant="default" className="text-[10px] px-1.5 py-0 bg-blue-600">Delivery</Badge>
                        <span className="truncate">{c.customerName}</span>
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
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">Collection</Badge>
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
            <CardContent className="p-0">
              {isLoading || isGeocoding ? (
                <div className="h-[500px] flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      {isGeocoding ? "Geocoding addresses..." : "Loading..."}
                    </p>
                  </div>
                </div>
              ) : deliveryStops.length === 0 ? (
                <div className="h-[500px] flex items-center justify-center">
                  <div className="text-center">
                    <Truck className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
                    <p className="text-muted-foreground font-medium">No delivery stops to map</p>
                    <p className="text-sm text-muted-foreground mt-1">Only delivery orders appear on this route</p>
                  </div>
                </div>
              ) : (
                <div ref={mapRef} className="h-[500px] rounded-md" data-testid="map-container" />
              )}
            </CardContent>
          </Card>
        </div>

        <div>
          <Card>
            <CardContent className="p-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <Route className="w-4 h-4" />
                Planned Route
                <Badge variant="secondary">{routeStops.length} stops</Badge>
              </h3>
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
                    <p className="text-sm text-muted-foreground py-2">No delivery stops for this period</p>
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
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
