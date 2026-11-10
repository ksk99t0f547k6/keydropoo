import {discountReadAction,discountWriteAction,executeDiscountAction,type discountApiService} from './stripe-discount-service';
import {z} from "zod";
import {assignCode,assignmentInput,listAssignments} from './assignments';
import {authenticateApiToken,requireApiScope,type ApiPrincipal} from "./api-tokens";
import {creditHistory,creditGrantStatus,manageCredits,operationFields} from "./credits";
import {membershipStatus} from "./memberships";
import {listCodes,listBatches,changeCodeStatus,createProduct,updateProduct,archiveProduct,productInput,type ProductRow} from "./inventory";
import {listCampaigns,getCampaign,setCampaignStatus,createCampaign,updateCampaign,campaignInput} from "./campaigns";
import {claimCode,claimInputSchema,createCampaignLink,listCampaignLinks,revokeCampaignLink,campaignLinkInput,type ClaimServices} from "./claims";
import {redeemCode,saveRewardRule,getRewardRule,rewardRuleInput} from "./redemptions";

import {restockBatch,restockInput} from "./restock";

import {parseCondition,type Condition} from "../domain/conditions";

function authorizeConditions(principal:ApiPrincipal,raw:unknown){
 const visit=(node:Condition)=>{if(node.type==="and"||node.type==="or")node.children.forEach(visit);else if(node.type==="purchase")requireApiScope(principal,"campaigns:write",node.productId);};
 visit(parseCondition(raw));
}

import {campaignCredentialInput,saveCampaignCredential,listCampaignCredentials,revokeCampaignCredential} from "./campaign-credentials";

import {importedBatchOperation,generatedBatchOperation,createRequestedBatch} from "./batch-creation";

import {setSalesBatch} from "./sales";

import {listProductDevices,releaseProductDevice,activateLicense,activationInput} from "./licenses";

const identity={productId:z.uuid(),userId:z.string().min(1).max(128)};
const name=z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/);
export const apiOperationSchemas=[
 assignmentInput.extend({action:z.literal('codes.assign')}).strict(),
 z.object({action:z.literal('assignments.read'),productId:z.uuid(),page:z.number().int().min(1).max(100000).default(1)}).strict(),
 z.object({action:z.literal("discounts.read"),request:discountReadAction}).strict(),
 z.object({action:z.literal("discounts.write"),request:discountWriteAction}).strict(),
 activationInput.extend({action:z.literal("licenses.activate"),userId:z.string().min(1).max(128)}).strict(),
 z.object({action:z.literal("licenses.read"),productId:z.uuid(),codeId:z.uuid().optional(),page:z.number().int().min(1).max(100000).default(1)}).strict(),
 z.object({action:z.literal("licenses.release"),productId:z.uuid(),activationId:z.uuid()}).strict(),
 z.object({action:z.literal("sales.configure"),productId:z.uuid(),batchId:z.uuid().nullable(),allowPromotionCodes:z.boolean().optional(),stripeProductId:z.string().regex(/^prod_[A-Za-z0-9]+$/).max(255).nullable().optional()}).strict(),
 rewardRuleInput.extend({action:z.literal("rewards.configure")}).strict(),
 z.object({action:z.literal("rewards.read"),productId:z.uuid(),batchId:z.uuid(),campaignId:z.uuid().nullable().default(null)}).strict(),
 importedBatchOperation,
 generatedBatchOperation,
 z.object({action:z.literal("credentials.save"),productId:z.uuid(),campaignId:z.uuid(),credential:campaignCredentialInput}).strict(),
 z.object({action:z.literal("credentials.read"),productId:z.uuid(),campaignId:z.uuid()}).strict(),
 z.object({action:z.literal("credentials.revoke"),productId:z.uuid(),campaignId:z.uuid(),credential:campaignCredentialInput.omit({secret:true})}).strict(),
 z.object({action:z.literal("links.create"),productId:z.uuid(),campaignId:z.uuid(),link:campaignLinkInput}).strict(),
 z.object({action:z.literal("links.read"),productId:z.uuid(),campaignId:z.uuid()}).strict(),
 z.object({action:z.literal("links.revoke"),productId:z.uuid(),campaignId:z.uuid(),linkId:z.uuid()}).strict(),
 z.object({action:z.literal("campaigns.create"),campaign:campaignInput}).strict(),
 z.object({action:z.literal("campaigns.update"),campaignId:z.uuid(),expectedVersion:z.number().int().min(1),campaign:campaignInput}).strict(),
 z.object({action:z.literal("campaigns.get"),productId:z.uuid(),campaignId:z.uuid()}).strict(),
 z.object({action:z.literal("products.create"),product:productInput.strict()}).strict(),
 z.object({action:z.literal("products.update"),productId:z.uuid(),product:productInput.strict()}).strict(),
 z.object({action:z.literal("products.archive"),productId:z.uuid(),archived:z.boolean()}).strict(),
 restockInput.extend({action:z.literal("batches.restock")}).strict(),
 z.object({action:z.literal("products.read"),productId:z.uuid()}).strict(),
 z.object({action:z.literal("batches.read"),productId:z.uuid()}).strict(),
 z.object({action:z.literal("codes.read"),productId:z.uuid(),batchId:z.uuid().optional(),status:z.enum(["available","reserved","assigned","revoked"]).optional(),page:z.number().int().min(1).max(100000).default(1)}).strict(),
 z.object({action:z.literal("codes.update"),productId:z.uuid(),ids:z.array(z.uuid()).min(1).max(1000),change:z.enum(["revoke","restore"])}).strict(),
 z.object({action:z.literal("campaigns.read"),productId:z.uuid(),page:z.number().int().min(1).max(100000).default(1)}).strict(),
 z.object({action:z.literal("campaigns.status"),productId:z.uuid(),campaignId:z.uuid(),expectedVersion:z.number().int().min(1),status:z.enum(["draft","active","paused","archived"])}).strict(),
 claimInputSchema.extend({action:z.literal("codes.issue"),...identity}).strict(),
 z.object({action:z.literal("credits.read"),...identity,bucket:name,page:z.number().int().min(1).max(100000).default(1)}).strict(),
 z.object({action:z.literal("credits.write"),...identity,bucket:name,operation:operationFields.omit({walletId:true})}).strict(),
 z.object({action:z.literal("entitlements.read"),...identity,plan:name}).strict(),
 z.object({action:z.literal("codes.redeem"),...identity,code:z.string().min(1).max(512),idempotencyKey:z.uuid()}).strict(),
 ] as const;
const requestSchema=z.discriminatedUnion("action",apiOperationSchemas);
export interface ApiServices {discounts?:ReturnType<typeof discountApiService>;claims?:ClaimServices;external?:import("./external-redemptions").ExternalDispatcher;}
// 所有入口（包含未來 MCP）共用此分派器；先檢查商品及操作權限才接觸業務資料。
export async function executeApiOperation(db:D1Database,principal:ApiPrincipal,raw:unknown,services:ApiServices={}){
 const input=requestSchema.parse(raw);
 switch(input.action){
  case 'codes.assign':{
   requireApiScope(principal,'codes:issue',input.productId);
   const admin=await db.prepare('SELECT admin_user_id FROM installation WHERE id=1').first<{admin_user_id:string}>();
   if(!admin)throw new Error('ASSIGNMENT_FORBIDDEN');
   const {action,...assignment}=input;void action;
   return assignCode(db,admin.admin_user_id,assignment,Date.now(),principal.id);
  }
  case 'assignments.read':{
   requireApiScope(principal,'codes:read',input.productId);
   const {action,...query}=input;void action;return listAssignments(db,query);
  }
  case 'discounts.read':case 'discounts.write':{
   const required=input.action==='discounts.read'?'discounts:read':'discounts:write';
   if(principal.productIds!==null||!principal.scopes.includes(required))throw new Error('API_SCOPE_DENIED');
   if('input' in input.request&&'productId' in input.request.input){
    // 匯入也會新增商品碼庫，需同時授權碼寫入。
    requireApiScope(principal,'codes:write',input.request.input.productId);
   }
   if(!services.discounts)throw new Error('STRIPE_NOT_CONFIGURED');
   const {connection,encryptionSecret}=await services.discounts();
   return executeDiscountAction(db,encryptionSecret,connection,input.request);
  }

  case "licenses.activate":{
   requireApiScope(principal,"licenses:manage",input.productId);
   if(!services.claims?.encryptionSecret)throw new Error("ENCRYPTION_NOT_CONFIGURED");
   const {action,userId,...activation}=input;void action;
   return activateLicense(db,services.claims.encryptionSecret,services.claims.identitySecret,activation,Date.now(),userId);
  }
  case "licenses.read":{
   requireApiScope(principal,"licenses:manage",input.productId);
   const {action,...query}=input;void action;return listProductDevices(db,query);
  }
  case "licenses.release":
   requireApiScope(principal,"licenses:manage",input.productId);return releaseProductDevice(db,input.productId,input.activationId);
  case "sales.configure":
   requireApiScope(principal,"products:write",input.productId);return setSalesBatch(db,input.productId,input.batchId,input.allowPromotionCodes,input.stripeProductId);
  case "rewards.configure":{
   requireApiScope(principal,"rewards:write",input.productId);
   const {action,...rule}=input;void action;return saveRewardRule(db,rule);
  }
  case "rewards.read":{
   requireApiScope(principal,"rewards:read",input.productId);
   const source=await db.prepare("SELECT id FROM code_batches WHERE id=? AND product_id=? AND (? IS NULL OR EXISTS(SELECT 1 FROM campaigns WHERE id=? AND batch_id=code_batches.id AND product_id=code_batches.product_id))")
    .bind(input.batchId,input.productId,input.campaignId,input.campaignId).first();
   if(!source)throw new Error("REWARD_SOURCE_UNAVAILABLE");
   return {rule:await getRewardRule(db,input.batchId,input.campaignId)};
  }
  case "batches.create":case "batches.generate":{
   requireApiScope(principal,"codes:write",input.batch.productId);
   const secret=services.claims?.encryptionSecret;if(!secret)throw new Error("ENCRYPTION_NOT_CONFIGURED");
   return createRequestedBatch(db,secret,input);
  }
  case "credentials.save":case "credentials.read":case "credentials.revoke":{
   requireApiScope(principal,input.action==="credentials.read"?"campaigns:read":"campaigns:write",input.productId);
   const campaign=await getCampaign(db,input.campaignId);
   if(!campaign||campaign.product_id!==input.productId)throw new Error("CAMPAIGN_NOT_FOUND");
   if(input.action==="credentials.read")return {credentials:await listCampaignCredentials(db,input.campaignId)};
   if(input.action==="credentials.save")return saveCampaignCredential(db,input.campaignId,input.credential);
   await revokeCampaignCredential(db,input.campaignId,input.credential);return {ok:true};
  }
  case "links.create":case "links.read":case "links.revoke":{
   requireApiScope(principal,input.action==="links.read"?"campaigns:read":"campaigns:write",input.productId);
   const campaign=await getCampaign(db,input.campaignId);
   if(!campaign||campaign.product_id!==input.productId)throw new Error("CAMPAIGN_NOT_FOUND");
   if(input.action==="links.read")return {links:await listCampaignLinks(db,input.campaignId)};
   if(input.action==="links.revoke"){await revokeCampaignLink(db,input.campaignId,input.linkId);return {ok:true};}
   const link=await createCampaignLink(db,input.campaignId,input.link);
   return {...link,path:`/claim/${campaign.slug}#token=${link.token}`};
  }
  case "campaigns.create":
   requireApiScope(principal,"campaigns:write",input.campaign.productId);
   authorizeConditions(principal,input.campaign.conditions);
   return createCampaign(db,input.campaign);
  case "campaigns.update":{
   requireApiScope(principal,"campaigns:write",input.campaign.productId);
   authorizeConditions(principal,input.campaign.conditions);
   const current=await getCampaign(db,input.campaignId);
   if(!current||current.product_id!==input.campaign.productId)throw new Error("CAMPAIGN_NOT_FOUND");
   return updateCampaign(db,input.campaignId,input.expectedVersion,input.campaign);
  }
  case "campaigns.get":{
   requireApiScope(principal,"campaigns:read",input.productId);
   const campaign=await getCampaign(db,input.campaignId);
   if(!campaign||campaign.product_id!==input.productId)throw new Error("CAMPAIGN_NOT_FOUND");
   return {campaign};
  }
  case "products.create":
   if(!principal.scopes.includes("products:write")||principal.productIds!==null)throw new Error("API_SCOPE_DENIED");
   return createProduct(db,input.product);
  case "products.update":
   requireApiScope(principal,"products:write",input.productId);return updateProduct(db,input.productId,input.product);
  case "products.archive":
   requireApiScope(principal,"products:write",input.productId);return archiveProduct(db,input.productId,input.archived);
  case "batches.restock":{
   requireApiScope(principal,"codes:write",input.productId);
   const secret=services.claims?.encryptionSecret;
   if(!secret)throw new Error("ENCRYPTION_NOT_CONFIGURED");
   const {action,...stock}=input;void action;
   return restockBatch(db,secret,stock);
  }
  case "products.read":{
   requireApiScope(principal,"products:read",input.productId);
   const product=await db.prepare("SELECT * FROM products WHERE id=?").bind(input.productId).first<ProductRow>();
   if(!product)throw new Error("PRODUCT_NOT_FOUND");return {product};
  }
  case "batches.read":
   requireApiScope(principal,"codes:read",input.productId);return {batches:await listBatches(db,input.productId)};
  case "codes.read":
   requireApiScope(principal,"codes:read",input.productId);return listCodes(db,input);
  case "codes.update":
   requireApiScope(principal,"codes:write",input.productId);return changeCodeStatus(db,{productId:input.productId,ids:input.ids,action:input.change});
  case "campaigns.read":
   requireApiScope(principal,"campaigns:read",input.productId);return listCampaigns(db,input);
  case "campaigns.status":{
   requireApiScope(principal,"campaigns:write",input.productId);
   const campaign=await getCampaign(db,input.campaignId);
   if(!campaign||campaign.product_id!==input.productId)throw new Error("CAMPAIGN_NOT_FOUND");
   return setCampaignStatus(db,input.campaignId,input.expectedVersion,input.status);
  }
  case "codes.issue":{
   requireApiScope(principal,"codes:issue",input.productId);
   const campaign=await getCampaign(db,input.campaignId);
   if(!campaign||campaign.product_id!==input.productId)throw new Error("CAMPAIGN_NOT_FOUND");
   if(!services.claims?.encryptionSecret)throw new Error("ENCRYPTION_NOT_CONFIGURED");
   // 身分由部署者後端委派，信箱與驗證狀態只從 Keydrop 帳號取得。
   const user=await db.prepare('SELECT id,email,emailVerified FROM "user" WHERE id=?').bind(input.userId).first<{id:string;email:string;emailVerified:number}>();
   if(!user)throw new Error("CLAIM_USER_NOT_FOUND");
   const {action,productId,userId,...claim}=input;void action;void productId;void userId;
   return claimCode(db,claim,{userId:user.id,email:user.email,emailVerified:user.emailVerified===1},services.claims);
  }
  case "credits.read":{
   requireApiScope(principal,"credits:read",input.productId);
   const wallet=await db.prepare("SELECT id FROM credit_wallets WHERE product_id=? AND user_id=? AND bucket=?").bind(input.productId,input.userId,input.bucket).first<{id:string}>();
   if(!wallet)return {wallet:null,operations:[],grants:[],page:input.page};
   return {...await creditHistory(db,wallet.id,input.page),grants:await creditGrantStatus(db,wallet.id)};
  }
  case "credits.write":
   requireApiScope(principal,"credits:write",input.productId);
   return manageCredits(db,{wallet:{productId:input.productId,userId:input.userId,bucket:input.bucket},operation:input.operation});
  case "entitlements.read":
   requireApiScope(principal,"entitlements:read",input.productId);
   return membershipStatus(db,input.productId,input.userId,input.plan);
  case "codes.redeem":
   requireApiScope(principal,"codes:redeem",input.productId);
   return redeemCode(db,input.userId,{productId:input.productId,code:input.code,idempotencyKey:input.idempotencyKey},Date.now(),services.external);
 }
}
export async function authenticatedApiOperation(db:D1Database,authorization:string|null,raw:unknown,services:ApiServices={}){
 return executeApiOperation(db,await authenticateApiToken(db,authorization),raw,services);
}
