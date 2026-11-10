import {headers} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {getTranslations} from 'next-intl/server';
import {z} from 'zod';
import {runtime} from '@/lib/server/env';
import {createAuth,isAdmin} from '@/lib/server/auth';
import {ProductDevices} from '@/components/licenses/product-devices';
import {SectionTitle} from '@/components/dashboard/page-header';
import {Card,CardContent} from '@/components/motion/card';

export const dynamic='force-dynamic';
export const metadata={robots:{index:false,follow:false}};
export default async function Devices({params}:{params:Promise<{id:string}>}){
 const {env,settings}=await runtime();
 const session=await createAuth(env,settings).api.getSession({headers:await headers()});
 if(!session)redirect('/sign-in');if(!await isAdmin(env.DB,session.user.id))redirect('/');
 const {id}=await params;if(!z.uuid().safeParse(id).success)notFound();
 const product=await env.DB.prepare('SELECT name FROM products WHERE id=?').bind(id).first<{name:string}>();
 if(!product)notFound();
 const t=await getTranslations();
 return <><SectionTitle title={t('adminDevices.title')} description={t('adminDevices.description')}/><Card><CardContent><ProductDevices productId={id}/></CardContent></Card></>;
}
