import { requireAdmin,readJson,errorResponse } from "@/lib/server/http";
import { fingerprint } from "@/lib/domain/codes";
import { z } from "zod";
export async function POST(request:Request) {
 try {
  const {env}=await requireAdmin(request);
  const input=z.object({productId:z.string().uuid(),codes:z.array(z.string().max(1024)).max(1000)}).parse(await readJson(request));
  const hashes=await Promise.all(input.codes.map(fingerprint));
  const {results}=await env.DB.prepare("SELECT fingerprint FROM codes WHERE product_id=? AND fingerprint IN (SELECT value FROM json_each(?))").bind(input.productId,JSON.stringify(hashes)).all<{fingerprint:string}>();
  const existing=new Set(results.map(r=>r.fingerprint));
  return Response.json({duplicates:hashes.flatMap((h,i)=>existing.has(h)?[i]:[])},{headers:{"Cache-Control":"no-store"}});
 }catch(e){return errorResponse(e);}
}
