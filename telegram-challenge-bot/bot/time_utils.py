from datetime import datetime, date, timedelta
from zoneinfo import ZoneInfo

from . import config

TZ = ZoneInfo(config.TIMEZONE)


def now_toronto() -> datetime:
    return datetime.now(TZ)


def today_toronto() -> date:
    return now_toronto().date()


def start_date() -> date:
    return date.fromisoformat(config.START_DATE)


def day_number_for(d: date) -> int:
    return (d - start_date()).days + 1


def today_day_number() -> int:
    return day_number_for(today_toronto())


def date_for_day(day_number: int) -> date:
    return start_date() + timedelta(days=day_number - 1)


def month_index(day_number: int) -> int:
    """Which 30-day month of the challenge a day falls in (1-3)."""
    return max(1, min((day_number - 1) // 30 + 1, 3))


def week_index(day_number: int) -> int:
    """Which 7-day week of the challenge a day falls in (1-13)."""
    return max(1, min((day_number - 1) // 7 + 1, 13))
