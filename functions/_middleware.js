// Cloudflare Pages edge-функция: собирает OG-превью для соцсетей на СЕРВЕРЕ (краулеры не исполняют JS).
//  ?e=<id>   — превью конкретного события (картинка события + название + дата·место·цена)
//  &lang=..  — язык превью (lv|ru|en), берётся из языка того, кто делится ссылкой
//  без ?e, но с ?lang — брендовая карточка на нужном языке
// Значения по умолчанию (без параметров) стоят статикой в index.html.

const LANGS = ["ru", "lv", "en"];

const MONTHS = {
  ru: ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"],
  lv: ["janvāris","februāris","marts","aprīlis","maijs","jūnijs","jūlijs","augusts","septembris","oktobris","novembris","decembris"],
  en: ["January","February","March","April","May","June","July","August","September","October","November","December"],
};
const FREE = { ru: "Бесплатно", lv: "Bez maksas", en: "Free" };
const FROM = { ru: "от", lv: "no", en: "from" };
const BRAND = {
  ru: { t: "riga.2see — что в Риге прямо сейчас",  d: "Лента культурных событий Риги: концерты, театр, выставки. Листай — и выбирай, куда пойти." },
  lv: { t: "riga.2see — kas notiek Rīgā tagad",     d: "Rīgas kultūras notikumu lente: koncerti, teātris, izstādes. Ritini un izvēlies, kurp doties." },
  en: { t: "riga.2see — what's on in Riga now",     d: "Riga's culture feed: concerts, theatre, exhibitions. Swipe and pick where to go." },
};

function fmtDate(dd, d, lang) {
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
  const dayNum = best.getDate() + (lang === "lv" ? "." : "");
  const hh = String(best.getHours()).padStart(2, "0");
  const mm = String(best.getMinutes()).padStart(2, "0");
  const time = (best.getHours() || best.getMinutes()) ? `, ${hh}:${mm}` : "";
  return `${dayNum} ${MONTHS[lang][best.getMonth()]}${time}`;
}

function eventDesc(ev, lang) {
  const parts = [];
  const dateStr = fmtDate(ev.dd, ev.d, lang);
  if (dateStr) parts.push("📅 " + dateStr);
  if (ev.v) parts.push("📍 " + ev.v);
  const price = ev.free ? FREE[lang] : (ev.p != null ? `${FROM[lang]} ${Math.round(ev.p)} €` : "");
  if (price) parts.push("🎟 " + price);
  return parts.join("   ·   ");
}

class SetAttr { constructor(v){ this.v = v; } element(el){ if (this.v != null && this.v !== "") el.setAttribute("content", this.v); } }
class SetText { constructor(v){ this.v = v; } element(el){ el.setInnerContent(this.v); } }

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const eid = url.searchParams.get("e");
  const rawLang = (url.searchParams.get("lang") || "").toLowerCase();
  const hasLang = LANGS.includes(rawLang);
  const lang = hasLang ? rawLang : "ru";

  if (!eid && !hasLang) return next();           // корень без языка — статические дефолты в index.html

  const response = await next();
  const ct = response.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return response;

  const origin = url.origin;
  const brandImg = `${origin}/og-default-${lang}.jpg`;

  let title, desc, img, pageUrl;
  if (eid) {
    let ev = null;
    try {
      const r = await fetch(new URL("/og_index.json", origin), { cf: { cacheTtl: 3600, cacheEverything: true } });
      if (r.ok) { const idx = await r.json(); ev = idx[eid]; }
    } catch (_) {}
    if (ev) {
      title = ev.t || BRAND[lang].t;
      desc  = eventDesc(ev, lang) || BRAND[lang].d;
      img   = ev.img || brandImg;                // нет афиши — брендовая карточка
    } else {
      title = BRAND[lang].t; desc = BRAND[lang].d; img = brandImg;
    }
    pageUrl = `${origin}/?e=${eid}&lang=${lang}`;
  } else {
    title = BRAND[lang].t; desc = BRAND[lang].d; img = brandImg;
    pageUrl = `${origin}/?lang=${lang}`;
  }

  return new HTMLRewriter()
    .on('meta[property="og:title"]',        new SetAttr(title))
    .on('meta[property="og:description"]',  new SetAttr(desc))
    .on('meta[property="og:image"]',        new SetAttr(img))
    .on('meta[property="og:url"]',          new SetAttr(pageUrl))
    .on('meta[name="twitter:title"]',       new SetAttr(title))
    .on('meta[name="twitter:description"]', new SetAttr(desc))
    .on('meta[name="twitter:image"]',       new SetAttr(img))
    .on('title',                            new SetText(title + " — riga.2see"))
    .transform(response);
}
