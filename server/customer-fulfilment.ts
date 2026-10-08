/** Shared Europe/London fulfilment calendar used by the customer portal.
 * An order belongs to the Saturday window starting on or before its order date.
 * Saturday fulfilment is 7 days later, Tuesday 10 days later.
 * Use noon UTC for date arithmetic to avoid DST-related day shifts.
 */
const ukDate = new Intl.DateTimeFormat("en-CA", {timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"});
export function ukDateString(input:Date|string):string {
 const parts=ukDate.formatToParts(new Date(input));
 const part=(type:string)=>parts.find(x=>x.type===type)?.value||"";
 return `${part("year")}-${part("month")}-${part("day")}`;
}
function addDays(date:string,days:number):string {
 const d=new Date(date+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+days);
 return d.toISOString().slice(0,10);
}
export function fulfilmentDate(orderDate:Date|string,isTuesday:boolean):string {
 const local=ukDateString(orderDate);
 const d=new Date(local+"T12:00:00Z");
 const back=(d.getUTCDay()+1)%7;
 return addDays(local, -back+(isTuesday?10:7));
}
export function fulfilmentGroup(deliveryDate:string,today=ukDateString(new Date())):"past"|"current"|"upcoming" {
 if(deliveryDate<today)return "past";
 // Current covers deliveries until the coming Saturday inclusive; Tuesday deliveries
 // beyond it remain upcoming. A Tuesday already due this week is current until it passes.
 const d=new Date(today+"T12:00:00Z");
 const daysToSaturday=(6-d.getUTCDay()+7)%7;
 return deliveryDate<=addDays(today,daysToSaturday)?"current":"upcoming";
}
export function customerJourney(deliveryDate:string,today=ukDateString(new Date())) {
 const group=fulfilmentGroup(deliveryDate,today);
 return group==="past"?"Delivery date passed":group==="current"?"Your delivery is coming up":"Your order is confirmed";
}
