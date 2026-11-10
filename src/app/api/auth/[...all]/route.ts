import { runtime } from "@/lib/server/env";
import { createAuth } from "@/lib/server/auth";
async function handle(request: Request) {
  const { env, settings } = await runtime();
  return createAuth(env, settings).handler(request);
}
export { handle as GET, handle as POST };
