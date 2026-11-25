"""Best-effort parsing of a photo caption into entry fields, so a user can log
everything in one message instead of the guided /log flow. Anything not
confidently parsed is left for the guided follow-up to ask about."""

import re

_MONEY_LINE_RE = re.compile(r"\$\s?\d")
_MONEY_AMOUNT_RE = re.compile(r"\$?\s?(\d[\d,]*\.?\d*)")
_QUOTE_RE = re.compile(r'["“](.+?)["”]')


def parse_caption(caption: str) -> dict:
    result = {}
    if not caption:
        return result

    lines = [l.strip() for l in caption.splitlines() if l.strip()]
    leftover = []

    for line in lines:
        quote_match = _QUOTE_RE.search(line)
        if quote_match and "verse" not in result:
            result["verse"] = quote_match.group(1).strip()
            rest = line[quote_match.end():].strip(" -–—")
            if rest:
                result["verse_note"] = rest
            continue

        if _MONEY_LINE_RE.search(line) and "amount" not in result:
            amt_match = _MONEY_AMOUNT_RE.search(line)
            if amt_match:
                try:
                    result["amount"] = float(amt_match.group(1).replace(",", ""))
                except ValueError:
                    pass
                rest = line[amt_match.end():].strip(" -–—")
                if rest:
                    result["action"] = rest
            continue

        leftover.append(line)

    if leftover and "physique_note" not in result:
        result["physique_note"] = leftover[0]

    return result
