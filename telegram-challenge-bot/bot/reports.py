from io import BytesIO

from PIL import Image, ImageDraw, ImageFont
from telegram import InputFile

from . import badges, config, db, stats

_FONT_PATHS = [
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def _font(size: int):
    for path in _FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _week_block(uid: int, name: str, day_to: int) -> str:
    day_from = day_to - 6
    new_badges = badges.check_week_badges(uid, day_from, day_to)
    entries = db.entries_in_range(uid, day_from, day_to)
    verse = "-"
    for e in reversed(entries):
        if e["verse"]:
            verse = e["verse"]
            break
    lines = [
        f"— {name} —",
        f"Days: {stats.completed_in_range(uid, day_from, day_to)}/7",
        f"$ this week: ${stats.money_in_range(uid, day_from, day_to):,.0f}",
        f"Total $: ${stats.total_money(uid):,.0f}",
        f"Streak: {stats.current_streak(uid)} (best {stats.longest_streak(uid)})",
        f'Verse: "{verse}"',
    ]
    if new_badges:
        lines.append("🏅 " + ", ".join(new_badges))
    return "\n".join(lines)


async def send_weekly_report(context, day_to: int):
    week_num = day_to // 7
    lines = [f"📊 Week {week_num} Recap", f"Day {day_to}/90", ""]
    for uid in config.ALLOWED_USER_IDS:
        u = db.get_user(uid)
        name = u["name"] if u else str(uid)
        lines.append(_week_block(uid, name, day_to))
        lines.append("")
    lines.append("Next week's #1 focus?")
    await context.bot.send_message(chat_id=config.GROUP_CHAT_ID, text="\n".join(lines))


async def _fetch_photo(context, file_id):
    if not file_id:
        return None
    try:
        tg_file = await context.bot.get_file(file_id)
        buf = BytesIO()
        await tg_file.download_to_memory(out=buf)
        buf.seek(0)
        return Image.open(buf).convert("RGB")
    except Exception:
        return None


async def _build_card(context, uid: int, name: str) -> BytesIO:
    entries = db.all_entries_for_user(uid)
    first_photo_id = next((e["photo_file_id"] for e in entries if e["photo_file_id"]), None)
    last_photo_id = next(
        (e["photo_file_id"] for e in reversed(entries) if e["photo_file_id"]), None
    )
    before = await _fetch_photo(context, first_photo_id)
    after = await _fetch_photo(context, last_photo_id)

    verses = [e["verse"] for e in entries if e["verse"]][-3:]
    user_badges = [badges.BADGE_LABELS.get(b["badge_code"], b["badge_code"]) for b in db.get_badges(uid)]

    W, H = 1080, 1350
    bg = (28, 36, 32)
    img = Image.new("RGB", (W, H), bg)
    draw = ImageDraw.Draw(img)

    draw.text((40, 40), f"{name} — 90 Day Report", font=_font(48), fill=(255, 255, 255))
    draw.text(
        (40, 110),
        f"${stats.total_money(uid):,.0f} made  ·  {stats.total_completed(uid)}/90 days  ·  "
        f"best streak {stats.longest_streak(uid)}",
        font=_font(28),
        fill=(190, 215, 200),
    )

    photo_y = 170
    pw, ph = 480, 480
    if before:
        img.paste(before.resize((pw, ph)), (40, photo_y))
    if after:
        img.paste(after.resize((pw, ph)), (560, photo_y))
    draw.text((40, photo_y + ph + 10), "Day 1", font=_font(24), fill=(255, 255, 255))
    draw.text((560, photo_y + ph + 10), "Latest", font=_font(24), fill=(255, 255, 255))

    y = photo_y + ph + 60
    draw.text((40, y), "Badges", font=_font(30), fill=(255, 255, 255))
    y += 40
    draw.text(
        (40, y),
        " ".join(user_badges) if user_badges else "none yet",
        font=_font(24),
        fill=(255, 215, 130),
    )

    y += 60
    draw.text((40, y), "Top verses", font=_font(30), fill=(255, 255, 255))
    y += 40
    for v in verses:
        draw.text((40, y), f"- {v[:60]}", font=_font(24), fill=(220, 220, 220))
        y += 34

    out = BytesIO()
    img.save(out, "PNG")
    out.seek(0)
    out.name = f"{name}_report.png"
    return out


async def send_final_report(context):
    await context.bot.send_message(
        chat_id=config.GROUP_CHAT_ID, text="🏁 90 DAYS DONE. Final report cards:"
    )
    for uid in config.ALLOWED_USER_IDS:
        u = db.get_user(uid)
        name = u["name"] if u else str(uid)
        card = await _build_card(context, uid, name)
        await context.bot.send_photo(chat_id=config.GROUP_CHAT_ID, photo=InputFile(card))
