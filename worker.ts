// OpenNext 在建置時產生此模組；乾淨 checkout 尚不存在。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- 乾淨 checkout 缺少產物，建置後則存在；expect-error 無法同時適用兩種狀態。
// @ts-ignore
import handler from "./.open-next/worker.js";
import {maintainStripeDiscounts} from "./src/lib/server/stripe-discount-maintenance";
import {quarantineExternalAttempts} from "./src/lib/server/external-redemptions";
import { maintainOrders } from "./src/lib/server/order-maintenance";

import {deliverWebhookOutbox} from "./src/lib/server/webhook-outbox";
import {webhookHttpSender,webhookSecrets} from "./src/lib/server/webhook-http";

import {deliverCodeEmails,queueAutomaticCodeEmails} from "./src/lib/server/code-email";
import {deliverEmailDistributions} from './src/lib/server/email-distribution-delivery';
import {deliverGuestClaimEmails} from './src/lib/server/guest-claim-email-delivery';
import {deliverExternalRevocations} from "./src/lib/server/external-revocations";
import {externalRewardService} from "./src/lib/server/external-reward-service";
import {deliverAdminNotificationEmails} from "./src/lib/server/admin-notification-email";
import {siteFeatures} from "./src/config/site";
import {runScheduledTasks} from "./src/lib/server/scheduled";
import type {RuntimeEnv} from "./src/lib/server/env";

export default {
 fetch:handler.fetch,
 async scheduled(_controller,env){
  const runtimeEnv=env as RuntimeEnv;
  const mail={sender:runtimeEnv.EMAIL,from:runtimeEnv.EMAIL_FROM,encryptionSecret:runtimeEnv.CODE_ENCRYPTION_KEY,appUrl:runtimeEnv.APP_URL};
  // 保留原本順序：先刷新 Stripe 折扣狀態，再做訂單維護與補貨發碼。
  await runScheduledTasks([
   {name:"stripe-discounts",run:()=>maintainStripeDiscounts(env.DB,{stripeSecret:runtimeEnv.STRIPE_SECRET_KEY,encryptionSecret:runtimeEnv.CODE_ENCRYPTION_KEY,batchSize:runtimeEnv.STRIPE_SYNC_BATCH_SIZE?Number(runtimeEnv.STRIPE_SYNC_BATCH_SIZE):undefined})},
   {name:"external-quarantine",run:()=>quarantineExternalAttempts(env.DB)},
   {name:"orders",run:()=>maintainOrders(env.DB)},
   {name:"admin-notification-emails",run:()=>deliverAdminNotificationEmails(env.DB,{sender:runtimeEnv.EMAIL,from:runtimeEnv.EMAIL_FROM,appUrl:runtimeEnv.APP_URL,enabled:siteFeatures.adminNotificationEmail})},
   {name:"queue-code-emails",run:async()=>{if(runtimeEnv.EMAIL&&runtimeEnv.EMAIL_FROM&&runtimeEnv.CODE_ENCRYPTION_KEY)await queueAutomaticCodeEmails(env.DB);}},
   {name:"code-emails",run:()=>deliverCodeEmails(env.DB,mail)},
   {name:"email-distributions",run:()=>deliverEmailDistributions(env.DB,mail)},
   {name:"guest-claim-emails",run:()=>deliverGuestClaimEmails(env.DB,mail)},
   {name:"webhooks",run:()=>deliverWebhookOutbox(env.DB,webhookHttpSender(webhookSecrets((env as CloudflareEnv & {WEBHOOK_SECRETS?:string}).WEBHOOK_SECRETS)))},
   {name:"external-revocations",run:()=>deliverExternalRevocations(env.DB,externalRewardService(runtimeEnv))},
  ]);
 },
} satisfies ExportedHandler<CloudflareEnv>;
