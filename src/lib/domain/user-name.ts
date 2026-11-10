// 使用者顯示名稱：前後空白去掉、連續空白合併成一個，1–100 字。
// 拒絕控制字元與雙向覆寫等格式字元，避免名稱在後台或郵件裡偽裝成別的內容。
export const USER_NAME_MAX = 100;

export function normalizeUserName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!name || [...name].length > USER_NAME_MAX) return null;
  if (/[\p{Cc}\p{Cf}]/u.test(name)) return null;
  return name;
}
