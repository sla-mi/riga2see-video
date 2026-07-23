#!/usr/bin/env python3
"""Проверка медиа ленты: живы ли все видео и картинки, и играет ли видео на айфоне.

Запуск:
    python3 check_media.py            # быстро: только доступность (HTTP + тип)
    python3 check_media.py --codec    # + кодек каждого видео (качает по 400КБ, дольше)

Ловит ровно то, на чём уже обжигались:
  * VP9-видео (на iPhone не играет, десктопный Chrome бага не показывает)
  * протухшие ссылки fbcdn (живут ~5 дней, отдают 403)
  * любую чужую картинку, которую хост убрал/переименовал

Выход: код 1, если есть битое — чтобы можно было звать перед деплоем.
"""
import json, subprocess, sys, os, time
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from urllib.parse import urlparse

FEED = os.path.join(os.path.dirname(os.path.abspath(__file__)), "big_feed.json")
DEEP = "--codec" in sys.argv
# Cloudflare/R2 отбивает голый Python-UA (403) — поэтому curl и обычный UA.
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1"


def is_image(path, ctype):
    """Картинка это или нет — решаем по СОДЕРЖИМОМУ, а не по заявленному типу.
    Songkick (images.sk-static.com) отдаёт живые JPEG как application/octet-stream, иногда вообще
    без Content-Type. Проверка «в типе есть слово image» объявляла 6 рабочих картинок битыми —
    сам на это попался 2026-07-23. Магические байты не врут."""
    if "image" in (ctype or ""):
        return True
    try:
        with open(path, "rb") as f:
            head = f.read(12)
    except OSError:
        return False
    return (head[:3] == b"\xff\xd8\xff"                       # JPEG
            or head[:8] == b"\x89PNG\r\n\x1a\n"               # PNG
            or head[:6] in (b"GIF87a", b"GIF89a")             # GIF
            or (head[:4] == b"RIFF" and head[8:12] == b"WEBP")# WebP
            or head[4:12] in (b"ftypavif", b"ftypheic"))      # AVIF/HEIC


def probe(url, want_video):
    """Тянем первый килобайт: HEAD поддерживают не все хосты, Range — почти все.
    Повтор обязателен: при 16 потоках часть запросов отваливается по таймауту (код 000),
    и без повтора проверка объявляет живой файл битым — сам на это попался."""
    tmp = f"/tmp/_probe_{abs(hash(url))}.bin"
    for attempt in (1, 2, 3):
        r = subprocess.run(
            ["curl", "-sS", "-A", UA, "-r", "0-1023", "-o", tmp,
             "-w", "%{http_code} %{content_type}", "--max-time", "25", url],
            capture_output=True, text=True)
        parts = (r.stdout or "").split()
        code = parts[0] if parts else "ERR"
        ctype = parts[1] if len(parts) > 1 else ""
        ok = code in ("200", "206") and (("video" in ctype) if want_video else is_image(tmp, ctype))
        if os.path.exists(tmp):
            os.remove(tmp)
        if ok or code not in ("000", "ERR", "429", "503"):
            return ok, code, ctype        # реальный ответ хоста — верим сразу
        # 429 = r2.dev режет за частоту (дев-адрес Cloudflare лимитирован). Это НЕ битый файл:
        # без паузы проверка сама себе делает 429 и объявляет живое мёртвым. Отступаем и пробуем снова.
        time.sleep(2 * attempt)
    return ok, code, ctype                # три раза подряд не ответил — считаем битым


def codec_of(url):
    """Кодек читаем из ФАЙЛА (первые 400КБ), а не по расширению: .mp4 бывает и VP9."""
    tmp = f"/tmp/_chk_{abs(hash(url))}.mp4"          # свой файл на поток: общий /tmp/_chk.mp4 затирался
    for rng in ("0-400000", None):                    # None = качаем целиком
        cmd = ["curl", "-sS", "-A", UA, "-o", tmp, "--max-time", "90", url]
        if rng: cmd[5:5] = ["-r", rng]
        subprocess.run(cmd, capture_output=True)
        r = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0",
                            "-show_entries", "stream=codec_name", "-of", "csv=p=0", tmp],
                           capture_output=True, text=True)
        c = (r.stdout or "").strip()
        if c:
            os.remove(tmp) if os.path.exists(tmp) else None
            return c
        # пусто = кусок нечитаем: у файла без +faststart служебный заголовок лежит В КОНЦЕ,
        # в первых 400КБ его нет. Это НЕ битый файл — качаем целиком и пробуем снова.
    os.remove(tmp) if os.path.exists(tmp) else None
    return "?"


def visible(feed):
    """Только то, что человек реально видит. Лента сама прячет события с прошедшей датой и без
    описания (см. currentList в index.html) — проверять их медиа смысла нет, они лишь раздувают
    цифры. На 2026-07-17: в файле 816, видно 695."""
    import datetime
    today = datetime.date.today().isoformat()

    def fut(e):
        ds = e.get("dates") or ([e["date"]] if e.get("date") else [])
        return any(str(d)[:10] >= today for d in ds)

    def hasdesc(e):
        b = (e.get("body") or "").strip()
        return len(b) >= 15 and "появится позже" not in b.lower()

    return [e for e in feed if fut(e) and hasdesc(e)]


def main():
    allfeed = json.load(open(FEED))
    feed = allfeed if "--all" in sys.argv else visible(allfeed)
    if feed is not allfeed:
        print(f"в файле {len(allfeed)} событий, видно {len(feed)} "
              f"(прочие скрыты лентой: прошедшая дата / нет описания). --all чтобы проверить все")
    vids, imgs = {}, {}
    for e in feed:
        v = e.get("video") or {}
        if v.get("type") == "mp4" and v.get("url"):
            vids.setdefault(v["url"], []).append(e["id"])
        if e.get("img"):
            imgs.setdefault(e["img"], []).append(e["id"])

    print(f"событий {len(feed)} | видео-файлов {len(vids)} | картинок {len(imgs)}")
    print("проверяю доступность…")

    bad_v, bad_i = [], []
    with ThreadPoolExecutor(max_workers=6) as ex:   # больше — r2.dev начинает резать (429) и проверка врёт
        for (url, ids), (ok, code, ct) in zip(vids.items(), ex.map(lambda u: probe(u, True), vids)):
            if not ok:
                bad_v.append((url, ids, code, ct))
        for (url, ids), (ok, code, ct) in zip(imgs.items(), ex.map(lambda u: probe(u, False), imgs)):
            if not ok:
                bad_i.append((url, ids, code, ct))

    print(f"\nВИДЕО: битых {len(bad_v)} из {len(vids)}")
    for url, ids, code, ct in bad_v[:15]:
        print(f"   [{code}] события {ids[:3]} {url.split('/')[-1]}")

    print(f"\nКАРТИНКИ: битых {len(bad_i)} из {len(imgs)}")
    if bad_i:
        # fbcdn размазан по десяткам поддоменов — схлопываем, иначе не видно масштаба
        def group(u):
            h = urlparse(u).netloc
            return "fbcdn.net (протухшие ссылки FB)" if "fbcdn" in h else h
        by_host = Counter(group(u) for u, _, _, _ in bad_i)
        for h, n in by_host.most_common():
            print(f"   {n:4}  {h}")
        dead_ids = sorted({i for _, ids, _, _ in bad_i for i in ids})
        blind = [e["id"] for e in feed if e["id"] in set(dead_ids) and not e.get("video")]
        print(f"   событий с битой картинкой: {len(dead_ids)} | из них БЕЗ видео (пустая карточка): {len(blind)}")

    bad_c = []
    if DEEP:
        print(f"\nКОДЕК {len(vids)} видео (h264 обязателен — iPhone не играет VP9)…")
        with ThreadPoolExecutor(max_workers=6) as ex:
            for (url, ids), c in zip(vids.items(), ex.map(codec_of, vids)):
                if c != "h264":
                    bad_c.append((url, ids, c))
        print(f"НЕ h264: {len(bad_c)}")
        for url, ids, c in bad_c[:15]:
            print(f"   [{c}] события {ids[:3]} {url.split('/')[-1]}")
    else:
        print("\n(кодек не проверялся — запусти с --codec)")

    # Снапшот ленты расходится с продом: события отменяют/сливают/фильтруют, а лента их всё ещё крутит.
    stale = 0
    try:
        r = subprocess.run(["curl", "-sS", "-A", UA, "--max-time", "60",
                            "https://riga-afisha-api.fly.dev/api/events?limit=2000"],
                           capture_output=True, text=True)
        live = json.loads(r.stdout)
        live = live if isinstance(live, list) else live.get("events", live)
        live_ids = {e["id"] for e in live}
        gone = [e["id"] for e in feed if e["id"] not in live_ids]
        stale = len(gone)
        print(f"\nСВЕЖЕСТЬ: показываем {stale} событий, которых прод уже НЕ отдаёт "
              f"(отменены/слиты/отфильтрованы): {gone[:8]}{'…' if stale > 8 else ''}")
        print(f"   в проде есть, а в ленте нет: {len(live_ids - {e['id'] for e in allfeed})} (снапшот устарел)")
    except Exception as ex:
        print(f"\nСВЕЖЕСТЬ: не проверил ({type(ex).__name__})")

    total = len(bad_v) + len(bad_i) + len(bad_c)
    print(f"\n{'МЕДИА ЧИСТО' if total == 0 else f'ПРОБЛЕМ С МЕДИА: {total}'}"
          + (f" | плюс {stale} протухших событий" if stale else ""))
    return 1 if total else 0


if __name__ == "__main__":
    sys.exit(main())
