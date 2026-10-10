import { storage } from "./storage";
import { pool } from "./db";

export async function buildIndependentDiagnostics(from:Date,to:Date,day:string){
 const [orders,products,ingredients,manualStock]=await Promise.all([storage.getOrders(from,to),storage.getProducts(),storage.getAllIngredients(),storage.getManualQuantities(from,to)]);
 const itemsMap=await storage.getOrderItemsBatch(orders.map(o=>o.id));
 const byId=new Map(products.map(p=>[p.id,p])),byName=new Map(products.map(p=>[p.name.trim().toLowerCase(),p]));
 const inactive=new Set(["cancelled","refunded","failed","trash"]);
 const rows=orders.flatMap(o=>(itemsMap.get(o.id)||[]).map(i=>{
  const p=(i.productId?byId.get(i.productId):undefined)||byName.get(i.productName.trim().toLowerCase());
  const xmas=/(^|\W)(xmas|christmas)(\W|$)/i.test(p?.category||"");
  const status=String(o.status||"").toLowerCase();
  const exclude=inactive.has(status)?"inactive":xmas&&day!=="xmas"?"christmas":!xmas&&day==="xmas"?"regular":day==="saturday"&&o.isTuesday||day==="tuesday"&&!o.isTuesday?"other-day":null;
  return {orderId:o.id,wooId:o.wooId,lineId:i.id,productId:i.productId,name:i.productName,key:i.productName.trim().toLowerCase(),quantity:i.quantity,status,
   source:o.isManual?"manual":"woo",day:o.isTuesday?"tuesday":"saturday",xmas,category:p?.category||null,exclude};
 }));
 const total=(rr:typeof rows)=>Object.fromEntries([...rr.reduce((m,r)=>(m.set(r.key,(m.get(r.key)||0)+r.quantity),m),new Map<string,number>())].sort((a,b)=>a[0].localeCompare(b[0])));
 const active=rows.filter(x=>!inactive.has(x.status)&&!x.xmas),production=rows.filter(x=>!x.exclude);
 const stock=manualStock.map(m=>({id:m.id,productId:m.productId,name:byId.get(m.productId)?.name||"unmatched",quantity:m.quantity}));
 const stockTotals=new Map<string,number>();
 for(const st of stock){const key=st.name.trim().toLowerCase();stockTotals.set(key,(stockTotals.get(key)||0)+st.quantity)}
 const recipeMap=new Map<string,typeof ingredients>();
 for(const ingredient of ingredients){const p=byId.get(ingredient.productId);if(!p)continue;const k=p.name.trim().toLowerCase();const a=recipeMap.get(k)||[];a.push(ingredient);recipeMap.set(k,a)}
 const inputs=new Map<string,number>(Object.entries(total(active)));
 for(const [k,n] of stockTotals)inputs.set(k,(inputs.get(k)||0)+n);
 const recipeLines:any[]=[];const ingredientTotals=new Map<string,number>(),missingRecipes:any[]=[];
 for(const [k,n] of inputs){const recipe=recipeMap.get(k)||[];if(!recipe.length&&n>0)missingRecipes.push({product:k,quantity:n});const seen=new Set<string>();
  for(const ing of recipe){const ik=ing.name.trim().toLowerCase()+"|"+ing.unit.trim().toLowerCase();if(seen.has(ik))continue;seen.add(ik);const q=n*Number(ing.quantityPerUnit);recipeLines.push({product:k,units:n,ingredient:ing.name,unit:ing.unit,quantityPerUnit:ing.quantityPerUnit,required:q,recipeProductId:ing.productId});ingredientTotals.set(ik,(ingredientTotals.get(ik)||0)+q)}
 }
 const invitesResult=await pool.query('SELECT id,order_id AS "parentOrderId",selections_order_id AS "satOrderId",tuesday_selections_order_id AS "tueOrderId",status,subscription_quantity AS quantity,is_dual AS "dual",is_tuesday AS "tuesday",week_from AS "weekFrom",week_to AS "weekTo" FROM subscription_invites WHERE week_from <= $2 AND week_to >= $1',[from,to]);
 const knownIds=new Set(orders.map(o=>o.id));
 const invites=invitesResult.rows.map(v=>({...v,satPresent:!v.satOrderId||knownIds.has(v.satOrderId),tuePresent:!v.tueOrderId||knownIds.has(v.tueOrderId)}));
 const fulfillment=production.filter(x=>!/meal\s+subscription|add\s+delivery/i.test(x.name));
 const packOrderIds=new Set(fulfillment.map(x=>x.orderId));
 const route=orders.filter(o=>packOrderIds.has(o.id)&&(!inactive.has((o.status||"").toLowerCase()))).map(o=>({id:o.id,day:o.isTuesday?"tuesday":"saturday",fulfillment:o.fulfillmentType,eligible:!!o.deliveryAddress||o.fulfillmentType==="collection"}));
 const diff=(a:Record<string,number>,b:Record<string,number>)=>Object.fromEntries([...new Set([...Object.keys(a),...Object.keys(b)])].map(k=>[k,{a:a[k]||0,b:b[k]||0,delta:(a[k]||0)-(b[k]||0)}]).filter(x=>(x[1] as any).delta!==0));
 const sections={
  orders:{rule:"Active order lines, excluding refunded/cancelled and Christmas; browser source/search filters not represented",lines:active,totals:total(active),excluded:rows.filter(x=>x.exclude)},
  "kitchen-production":{rule:"Production uses active order lines, optional delivery-day restriction, excluding Christmas",lines:production,totals:total(production),excluded:rows.filter(x=>x.exclude)},
  "product-totals":{rule:"Active order totals plus manual quantities as a separate stock bucket",orderTotals:total(active),manualQuantities:stock,manualStockTotals:Object.fromEntries(stockTotals)},
  ingredients:{rule:"Recipes are matched by normalised product name, order and manual stock quantities multiply recipe ingredient quantities",recipeInputs:Object.fromEntries(inputs),missingRecipes,recipeLines,ingredientTotals:Object.fromEntries(ingredientTotals)},
  "weekly-stats":{rule:"Active order lines split by manual/Woo; browser filter toggles are not represented",manual:total(active.filter(x=>x.source==="manual")),woo:total(active.filter(x=>x.source==="woo")),activeTotals:total(active)},
  subscriptions:{rule:"Invitation-to-Saturday/Tuesday-order links; a missing linked order may be outside the selected window",invites,missingLinkedOrders:invites.filter(v=>!v.satPresent||!v.tuePresent)},
  "labels-routes":{rule:"Labels/route eligibility based on active order records, excluding subscription payment-only lines and Christmas",packingLineTotals:total(fulfillment),routeCandidates:route,labelsOrderIds:[...packOrderIds]},
  christmas:{lines:rows.filter(x=>x.xmas),activeTotals:total(rows.filter(x=>x.xmas&&!inactive.has(x.status)))}
 };
 return {sections,comparison:{ordersVsProduction:diff(total(active),total(production)),productionVsPacking:diff(total(production),total(fulfillment)),missingRecipes,missingSubscriptionLinks:sections.subscriptions.missingLinkedOrders},input:{from:from.toISOString(),to:to.toISOString(),day},computedAt:new Date().toISOString()};
}
