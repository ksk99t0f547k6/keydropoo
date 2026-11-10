import {z} from "zod";
import {McpServer,WebStandardStreamableHTTPServerTransport} from "@modelcontextprotocol/server";
import {authenticateApiToken,type ApiScope} from "./api-tokens";
import {executeApiOperation,apiOperationSchemas,type ApiServices} from "./api-operations";
import {errorResponse,HttpError} from "./http";
import {claimRateLimit} from "./claim-identity";

const metadata:Record<string,{external?:boolean;name:string;scope:ApiScope;write:boolean;description:string;idempotent?:boolean}>={
 'codes.assign':{name:'assign_code',scope:'codes:issue',write:true,description:'Directly assign a code to an existing account email, without campaign eligibility or payment. Requires codes:issue and separate MCP write approval. Keep the same UUID and request contents on retries. Returns receipt metadata, never code secrets. May enqueue email when configured.'},
 'assignments.read':{name:'list_code_assignments',scope:'codes:read',write:false,description:'List direct assignments for an authorized product. Contains recipient email and internal notes; keep confidential. Does not reveal code secrets.'},
 "discounts.read":{name:"read_stripe_discounts",scope:"discounts:read",write:false,external:true,description:"Read Stripe connection identity, catalog, discovery, creation history or a decrypted discount snapshot. Requires an all-products token. Snapshots can contain promotion code secrets and customer IDs; keep them confidential. Does not refresh the local catalog."},
 "discounts.write":{name:"manage_stripe_discounts",scope:"discounts:write",write:true,external:true,idempotent:false,description:"Synchronize, create, resume, recover, import or export Stripe discounts. Requires an all-products token and separate MCP write approval. Imports and exports also require codes:write. Supply the expected account and mode. For creation reuse the same operation UUID and contents on retries; never create a new UUID after an unknown result. Imports are independently committed per source and return per-item failures."},
 "licenses.activate":{name:"activate_license_device",scope:"licenses:manage",write:true,idempotent:false,description:"Activate a device for a Keydrop user. Shared codes require a valid owned claim or purchase. Returns a secret activation token; keep it confidential. Requires server-side identity delegation. A released device can be reactivated, so inspect uncertain results before retrying."},
 "licenses.read":{name:"list_license_devices",scope:"licenses:manage",write:false,description:"List a product's license device metadata, optionally filtered by code ID, in pages of 50. Does not reveal activation tokens or device fingerprints."},
 "licenses.release":{name:"release_license_device",scope:"licenses:manage",write:true,idempotent:false,description:"Release a device binding for an authorized product. Does not revoke the code or other devices. Read current state before retrying an uncertain result, because the user may have reactivated the device."},
 "products.create":{name:"create_product",scope:"products:write",write:true,idempotent:false,description:"Create a product. Requires an all-products token. A duplicate slug is rejected; do not retry with another slug after an uncertain result."},
 "products.update":{name:"update_product",scope:"products:write",write:true,description:"Replace product settings with the supplied complete configuration."},
 "products.archive":{name:"archive_product",scope:"products:write",write:true,description:"Archive or restore a product. Archiving stops new claims, sales and automatic delivery."},
 "batches.restock":{name:"restock_batch",scope:"codes:write",write:true,description:"Add codes to an existing batch. Supply a stable UUID idempotency key and identical contents on retries. Returns receipt metadata, not code secrets."},
 "campaigns.create":{name:"create_campaign",scope:"campaigns:write",write:true,idempotent:false,description:"Create a draft campaign for an authorized product and its existing batch. Slug must be unique; verify uncertain results instead of creating another slug."},
 "campaigns.update":{name:"update_campaign",scope:"campaigns:write",write:true,idempotent:false,description:"Replace campaign configuration using expectedVersion. Product and batch cannot change. Read current state after a conflict; do not blindly overwrite."},
 "campaigns.get":{name:"read_campaign",scope:"campaigns:read",write:false,description:"Read a campaign including its current version and full eligibility conditions."},
 "links.create":{name:"create_claim_link",scope:"campaigns:write",write:true,idempotent:false,description:"Create a private campaign claim link. Defaults to one claim; maxClaims null means unlimited. Returns a secret token and relative URL path once. Save securely; never expose in logs. Creation is not idempotent."},
 "links.read":{name:"list_claim_links",scope:"campaigns:read",write:false,description:"List campaign link metadata, usage and revocation state without secret tokens."},
 "links.revoke":{name:"revoke_claim_link",scope:"campaigns:write",write:true,description:"Revoke a campaign claim link, preventing new claims. Existing deliveries remain accessible to their owners."},
 "credentials.save":{name:"save_campaign_credential",scope:"campaigns:write",write:true,idempotent:false,description:"Create or rotate a campaign passphrase or invitation secret. Secret is hashed and not returned. Changes campaign version; never log the supplied secret."},
 "credentials.read":{name:"list_campaign_credentials",scope:"campaigns:read",write:false,description:"List passphrase and invitation identifiers and revocation state without secrets or hashes."},
 "credentials.revoke":{name:"revoke_campaign_credential",scope:"campaigns:write",write:true,idempotent:false,description:"Revoke a passphrase or invitation credential and increment campaign version. Does not revoke already delivered codes."},
 "batches.create":{name:"create_code_batch",scope:"codes:write",write:true,description:"Import actual codes into an encrypted batch. Requires a stable UUID idempotency key. Reuse identical request contents on retries. Returns batch metadata only."},
 "batches.generate":{name:"generate_code_batch",scope:"codes:write",write:true,description:"Generate cryptographically random redemption, discount or license codes. Requires a stable UUID idempotency key. Reuse identical rules on retries; returns batch ID and count, not code secrets."},
 "sales.configure":{name:"configure_sales_batch",scope:"products:write",write:true,description:"Select the same-product batch sold through Checkout, or null to disable sales. Product price and Stripe configuration are separate."},
 "rewards.configure":{name:"configure_reward",scope:"rewards:write",write:true,idempotent:false,description:"Set a redemption batch reward, optionally overridden for one campaign. Supports credits, timed membership or permanent access. expectedVersion 0 creates; otherwise use the current version. Existing redemptions keep their original reward."},
 "rewards.read":{name:"read_reward",scope:"rewards:read",write:false,description:"Read the exact batch or campaign reward configuration and current version. A missing campaign override returns null, not the batch default."},
 "products.read":{name:"read_product",scope:"products:read",write:false,description:"Read one authorized product's settings."},
 "batches.read":{name:"list_batches",scope:"codes:read",write:false,description:"List code batches for an authorized product."},
 "codes.read":{name:"list_codes",scope:"codes:read",write:false,description:"List code metadata without revealing code secrets."},
 "codes.update":{name:"change_code_status",scope:"codes:write",write:true,description:"Revoke or restore selected codes. Revocation can reclaim configured rewards."},
 "campaigns.read":{name:"list_campaigns",scope:"campaigns:read",write:false,description:"List a product's campaigns and eligibility configuration."},
 "campaigns.status":{name:"change_campaign_status",scope:"campaigns:write",write:true,idempotent:false,description:"Change campaign status using its current version. On conflict, read the latest campaign before deciding whether to retry."},
 "codes.issue":{name:"issue_code",scope:"codes:issue",write:true,description:"Issue a campaign code to a registered Keydrop user, enforcing all campaign conditions and limits. Reuse the idempotency key on retries. Returns the code secret."},
 "credits.read":{name:"read_credits",scope:"credits:read",write:false,description:"Read a customer's credit balance, transactions and grant sources."},
 "entitlements.read":{name:"read_entitlements",scope:"entitlements:read",write:false,description:"Read a customer's timed or permanent access."},
 "credits.write":{name:"manage_credits",scope:"credits:write",write:true,description:"Grant, spend, refund or revoke credits. Requires a stable idempotency key."},
 "codes.redeem":{name:"redeem_code",scope:"codes:redeem",write:true,description:"Redeem a code for a customer. Use a stable UUID idempotency key for retries."},
};

export async function handleMcpRequest(request:Request,context:{db:D1Database;appUrl:string;identitySecret:string;services?:ApiServices}){
 let server:McpServer|undefined;
 try{
  const origin=request.headers.get("origin");
  if(origin!==null&&origin!==context.appUrl)throw new HttpError(403,"INVALID_ORIGIN");
  if(new URL(request.url).host!==new URL(context.appUrl).host)throw new HttpError(403,"INVALID_HOST");
  const principal=await authenticateApiToken(context.db,request.headers.get("authorization"));
  if(!await claimRateLimit(context.db,context.identitySecret,`api-token:${principal.id}`))throw new HttpError(429,"RATE_LIMITED");
  if(request.method!=="POST")return new Response(null,{status:405,headers:{Allow:"POST","Cache-Control":"no-store"}});
  // 每次請求重新驗證權杖及建立伺服器，不讓暖機 Worker 沿用已撤銷授權。
  server=new McpServer({name:"keydrop",version:"0.1.0"});
  for(const schema of apiOperationSchemas){
   const {action:actionField,...shape}=schema.shape;const action=actionField.value;const definition=metadata[action];
   if((action==="products.create"||action.startsWith("discounts."))&&principal.productIds!==null)continue;
   if(!principal.scopes.includes(definition.scope as ApiScope)||(definition.write&&!principal.mcpWriteEnabled))continue;
   server.registerTool(definition.name,{description:definition.description,inputSchema:z.object(shape).strict(),annotations:{readOnlyHint:!definition.write,destructiveHint:definition.write,idempotentHint:definition.idempotent??true,openWorldHint:definition.external??false}},async (args:Record<string,unknown>)=>{
    try{
     const result=await executeApiOperation(context.db,principal,{...args,action},context.services);
     return {content:[{type:"text" as const,text:JSON.stringify(result)}],structuredContent:result};
    }catch(error){
     // 只回傳公開錯誤代碼，不把 SQL、秘密或內部例外送給代理。
     const result=await errorResponse(error).json() as {error:string};
     return {isError:true,content:[{type:"text" as const,text:result.error}]};
    }
   });
  }
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:1048576});
  await server.connect(transport);
  const response=await transport.handleRequest(request);
  // JSON 模式仍可能透過串流回傳；讀完才關閉該次 transport。
  return new Response(await response.arrayBuffer(),{status:response.status,headers:new Headers([...response.headers.entries(),["Cache-Control","no-store"]])});
 }catch(error){const response=errorResponse(error);response.headers.set("Cache-Control","no-store");return response;}
 finally{await server?.close();}
}
