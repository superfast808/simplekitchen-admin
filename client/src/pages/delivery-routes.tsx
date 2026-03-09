import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { format, startOfWeek, endOfWeek, addWeeks } from "date-fns";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { MapPin, ChevronLeft, ChevronRight, Route, Navigation } from "lucide-react";

type DeliveryAddress = {
  id: number;
  customerName: string;
  address: string;
  lat: number | null;
  lng: number | null;
};

export default function DeliveryRoutesPage() {
  const [weekOffset, setWeekOffset] = useState(0);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const [geocodedAddresses, setGeocodedAddresses] = useState<DeliveryAddress[]>([]);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [routeOptimized, setRouteOptimized] = useState(false);

  const now = new Date();
  const from = startOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });
  const to = endOfWeek(addWeeks(now, weekOffset), { weekStartsOn: 1 });

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

  const validAddresses = geocodedAddresses.filter(a => a.lat && a.lng);

  function optimizeRoute(points: DeliveryAddress[]): DeliveryAddress[] {
    if (points.length <= 2) return points;
    const remaining = [...points];
    const route: DeliveryAddress[] = [remaining.shift()!];

    while (remaining.length > 0) {
      const last = route[route.length - 1];
      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const dist = Math.sqrt(
          Math.pow((remaining[i].lat! - last.lat!), 2) +
          Math.pow((remaining[i].lng! - last.lng!), 2)
        );
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }
      route.push(remaining.splice(closestIdx, 1)[0]);
    }
    return route;
  }

  useEffect(() => {
    if (!mapRef.current || validAddresses.length === 0) return;

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

      const map = L.map(mapRef.current).setView([validAddresses[0].lat!, validAddresses[0].lng!], 11);
      mapInstanceRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const displayOrder = routeOptimized ? optimizeRoute([...validAddresses]) : validAddresses;
      const bounds: [number, number][] = [];

      displayOrder.forEach((addr, idx) => {
        const marker = L.marker([addr.lat!, addr.lng!]).addTo(map);
        marker.bindPopup(`<strong>${idx + 1}. ${addr.customerName}</strong><br/>${addr.address}`);
        bounds.push([addr.lat!, addr.lng!]);
      });

      if (displayOrder.length > 1) {
        const polyline = L.polyline(
          displayOrder.map(a => [a.lat!, a.lng!]),
          { color: "hsl(142, 76%, 36%)", weight: 3, opacity: 0.7, dashArray: routeOptimized ? undefined : "10, 10" }
        ).addTo(map);
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
  }, [validAddresses, routeOptimized]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight" data-testid="text-routes-title">Delivery Routes</h1>
          <p className="text-sm text-muted-foreground">
            {format(from, "MMM d")} - {format(to, "MMM d, yyyy")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w - 1)} data-testid="button-route-prev">
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setWeekOffset(0)} data-testid="button-route-this-week">This Week</Button>
            <Button size="icon" variant="ghost" onClick={() => setWeekOffset(w => w + 1)} data-testid="button-route-next">
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          {validAddresses.length > 1 && (
            <Button
              size="sm"
              variant={routeOptimized ? "default" : "outline"}
              onClick={() => setRouteOptimized(!routeOptimized)}
              data-testid="button-optimize-route"
            >
              <Navigation className="w-4 h-4 mr-1" />
              {routeOptimized ? "Optimized Route" : "Optimize Route"}
            </Button>
          )}
        </div>
      </div>

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
              ) : validAddresses.length === 0 ? (
                <div className="h-[500px] flex items-center justify-center">
                  <div className="text-center">
                    <MapPin className="w-12 h-12 mx-auto text-muted-foreground/40 mb-3" />
                    <p className="text-muted-foreground font-medium">No delivery addresses to map</p>
                    <p className="text-sm text-muted-foreground mt-1">Sync orders with delivery addresses to see the route</p>
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
                Delivery Stops
                <Badge variant="secondary">{validAddresses.length}</Badge>
              </h3>
              {isLoading ? (
                <div className="space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : validAddresses.length === 0 ? (
                <p className="text-sm text-muted-foreground">No stops to display</p>
              ) : (
                <div className="space-y-2 max-h-[440px] overflow-y-auto">
                  {(routeOptimized ? optimizeRoute([...validAddresses]) : validAddresses).map((addr, idx) => (
                    <div
                      key={addr.id}
                      className="flex items-start gap-3 p-2 rounded-md bg-muted/50"
                      data-testid={`card-stop-${addr.id}`}
                    >
                      <div className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-medium flex-shrink-0 mt-0.5">
                        {idx + 1}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate" data-testid={`text-stop-name-${addr.id}`}>{addr.customerName}</p>
                        <p className="text-xs text-muted-foreground truncate" data-testid={`text-stop-address-${addr.id}`}>{addr.address}</p>
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
