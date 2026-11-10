import {z} from "zod";
import {runtime} from "@/lib/server/env";
import {createAuth,isAdmin} from "@/lib/server/auth";
import {errorResponse,HttpError} from "@/lib/server/http";
import {membershipStatus} from "@/lib/server/memberships";
export async function GET(request:Request){
 try{
  const {env,settings}=await runtime();const session=await createAuth(env,settings).api.getSession({headers:request.headers});if(!session)throw new HttpError(401,"UNAUTHORIZED");
  const input=z.object({productId:z.uuid(),plan:z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),userId:z.string().min(1).max(128).optional()}).strict().parse(Object.fromEntries(new URL(request.url).searchParams));
  const userId=input.userId??session.user.id;if(userId!==session.user.id&&!await isAdmin(env.DB,session.user.id))throw new HttpError(403,"FORBIDDEN");
  return Response.json(await membershipStatus(env.DB,input.productId,userId,input.plan),{headers:{"Cache-Control":"no-store"}});
 }catch(error){const response=errorResponse(error);response.headers.set("Cache-Control","no-store");return response;}
}
