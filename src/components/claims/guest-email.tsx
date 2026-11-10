'use client';
import {useEffect, useState, type FormEvent} from 'react';
import {useTranslations} from 'next-intl';
import {siteFeatures} from '@/config/site';
import {Input} from '@/components/motion/input';
import {Button} from '@/components/motion/button/base';

type Job = {id: string; status: 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled'; attempts: number};
export function GuestEmail({claimId}: {claimId: string}) {
  const t = useTranslations('guestEmail');
  const [job, setJob] = useState<Job | null>(null), [email, setEmail] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void fetch(`/api/claims/${claimId}/email`, {signal: abort.signal}).then(async response => {
      if(!response.ok) throw new Error();
      const data = await response.json() as {job: Job | null};if(!abort.signal.aborted) setJob(data.job);
    }).catch(() => {if(!abort.signal.aborted) setError(t('statusFailed'));}).finally(() => {if(!abort.signal.aborted) setLoading(false);});
    return () => abort.abort();
  }, [claimId, t]);
  async function refresh() {
    setBusy(true);setError('');
    try {
      const response = await fetch(`/api/claims/${claimId}/email`);if(!response.ok) throw new Error();
      const data = await response.json() as {job: Job | null};setJob(data.job);
    } catch {setError(t('statusFailed'));} finally {setBusy(false);}
  }
  async function submit(event: FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    const recipient = submittedEmail ?? email.trim().toLowerCase();setSubmittedEmail(recipient);
    try {
      const response = await fetch(`/api/claims/${claimId}/email`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({email: recipient})});
      const data = await response.json() as {job?: Job; error?: string};
      if(!response.ok || !data.job) {if(response.status===400)setSubmittedEmail(null);setError(t(data.error === 'RATE_LIMITED' ? 'limited' : data.error === 'EMAIL_IDEMPOTENCY_CONFLICT' ? 'conflict' : 'failed'));return;}
      setJob(data.job);setEmail('');setSubmittedEmail(null);
    } catch {setError(t('failed'));} finally {setBusy(false);}
  }
  return <section className="space-y-3 border-t border-border pt-5">
    <h3 className="font-medium">{t('title')}</h3>
    {loading ? <p role="status">{t('loading')}</p> : job ? <p role="status" className="text-sm">{t(job.status==='failed'&&!siteFeatures.myCodes?'failedWithoutAccount':`states.${job.status}`)}</p> : <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <Input type="email" label={t('email')} autoComplete="email" required maxLength={254} value={submittedEmail ?? email} onChange={setEmail} disabled={busy || submittedEmail !== null} />
      <Button type="submit" disabled={busy}>{t(busy ? 'working' : submittedEmail ? 'retry' : 'submit')}</Button>
    </form>}
    {!loading && <Button type="button" variant="outline" disabled={busy} onClick={refresh}>{t('refresh')}</Button>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
  </section>;
}
