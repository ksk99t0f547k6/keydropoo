import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// 預設核心只需要 D1；若採用 ISR，依 OpenNext 文件另外配置快取。
export default defineCloudflareConfig({});
