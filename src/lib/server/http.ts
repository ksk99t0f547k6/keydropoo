import { z } from "zod";
import { createAuth, isAdmin } from "./auth";
import { runtime } from "./env";
export class HttpError extends Error {
 constructor(public status: number, public code: string) { super(code); }
}
export async function requireAdmin(request: Request) {
 const ctx = await runtime();
 if (!["GET","HEAD"].includes(request.method) && request.headers.get("origin") !== ctx.settings.APP_URL) throw new HttpError(403,"INVALID_ORIGIN");
 const session = await createAuth(ctx.env,ctx.settings).api.getSession({ headers: request.headers });
 if (!session) throw new HttpError(401,"UNAUTHORIZED");
 if (!await isAdmin(ctx.env.DB,session.user.id)) throw new HttpError(403,"FORBIDDEN");
 return { ...ctx, session };
}
export async function readJson(request: Request, limit = 1024 * 1024): Promise<unknown> {
 if (!request.headers.get("content-type")?.startsWith("application/json")) throw new HttpError(415,"INVALID_INPUT");
 if (!request.body) throw new HttpError(400,"INVALID_INPUT");
 const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
 for (;;) {
  const { done, value } = await reader.read(); if (done) break;
  size += value.length;
  if (size > limit) { await reader.cancel(); throw new HttpError(413,"REQUEST_TOO_LARGE"); }
  chunks.push(value);
 }
 const bytes = new Uint8Array(size); let offset = 0;
 for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
 try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400,"INVALID_INPUT"); }
}
export function errorResponse(error: unknown) {
 if (error instanceof HttpError) return Response.json({ error: error.code },{ status: error.status });
 if (error instanceof z.ZodError) return Response.json({ error: "INVALID_INPUT" },{ status: 400 });
 const message = error instanceof Error ? error.message : "";
 if(message==='EMAIL_RETRY_UNAVAILABLE')return Response.json({error:message},{status:409});
 if(message==='ASSIGNMENT_FORBIDDEN')return Response.json({error:message},{status:403});
 if(message==='HANDOUT_FORBIDDEN')return Response.json({error:message},{status:403});
 if(message==='HANDOUT_NOT_FOUND')return Response.json({error:message},{status:404});
 if(['HANDOUT_UNAVAILABLE','HANDOUT_IDEMPOTENCY_CONFLICT'].includes(message))return Response.json({error:message},{status:409});
 if(message==='ASSIGNMENT_USER_NOT_FOUND')return Response.json({error:message},{status:404});
 if(['ASSIGNMENT_CONFLICT','ASSIGNMENT_UNAVAILABLE'].includes(message))return Response.json({error:message},{status:409});
 if(["STRIPE_PRODUCT_UNAVAILABLE","STRIPE_NOT_CONFIGURED","STRIPE_IDENTITY_UNAVAILABLE","STRIPE_SYNC_FAILED","STRIPE_OPERATION_FAILED","STRIPE_DISCOUNT_MISMATCH","STRIPE_OPERATION_RECOVERY_FAILED"].includes(message))return Response.json({error:message},{status:503});
 if(["STRIPE_CONNECTION_CHANGED","STRIPE_OPERATION_CONFLICT","STRIPE_OPERATION_BUSY","STRIPE_OPERATION_REVIEW_REQUIRED","STRIPE_OPERATION_RECOVERY_MISMATCH","STRIPE_INVENTORY_CONFLICT","STRIPE_INVENTORY_UNAVAILABLE"].includes(message))return Response.json({error:message},{status:409});
 if(["SHARED_LICENSE_PENDING","SHARED_SALES_PENDING"].some(code=>message.includes(code)))return Response.json({error:message.includes("SHARED_LICENSE_PENDING")?"SHARED_LICENSE_PENDING":"SHARED_SALES_PENDING"},{status:409});
 if(["WEBHOOK_URL_INVALID","WEBHOOK_PRODUCTS_INVALID"].includes(message))return Response.json({error:message},{status:400});
 if(message==="WEBHOOK_NOT_FOUND")return Response.json({error:message},{status:404});
 if(message==="WEBHOOK_SECRET_MISSING")return Response.json({error:message},{status:503});
 if(message==="WEBHOOK_RETRY_UNAVAILABLE")return Response.json({error:message},{status:409});
 if (["CONDITION_TOO_COMPLEX","DUPLICATE_QUESTION"].includes(message)) return Response.json({error:message},{status:400});
 if (["CAMPAIGN_SOURCE_UNAVAILABLE","CAMPAIGN_CONFLICT"].includes(message)) return Response.json({error:message},{status:409});
 if(["CAMPAIGN_NOT_FOUND","CLAIM_USER_NOT_FOUND","CLAIM_NOT_FOUND"].includes(message))return Response.json({error:message},{status:404});
 if(["CLAIM_UNAVAILABLE","CLAIM_LINK_UNAVAILABLE","CLAIM_LINK_LIMIT_REACHED","CONDITIONS_NOT_MET"].includes(message))return Response.json({error:message},{status:409});
 if(["CLAIM_LOGIN_REQUIRED","CLAIM_VERIFIED_EMAIL_REQUIRED","CLAIM_IDENTITY_REQUIRED"].includes(message))return Response.json({error:message},{status:403});
 if(["QUALIFICATION_UNAVAILABLE","ENCRYPTION_NOT_CONFIGURED"].includes(message))return Response.json({error:message},{status:503});
 if(message==="STOCK_SOURCE_UNAVAILABLE")return Response.json({error:message},{status:404});
 if(["EMAIL_CODE_UNAVAILABLE","EMAIL_IDEMPOTENCY_CONFLICT"].includes(message))return Response.json({error:message},{status:409});
 if(message==="EMAIL_JOB_NOT_FOUND")return Response.json({error:message},{status:404});
 if(message==="STRIPE_OPERATION_NOT_FOUND")return Response.json({error:message},{status:404});
 if(message==="EXTERNAL_REVIEW_UNAVAILABLE")return Response.json({error:message},{status:409});
 if(message==="EXTERNAL_REDEMPTION_REVIEW_REQUIRED")return Response.json({error:message},{status:409});
 if(["EXTERNAL_REDEMPTION_FAILED","EXTERNAL_REDEMPTION_BUSY","EXTERNAL_REWARD_NOT_CONFIGURED"].includes(message))return Response.json({error:message},{status:503});
 if(message==="EXTERNAL_REVOCATION_RETRY_UNAVAILABLE")return Response.json({error:message},{status:409});
 if(message==="INVALID_SALES_BATCH")return Response.json({error:message},{status:400});
 if(message==="BATCH_IDEMPOTENCY_CONFLICT")return Response.json({error:message},{status:409});
 if(message==="STOCK_IDEMPOTENCY_CONFLICT")return Response.json({error:message},{status:409});
 if(message==="ORDER_LINK_UNAVAILABLE")return Response.json({error:message},{status:409});
 if(message==="ORDER_NOT_FOUND")return Response.json({error:message},{status:404});
 if(message.includes('ORDER_REFUND_REVIEW_CONFLICT'))return Response.json({error:'ORDER_REFUND_REVIEW_CONFLICT'},{status:409});
 if(["ORDER_STOCK_UNAVAILABLE","ORDER_IDEMPOTENCY_CONFLICT","ORDER_CHECKOUT_EXPIRED","ORDER_SESSION_CONFLICT","ORDER_PAYMENT_MISMATCH"].includes(message))return Response.json({error:message},{status:409});
 if(message==="ORDER_PENDING_LIMIT")return Response.json({error:message},{status:429});
 if(message==="STRIPE_AMOUNT_UNREPRESENTABLE")return Response.json({error:message},{status:400});
 if(message==="STRIPE_EVENT_BUSY")return Response.json({error:message},{status:503});
 if(message==="INVALID_API_TOKEN")return Response.json({error:message},{status:401});
 if(message==="API_SCOPE_DENIED")return Response.json({error:message},{status:403});
 if(["TOKEN_EXPIRY_INVALID","TOKEN_PRODUCTS_INVALID"].includes(message))return Response.json({error:message},{status:400});
 if(message==="LICENSE_OWNER_REQUIRED")return Response.json({error:message},{status:403});
 if(message==="LICENSE_DEVICE_NOT_FOUND")return Response.json({error:message},{status:404});
 if(message==="INVALID_LICENSE_PROOF")return Response.json({error:message},{status:403});
 if(message.includes("LICENSE_ACTIVATION_UNAVAILABLE"))return Response.json({error:"LICENSE_ACTIVATION_UNAVAILABLE"},{status:409});
 if(message==="CREDIT_WALLET_NOT_FOUND")return Response.json({error:message},{status:404});
 if(message==="ENTITLEMENT_NOT_FOUND")return Response.json({error:message},{status:404});
 for(const code of ["REDEMPTION_UNAVAILABLE","REDEMPTION_IDEMPOTENCY_CONFLICT","REWARD_CHANGED","REWARD_ALREADY_OWNED","REWARD_SOURCE_UNAVAILABLE","REWARD_NOT_CONFIGURED","INSUFFICIENT_CREDITS","INVALID_CREDIT_REFUND","INVALID_CREDIT_REVOCATION","CREDIT_IDEMPOTENCY_CONFLICT"]){if(message.includes(code))return Response.json({error:code},{status:409});}
 if (message.includes("UNIQUE constraint failed")) return Response.json({ error: "DUPLICATE_RECORD" },{ status: 409 });
 if (["PRODUCT_NOT_FOUND","DUPLICATE_CODES"].includes(message)) return Response.json({ error: message },{ status: message === "PRODUCT_NOT_FOUND" ? 404 : 409 });
 return Response.json({ error: "INTERNAL_ERROR" },{ status: 500 });
}
