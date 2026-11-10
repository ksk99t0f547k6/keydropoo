// 商品圖示的共用規則（前後端都用）。
export const PRODUCT_ICON_TYPES = ["image/png", "image/webp", "image/jpeg"] as const;
export type ProductIconType = (typeof PRODUCT_ICON_TYPES)[number];
/** 瀏覽器端縮成的邊長；分享卡片最大畫到約 140px，256 足夠清楚。 */
export const PRODUCT_ICON_SIZE = 256;
export const PRODUCT_ICON_MAX_BYTES = 256 * 1024;
export const PRODUCT_ICON_MIN_SIDE = 32;
export const PRODUCT_ICON_MAX_SIDE = 1024;

/** 帶版本的圖示網址；版本變了網址就變，可以長期快取。 */
export function productIconUrl(productId: string, version: string | null | undefined) {
  return version ? `/api/products/${productId}/icon?v=${encodeURIComponent(version)}` : null;
}

export interface SniffedImage {
  type: ProductIconType;
  width: number;
  height: number;
}

// 依檔頭判斷格式與尺寸，不信任用戶端宣告的類型；只認 PNG、WebP、JPEG。
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
  // PNG：簽章後第一個區塊必須是 IHDR。
  if (bytes.length >= 24 && ascii(1, 3) === "PNG" && bytes[0] === 0x89 && ascii(12, 4) === "IHDR") {
    return { type: "image/png", width: view.getUint32(16), height: view.getUint32(20) };
  }
  // WebP：RIFF....WEBP 加上 VP8 / VP8L / VP8X 其中一種。
  if (bytes.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8 " && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
      return { type: "image/webp", width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    }
    if (chunk === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      return { type: "image/webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { type: "image/webp", width, height };
    }
    return null;
  }
  // JPEG：逐段找 SOF 標記取尺寸。
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      if (marker === 0xd9 || marker === 0xda) return null;
      const length = view.getUint16(offset + 2);
      if (length < 2) return null;
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) return { type: "image/jpeg", height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += 2 + length;
    }
  }
  return null;
}
