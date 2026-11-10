import {isLocale} from '../../i18n/locales';
import {z} from 'zod';
import {encryptionKey, sealCode} from '../domain/codes';
import {identityHash} from './claim-identity';

export type GuestClaimActor = {browserId: string; userId?: string};
type Job = {claim_id: string; status: string; attempts: number; recipient_hash: string};
const emailInput = z.object({email: z.string().trim().toLowerCase().pipe(z.email().max(254))}).strict();
async function authorize(db: D1Database, claimId: string, actor: GuestClaimActor, secret: string) {
  z.uuid().parse(claimId);z.uuid().parse(actor.browserId);
  const subject = await identityHash(secret, `claim-subject:browser:${actor.browserId}`);
  const row = await db.prepare(`SELECT id FROM claims WHERE id=? AND subject_key=? AND (user_id IS NULL OR user_id=?)`)
    .bind(claimId, subject, actor.userId ?? null).first();
  if(!row) throw new Error('CLAIM_NOT_FOUND');
  return subject;
}
const receipt = (job: Job) => ({id: job.claim_id, status: job.status, attempts: job.attempts});
export async function guestClaimEmailStatus(db: D1Database, claimId: string, actor: GuestClaimActor, secret: string) {
  await authorize(db, claimId, actor, secret);
  const job = await db.prepare('SELECT claim_id,status,attempts,recipient_hash FROM guest_claim_emails WHERE claim_id=?').bind(claimId).first<Job>();
  return job ? receipt(job) : null;
}

export async function queueGuestClaimEmail(db: D1Database, claimId: string, actor: GuestClaimActor, raw: unknown, secrets: {identitySecret: string; encryptionSecret: string; locale?: string}, now = Date.now()) {
  const {email} = emailInput.parse(raw);
  // 郵件語言用領取者要求寄信時的介面語言。
  const locale = isLocale(secrets.locale) ? secrets.locale : null;
  const subject = await authorize(db, claimId, actor, secrets.identitySecret);
  const recipientHash = await identityHash(secrets.identitySecret, `guest-claim-email:${email}`);
  const find = () => db.prepare('SELECT claim_id,status,attempts,recipient_hash FROM guest_claim_emails WHERE claim_id=?').bind(claimId).first<Job>();
  function result(job: Job) {
    if(job.recipient_hash !== recipientHash) throw new Error('EMAIL_IDEMPOTENCY_CONFLICT');
    return receipt(job);
  }
  const previous = await find();if(previous) return result(previous);
  const encrypted = await sealCode(email, await encryptionKey(secrets.encryptionSecret), `guest-claim-email:${claimId}`);
  try {
    const saved = await db.prepare(`INSERT INTO guest_claim_emails(claim_id,recipient_ciphertext,recipient_hash,anonymous_ip_key,next_attempt_at,created_at,locale)
      SELECT cl.id,?,?,cl.anonymous_ip_key,?,?,? FROM claims cl JOIN codes c ON c.id=cl.code_id JOIN products p ON p.id=c.product_id
      WHERE cl.id=? AND cl.subject_key=? AND cl.user_id IS NULL AND cl.anonymous_ip_key IS NOT NULL
      AND c.status!='revoked' AND (c.expires_at IS NULL OR c.expires_at>?) AND p.archived_at IS NULL
      AND NOT EXISTS(SELECT 1 FROM stripe_unavailable_codes WHERE code_id=c.id)`)
      .bind(encrypted, recipientHash, now, now, locale, claimId, subject, now).run();
    if(!saved.meta.changes) throw new Error('EMAIL_CODE_UNAVAILABLE');
  } catch(error) {
    const replay = await find();if(replay) return result(replay);
    if(error instanceof Error && error.message.includes('GUEST_EMAIL_RATE_LIMITED')) throw new Error('GUEST_EMAIL_RATE_LIMITED');
    throw error;
  }
  return result((await find())!);
}

// 驗證信箱後可跨裝置找回；不改原匿名 subject／IP，不移交已有持有人的紀錄。
// 每人上限：子查詢先排除已達上限的活動，同一批次內再由 claims_link_limit 觸發器逐筆把關。
export async function linkEmailedGuestClaims(db: D1Database, userId: string, secret: string, limit = 100) {
  z.string().min(1).max(128).parse(userId);
  z.number().int().min(0).max(100).parse(limit);
  if(limit === 0) return {linked: 0};
  const user = await db.prepare('SELECT email,emailVerified FROM "user" WHERE id=?').bind(userId).first<{email: string; emailVerified: number}>();
  if(!user?.emailVerified) throw new Error('CLAIM_VERIFIED_EMAIL_REQUIRED');
  const hash = await identityHash(secret, `guest-claim-email:${z.email().parse(user.email).toLowerCase()}`);
  const result = await db.prepare(`UPDATE claims SET user_id=?,email=? WHERE user_id IS NULL AND id IN(
    SELECT c.id FROM claims c JOIN guest_claim_emails e ON e.claim_id=c.id WHERE c.user_id IS NULL AND e.recipient_hash=?
    AND (SELECT count(*) FROM claims x WHERE x.campaign_id=c.campaign_id AND x.user_id=?)<(SELECT per_person_limit FROM campaigns WHERE id=c.campaign_id)
    ORDER BY c.created_at,c.id LIMIT ?)
    AND EXISTS(SELECT 1 FROM "user" WHERE id=? AND emailVerified=1 AND email=? COLLATE NOCASE)`)
    .bind(userId, user.email, hash, userId, limit, userId, user.email).run();
  return {linked: result.meta.changes};
}
