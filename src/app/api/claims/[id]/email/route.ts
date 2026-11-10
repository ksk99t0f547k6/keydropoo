import {runtime} from '@/lib/server/env';
import {createAuth} from '@/lib/server/auth';
import {browserIdentity, claimRateLimit, clientNetwork} from '@/lib/server/claim-identity';
import {guestClaimEmailStatus, queueGuestClaimEmail} from '@/lib/server/guest-claim-emails';
import {requestLocale} from '@/i18n/server-locale';
import {HttpError, errorResponse, readJson} from '@/lib/server/http';

type Context = {params: Promise<{id: string}>};
async function handle(request: Request, {params}: Context) {
  let response: Response;
  try {
    const {env, settings} = await runtime();
    if(request.method === 'POST' && request.headers.get('origin') !== settings.APP_URL) throw new HttpError(403, 'INVALID_ORIGIN');
    const browser = await browserIdentity(request.headers.get('cookie'), settings.BETTER_AUTH_SECRET, settings.APP_URL.startsWith('https:'));
    if(browser.setCookie) throw new HttpError(403, 'CLAIM_IDENTITY_REQUIRED');
    const session = await createAuth(env, settings).api.getSession({headers: request.headers});
    const actor = {browserId: browser.id, userId: session?.user.id};
    const {id} = await params;
    if(request.method === 'GET') response = Response.json({job: await guestClaimEmailStatus(env.DB, id, actor, settings.BETTER_AUTH_SECRET)});
    else {
      if(!env.EMAIL || !settings.EMAIL_FROM || !env.CODE_ENCRYPTION_KEY) throw new HttpError(503, 'EMAIL_NOT_CONFIGURED');
      const local = process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1'].includes(new URL(settings.APP_URL).hostname);
      const rawIp = local ? '127.0.0.1' : request.headers.get('cf-connecting-ip');
      const ip = rawIp ? clientNetwork(rawIp) : null;
      if(!ip) throw new HttpError(503, 'CLAIM_IDENTITY_REQUIRED');
      if(!await claimRateLimit(env.DB, settings.BETTER_AUTH_SECRET, ip)) throw new HttpError(429, 'RATE_LIMITED');
      response = Response.json({job: await queueGuestClaimEmail(env.DB, id, actor, await readJson(request, 2048), {locale: await requestLocale(), identitySecret: settings.BETTER_AUTH_SECRET, encryptionSecret: env.CODE_ENCRYPTION_KEY})});
    }
  } catch(error) {
    response = error instanceof Error && error.message === 'GUEST_EMAIL_RATE_LIMITED' ? Response.json({error: 'RATE_LIMITED'}, {status: 429}) : errorResponse(error);
  }
  response.headers.set('Cache-Control', 'no-store');return response;
}
export const GET = handle;
export const POST = handle;
