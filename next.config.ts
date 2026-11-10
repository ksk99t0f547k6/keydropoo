import { loadEnvFile } from "node:process";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
if (process.env.KEYDROP_DEV_ENV_FILE && process.env.NODE_ENV === "development") loadEnvFile(process.env.KEYDROP_DEV_ENV_FILE);
// 本機驗收曾在跨建置重用快取後持續 HMR 重載；開發先停用磁碟快取，正式建置不變。
const nextConfig: NextConfig = {allowedDevOrigins:['127.0.0.1'],experimental:{turbopackFileSystemCacheForDev:false}};
export default createNextIntlPlugin()(nextConfig);
// 開發時使用本機 D1 綁定。
initOpenNextCloudflareForDev();
