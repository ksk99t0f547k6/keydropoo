import {loadMessages} from '../../i18n/messages';
import {z} from 'zod';
import {encryptionKey, openCode} from '../domain/codes';
import type {EmailSender} from './env';
import {codeEmailText} from './code-email-content';

export async function deliverGuestClaimEmails(db: D1Database, config: {sender?: EmailSender; from?: string; encryptionSecret?: string; appUrl?: string}, now = Date.now()) {
  if(!config.sender || !config.from || !config.encryptionSecret) return {sent: 0, cancelled: 0};
  const from = z.email().parse(config.from), key = await encryptionKey(config.encryptionSecret);
  await db.prepare("UPDATE guest_claim_emails SET status='failed',lease_token=NULL,lease_until=NULL WHERE attempts>=5 AND (status='pending' OR (status='sending' AND lease_until<=?))").bind(now).run();
  const {results} = await db.prepare(`SELECT claim_id FROM guest_claim_emails WHERE attempts<5 AND
    ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?)) ORDER BY next_attempt_at,claim_id LIMIT 10`)
    .bind(now, now).all<{claim_id: string}>();
  const started = Date.now();let sent = 0, cancelled = 0;
  for(const job of results) {
    const at = now + Date.now() - started, lease = crypto.randomUUID();
    const lock = await db.prepare(`UPDATE guest_claim_emails SET status='sending',attempts=attempts+1,lease_token=?,lease_until=? WHERE claim_id=? AND attempts<5
      AND ((status='pending' AND next_attempt_at<=?) OR (status='sending' AND lease_until<=?))`).bind(lease, at + 60000, job.claim_id, at, at).run();
    if(!lock.meta.changes) continue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const row = await db.prepare(`SELECT e.recipient_ciphertext,e.locale,c.ciphertext,c.product_id,c.id AS code_id,p.name
        FROM guest_claim_emails e JOIN claims cl ON cl.id=e.claim_id JOIN codes c ON c.id=cl.code_id JOIN products p ON p.id=c.product_id
        WHERE e.claim_id=? AND e.lease_token=? AND c.status!='revoked' AND (c.expires_at IS NULL OR c.expires_at>?) AND p.archived_at IS NULL
        AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id)`)
        .bind(job.claim_id, lease, at).first<{recipient_ciphertext: string; locale: string | null; ciphertext: string; product_id: string; code_id: string; name: string}>();
      if(!row) {
        const result = await db.prepare("UPDATE guest_claim_emails SET status='cancelled',lease_token=NULL,lease_until=NULL WHERE claim_id=? AND lease_token=?").bind(job.claim_id, lease).run();
        cancelled += result.meta.changes;continue;
      }
      const to = z.email().parse(await openCode(row.recipient_ciphertext, key, `guest-claim-email:${job.claim_id}`));
      const code = await openCode(row.ciphertext, key, `${row.product_id}:${row.code_id}`);
      // 用領取者要求寄信時的介面語言寄送。
      const {email} = await loadMessages(row.locale);
      const receipt = await Promise.race([
        config.sender.send({from, to, subject: email.codeSubject, text: codeEmailText({product: row.name, code, appUrl: config.appUrl, linkRecipient: true, email})}),
        new Promise<never>((_, reject) => {timer = setTimeout(() => reject(new Error('EMAIL_TIMEOUT')), 10000);}),
      ]);
      const messageId = receipt && typeof receipt === 'object' && 'messageId' in receipt && typeof receipt.messageId === 'string' && receipt.messageId.length<=255 ? receipt.messageId : null;
      const result = await db.prepare("UPDATE guest_claim_emails SET status='sent',message_id=?,lease_token=NULL,lease_until=NULL WHERE claim_id=? AND lease_token=?").bind(messageId, job.claim_id, lease).run();
      sent += result.meta.changes;
    } catch {
      await db.prepare("UPDATE guest_claim_emails SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,next_attempt_at=?,lease_token=NULL,lease_until=NULL WHERE claim_id=? AND lease_token=?")
        .bind(now + Date.now() - started + 300000, job.claim_id, lease).run();
    } finally {if(timer) clearTimeout(timer);}
  }
  return {sent, cancelled};
}
