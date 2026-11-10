// 分享圖片：在瀏覽器用 canvas 畫，碼不會送到任何伺服器。輸出 1080×1350（4:5），適合聊天與社群。
export type ShareTemplate = "paper" | "midnight" | "ticket";
export const shareTemplates: ShareTemplate[] = ["paper", "midnight", "ticket"];

export interface ShareCardInput {
  code: string;
  product: string;
  eyebrow: string;
  message?: string | null;
  expires?: string | null;
  brand: string;
  /** 商品圖示網址（同源）；載入失敗時卡片照常畫，只是不放圖示。 */
  icon?: string | null;
}

type Icon = HTMLImageElement | null;

const iconCache = new Map<string, Promise<Icon>>();
function loadIcon(url: string | null | undefined): Promise<Icon> {
  if (!url || typeof Image === "undefined") return Promise.resolve(null);
  let pending = iconCache.get(url);
  if (!pending) {
    pending = new Promise<Icon>((resolve) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    }).then((image) => {
      if (!image) iconCache.delete(url);
      return image;
    });
    iconCache.set(url, pending);
  }
  return pending;
}

// 商品圖示：圓角方塊，底下墊一塊底色，透明背景的圖示在深色或彩色卡片上也看得清楚。
function drawIcon(ctx: CanvasRenderingContext2D, icon: HTMLImageElement, x: number, y: number, size: number, options: { plate: string; border?: string; shadow?: string }) {
  const radius = size * 0.24;
  ctx.save();
  if (options.shadow) {
    ctx.shadowColor = options.shadow;
    ctx.shadowBlur = size * 0.3;
    ctx.shadowOffsetY = size * 0.08;
  }
  ctx.fillStyle = options.plate;
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, radius);
  ctx.clip();
  ctx.drawImage(icon, x, y, size, size);
  ctx.restore();
  if (options.border) {
    ctx.strokeStyle = options.border;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, size - 2, size - 2, radius);
    ctx.stroke();
  }
}

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1350;

function fontFamily(variable: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.querySelector(".dashboard-root") ?? document.documentElement).getPropertyValue(variable).trim();
  return value ? `${value}, ${fallback}` : fallback;
}

// 長碼自動縮小字級，必要時分兩行，確保整個碼都看得到。
function fitCode(ctx: CanvasRenderingContext2D, code: string, family: string, maxWidth: number, maxSize: number, minSize: number) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `600 ${size}px ${family}`;
    if (ctx.measureText(code).width <= maxWidth) return { size, lines: [code] };
  }
  const half = Math.ceil(code.length / 2);
  const lines = [code.slice(0, half), code.slice(half)];
  for (let size = maxSize; size >= minSize; size -= 2) {
    ctx.font = `600 ${size}px ${family}`;
    if (lines.every((line) => ctx.measureText(line).width <= maxWidth)) return { size, lines };
  }
  ctx.font = `600 ${minSize}px ${family}`;
  return { size: minSize, lines };
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = `${kept[maxLines - 1].replace(/.{0,2}$/, "")}…`;
    return kept;
  }
  return lines;
}

function drawCodeBlock(ctx: CanvasRenderingContext2D, code: string, mono: string, centerX: number, top: number, maxWidth: number, color: string, maxSize = 96) {
  const { size, lines } = fitCode(ctx, code, mono, maxWidth, maxSize, 40);
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const lineHeight = size * 1.2;
  lines.forEach((line, index) => ctx.fillText(line, centerX, top + index * lineHeight));
  return lines.length * lineHeight;
}

function paper(ctx: CanvasRenderingContext2D, input: ShareCardInput, sans: string, mono: string, icon: Icon) {
  const W = CARD_WIDTH, H = CARD_HEIGHT;
  ctx.fillStyle = "#f4f3ef";
  ctx.fillRect(0, 0, W, H);
  // 細格線底紋
  ctx.strokeStyle = "rgba(25,25,24,0.05)";
  ctx.lineWidth = 2;
  for (let x = 60; x < W; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#6a6966";
  ctx.font = `600 30px ${sans}`;
  if (icon) {
    drawIcon(ctx, icon, 96, 80, 112, { plate: "#ffffff", border: "rgba(25,25,24,0.12)" });
    ctx.fillStyle = "#6a6966";
    ctx.fillText(input.eyebrow.toUpperCase(), 236, 147);
  } else {
    ctx.fillText(input.eyebrow.toUpperCase(), 96, 170);
  }
  ctx.fillStyle = "#191918";
  ctx.font = `600 84px ${sans}`;
  const titleLines = wrap(ctx, input.product, W - 192, 2);
  titleLines.forEach((line, index) => ctx.fillText(line, 96, 280 + index * 96));
  // 碼框
  const boxTop = 560, boxHeight = 300;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#191918";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(96, boxTop, W - 192, boxHeight, 32);
  ctx.fill();
  ctx.stroke();
  ctx.font = `500 26px ${sans}`;
  ctx.fillStyle = "#6a6966";
  const { size, lines } = fitCode(ctx, input.code, mono, W - 280, 92, 40);
  const blockHeight = lines.length * size * 1.2;
  drawCodeBlock(ctx, input.code, mono, W / 2, boxTop + (boxHeight - blockHeight) / 2, W - 280, "#191918", 92);
  let y = boxTop + boxHeight + 90;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  if (input.message) {
    ctx.fillStyle = "#191918";
    ctx.font = `400 40px ${sans}`;
    for (const line of wrap(ctx, input.message, W - 192, 3)) {
      ctx.fillText(line, 96, y);
      y += 56;
    }
    y += 10;
  }
  if (input.expires) {
    ctx.fillStyle = "#6a6966";
    ctx.font = `400 32px ${sans}`;
    ctx.fillText(input.expires, 96, y);
  }
  ctx.fillStyle = "#191918";
  ctx.font = `700 34px ${sans}`;
  ctx.fillText(input.brand, 96, H - 110);
  ctx.fillStyle = "#d9443b";
  ctx.beginPath();
  ctx.arc(96 + ctx.measureText(input.brand).width + 14, H - 120, 8, 0, Math.PI * 2);
  ctx.fill();
}

function midnight(ctx: CanvasRenderingContext2D, input: ShareCardInput, sans: string, mono: string, icon: Icon) {
  const W = CARD_WIDTH, H = CARD_HEIGHT;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1b1b2e");
  bg.addColorStop(1, "#0b0b0d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // 柔光
  const glow = ctx.createRadialGradient(W * 0.78, H * 0.18, 0, W * 0.78, H * 0.18, 620);
  glow.addColorStop(0, "rgba(124,108,255,0.55)");
  glow.addColorStop(1, "rgba(124,108,255,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const glow2 = ctx.createRadialGradient(W * 0.1, H * 0.95, 0, W * 0.1, H * 0.95, 560);
  glow2.addColorStop(0, "rgba(255,90,78,0.35)");
  glow2.addColorStop(1, "rgba(255,90,78,0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);
  if (icon) drawIcon(ctx, icon, W / 2 - 64, 92, 128, { plate: "#ffffff", shadow: "rgba(0,0,0,0.45)" });
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = `500 30px ${sans}`;
  ctx.fillText(input.eyebrow.toUpperCase(), W / 2, 260);
  ctx.fillStyle = "#ffffff";
  ctx.font = `600 76px ${sans}`;
  const titleLines = wrap(ctx, input.product, W - 200, 2);
  titleLines.forEach((line, index) => ctx.fillText(line, W / 2, 370 + index * 88));
  // 玻璃碼卡
  const boxTop = 560, boxHeight = 320;
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.strokeStyle = "rgba(255,255,255,0.22)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(110, boxTop, W - 220, boxHeight, 40);
  ctx.fill();
  ctx.stroke();
  const { size, lines } = fitCode(ctx, input.code, mono, W - 300, 92, 40);
  const blockHeight = lines.length * size * 1.2;
  drawCodeBlock(ctx, input.code, mono, W / 2, boxTop + (boxHeight - blockHeight) / 2, W - 300, "#ffffff", 92);
  let y = boxTop + boxHeight + 100;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (input.message) {
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.font = `400 40px ${sans}`;
    for (const line of wrap(ctx, input.message, W - 220, 3)) {
      ctx.fillText(line, W / 2, y);
      y += 56;
    }
    y += 10;
  }
  if (input.expires) {
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.font = `400 30px ${sans}`;
    ctx.fillText(input.expires, W / 2, y);
  }
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = `600 30px ${sans}`;
  ctx.fillText(input.brand, W / 2, H - 100);
}

function ticket(ctx: CanvasRenderingContext2D, input: ShareCardInput, sans: string, mono: string, icon: Icon) {
  const W = CARD_WIDTH, H = CARD_HEIGHT;
  const x = 90, y = 150, w = W - 180, h = H - 300, notch = 46;
  // 先量好上半部內容，再決定撕線位置，避免文字壓到撕線。
  ctx.font = `700 78px ${sans}`;
  const titleLines = wrap(ctx, input.product, w - 120, 2);
  const codeTop = y + 230 + titleLines.length * 88 + 10;
  const codeHeight = 230;
  ctx.font = `400 36px ${sans}`;
  const messageLines = input.message ? wrap(ctx, input.message, w - 140, 3) : [];
  const messageTop = codeTop + codeHeight + 80;
  const contentEnd = messageLines.length ? messageTop + (messageLines.length - 1) * 50 + 20 : codeTop + codeHeight;
  const tear = Math.min(Math.max(contentEnd + 70, y + h * 0.66), y + h - 200);

  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#ff7a59");
  bg.addColorStop(1, "#f6c35b");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.shadowColor = "rgba(80,30,0,0.25)";
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 20;
  ctx.fillStyle = "#fffaf3";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 44);
  ctx.fill();
  ctx.restore();
  // 左右缺口：先挖空，再把背景補回洞裡。
  ctx.globalCompositeOperation = "destination-out";
  for (const cx of [x, x + w]) {
    ctx.beginPath();
    ctx.arc(cx, tear, notch, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "destination-over";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
  ctx.setLineDash([18, 16]);
  ctx.strokeStyle = "rgba(25,25,24,0.25)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x + notch + 20, tear);
  ctx.lineTo(x + w - notch - 20, tear);
  ctx.stroke();
  ctx.setLineDash([]);

  if (icon) drawIcon(ctx, icon, W / 2 - 64, y - 64, 128, { plate: "#ffffff", border: "#fffaf3", shadow: "rgba(80,30,0,0.3)" });
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#c2492c";
  ctx.font = `700 30px ${sans}`;
  ctx.fillText(input.eyebrow.toUpperCase(), W / 2, y + 120);
  ctx.fillStyle = "#1e2230";
  ctx.font = `700 78px ${sans}`;
  titleLines.forEach((line, index) => ctx.fillText(line, W / 2, y + 230 + index * 88));
  ctx.fillStyle = "#1e2230";
  ctx.beginPath();
  ctx.roundRect(x + 60, codeTop, w - 120, codeHeight, 28);
  ctx.fill();
  const { size, lines } = fitCode(ctx, input.code, mono, w - 200, 88, 40);
  const blockHeight = lines.length * size * 1.2;
  drawCodeBlock(ctx, input.code, mono, W / 2, codeTop + (codeHeight - blockHeight) / 2, w - 200, "#fffaf3", 88);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  if (messageLines.length) {
    ctx.fillStyle = "#3a3a38";
    ctx.font = `400 36px ${sans}`;
    messageLines.forEach((line, index) => ctx.fillText(line, W / 2, messageTop + index * 50));
  }
  // 票根：到期日與品牌置中。
  const stubCenter = (tear + y + h) / 2;
  if (input.expires) {
    ctx.fillStyle = "#6a6966";
    ctx.font = `500 32px ${sans}`;
    ctx.fillText(input.expires, W / 2, stubCenter - 12);
  }
  ctx.fillStyle = "#1e2230";
  ctx.font = `700 34px ${sans}`;
  ctx.fillText(input.brand, W / 2, input.expires ? stubCenter + 50 : stubCenter + 12);
}

export async function renderShareCard(template: ShareTemplate, input: ShareCardInput, scale = 1) {
  const [icon] = await Promise.all([loadIcon(input.icon), typeof document !== "undefined" && document.fonts ? document.fonts.ready : null]);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(CARD_WIDTH * scale);
  canvas.height = Math.round(CARD_HEIGHT * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("CANVAS_UNAVAILABLE");
  ctx.scale(scale, scale);
  const sans = fontFamily("--font-dashboard", "ui-sans-serif, system-ui, -apple-system, sans-serif");
  const mono = fontFamily("--font-dashboard-mono", "ui-monospace, SFMono-Regular, Menlo, monospace");
  ({ paper, midnight, ticket })[template](ctx, input, sans, mono, icon);
  return canvas;
}

export function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("CANVAS_EXPORT_FAILED"))), "image/png"));
}
