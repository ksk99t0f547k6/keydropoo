import {z} from "zod";
import {runtime} from "@/lib/server/env";
import {createAuth,isAdmin} from "@/lib/server/auth";
import {readJson,errorResponse,HttpError} from "@/lib/server/http";
import {releaseOwnedDevice} from "@/lib/server/licenses";
export async function DELETE(request:Request){
 try{
  const {env,settings}=await runtime();if(request.headers.get("origin")!==settings.APP_URL)throw new HttpError(403,"INVALID_ORIGIN");
  const session=await createAuth(env,settings).api.getSession({headers:request.headers});if(!session)throw new HttpError(401,"UNAUTHORIZED");
  const input=z.object({activationId:z.uuid()}).strict().parse(await readJson(request,1024));
  return Response.json(await releaseOwnedDevice(env.DB,input.activationId,session.user.id,await isAdmin(env.DB,session.user.id)));
 }catch(error){return errorResponse(error);}
}
