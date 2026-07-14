// Cloudflare Pages edge-функция: для ссылок ?e=<id> подменяет OG-теги на данные конкретного
// события (картинка/название/дата/место/цена), чтобы превью в соцсетях «продавало само».
// Краулеры (FB/Telegram/WhatsApp/Twitter) НЕ исполняют JS — поэтому теги ставим здесь, на сервере.

const MON = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];

function nearestDate(dd, d) {
  const list = (dd && dd.length) ? dd : (d ? [d] : []);
  if (!list.length) return "";
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let best = null;
  for (const s of list) {
    const dt = new Date(String(s).replace(" ", "T"));
    if (isNaN(dt)) continue;
    const day = new Date(dt); day.setHours(0, 0, 0, 0);
    if (day.getTime() >= today.getTime() && (!best || dt < best)) best = dt;
  }
  if (!best) { best = new Date(String(list[list.length - 1]).replace(" ", "T")); if (isNaN(best)) return ""; }
  const hh = String(best.getHours()).padStart(2, "0");
  const mm = String(best.getMinutes()).padStart(2, "0");
  const time = (best.getHours() || best.getMinutes()) ? `, ${hh}:${mm}` : "";
  return `${best.getDate()} ${MON[best.getMonth()]}${time}`;
}

class SetAttr {
  constructor(val) { this.val = val; }
  element(el) { if (this.val != null && this.val !== "") el.setAttribute("content", this.val); }
}
class SetText {
  constructor(val) { this.val = val; }
  element(el) { el.setInnerContent(this.val); }
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const eid = url.searchParams.get("e");
  if (!eid) return next();                       // не шаренная ссылка события — ничего не трогаем

  const response = await next();                 // отдаём обычный index.html
  const ct = response.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return response;

  let ev = null;
  try {
    const idxResp = await fetch(new URL("/og_index.json", url.origin), { cf: { cacheTtl: 3600, cacheEverything: true } });
    if (idxResp.ok) { const idx = await idxResp.json(); ev = idx[eid]; }
  } catch (_) {}
  if (!ev) return response;                       // события нет — оставляем дефолтные теги

  const title = ev.t || "riga.2see";
  const dateStr = nearestDate(ev.dd, ev.d);
  const parts = [];
  if (dateStr) parts.push("📅 " + dateStr);
  if (ev.v) parts.push("📍 " + ev.v);
  const price = ev.free ? "Бесплатно" : (ev.p != null ? "от " + Math.round(ev.p) + " €" : "");
  if (price) parts.push("🎟 " + price);
  const desc = parts.join("   ·   ") || "Событие в Риге — на riga.2see";
  const img = ev.img || "https://feed.2see.live/og-default.jpg";
  const pageUrl = url.origin + "/?e=" + eid;

  return new HTMLRewriter()
    .on('meta[property="og:title"]',       new SetAttr(title))
    .on('meta[property="og:description"]', new SetAttr(desc))
    .on('meta[property="og:image"]',       new SetAttr(img))
    .on('meta[property="og:url"]',         new SetAttr(pageUrl))
    .on('meta[name="twitter:title"]',      new SetAttr(title))
    .on('meta[name="twitter:description"]',new SetAttr(desc))
    .on('meta[name="twitter:image"]',      new SetAttr(img))
    .on('title',                           new SetText(title + " — riga.2see"))
    .transform(response);
}
