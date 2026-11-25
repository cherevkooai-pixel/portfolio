"""Bollinger Band bounce: variants tested on both halves of the data. $5,000 start."""
import warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
from compare import (C, S, stocks, dates, SMA200, SMA20, SD20, ATR, LIQ, c, o, h, l, sma200, sma20, sma5, rsi2, rs, spy_ok)
import bt

SD = S(SD20); atr = S(ATR); adr = S(bt.ADR)
RNG = np.random.default_rng(0)
prev_h = np.vstack([np.full(c.shape[1], np.nan), h[:-1]])


def run(k=2.0, exit="mid", maxd=15, rank="depth", slots=5, spy=False, stop=None, adr_min=0.0, entry="close",
        trend="sma200", start="2015-01-01", end=None, slip=0.0005, cap=5000.0):
    i0 = dates.searchsorted(pd.Timestamp(start)); i1 = len(dates) if end is None else dates.searchsorted(pd.Timestamp(end))
    lower = sma20 - k * SD
    sig = LIQ & (c < lower) & (adr > adr_min)
    if trend == "sma200": sig &= c > sma200
    cash, pos, pnl, curve, pending = cap, [], [], [], []

    def sell(p, px):
        nonlocal cash
        px *= 1 - slip; cash += p["sh"] * px; pnl.append(p["sh"] * (px - p["e"])); p["sh"] = 0

    def eq(i): return cash + sum(p["sh"] * np.nan_to_num(c[i, p["j"]], nan=p["e"]) for p in pos)

    def buy(i, j, px, e):
        nonlocal cash
        amt = min(e / slots, cash)
        if amt < 50: return False
        px *= 1 + slip; cash -= amt
        pos.append(dict(j=j, i0=i, e=px, sh=amt / px,
                        st=None if stop is None else (px * (1 - stop) if stop < 1 else px - stop * atr[i, j])))
        return True

    for i in range(i0, i1):
        if pending:                                   # next-open entries from yesterday's signals
            e = eq(i - 1); held = {p["j"] for p in pos}
            for j in pending:
                if len(pos) < slots and j not in held and not np.isnan(o[i, j]): buy(i, j, o[i, j], e)
            pending = []
        for p in pos:
            j = p["j"]
            if np.isnan(c[i, j]) or p["i0"] == i: continue
            if p["st"] is not None and l[i, j] <= p["st"]: sell(p, min(o[i, j], p["st"])); continue
            tgt = {"mid": sma20[i, j], "sma5": sma5[i, j], "upper1": sma20[i, j] + SD[i, j],
                   "prevhigh": prev_h[i, j]}[exit]
            if c[i, j] > tgt or i - p["i0"] >= maxd: sell(p, c[i, j])
        pos = [p for p in pos if p["sh"] > 0]
        if len(pos) < slots and (not spy or spy_ok[i]):
            js = np.flatnonzero(sig[i]); held = {p["j"] for p in pos}
            if rank == "random": score = RNG.random(len(js))
            else: score = {"mid": (sma20[i, js] - c[i, js]) / c[i, js], "depth": (lower[i, js] - c[i, js]) / c[i, js], "rs": rs[i, js], "rsi": -rsi2[i, js],
                     "vol": adr[i, js]}[rank]
            order = [j for j in js[np.argsort(-np.nan_to_num(score, nan=-9))] if j not in held]
            if entry == "close":
                e = eq(i)
                for j in order:
                    if len(pos) >= slots or not buy(i, j, c[i, j], e): break
            else:
                pending = order[: slots - len(pos)]
        curve.append(eq(i))
    for p in pos: sell(p, np.nan_to_num(c[i1 - 1, p["j"]], nan=p["e"]))
    return np.array(pnl), pd.Series(curve, index=dates[i0:i1])


def row(**kw):
    out = {}
    for lbl, s, e in [("full", "2015-01-01", None), ("15-20", "2015-01-01", "2021-01-01"), ("21-26", "2021-01-01", None)]:
        tr, eq = run(start=s, end=e, **kw)
        yrs = (eq.index[-1] - eq.index[0]).days / 365.25
        out[f"{lbl} CAGR"] = (eq.iloc[-1] / 5000) ** (1 / yrs) - 1
        if lbl == "full":
            out["final $"] = eq.iloc[-1]; out["maxDD"] = (eq / eq.cummax() - 1).min()
            out["trades"] = len(tr); out["win"] = (tr > 0).mean(); out["PF"] = tr[tr > 0].sum() / -tr[tr <= 0].sum()
            out["avg hold"] = None
    return out


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    V = {
        "BASE  2.0 sd, exit mid, 15d, deepest first": {},
        "deeper dip 2.5 sd": dict(k=2.5),
        "shallower 1.5 sd": dict(k=1.5),
        "exit at 5-day avg (faster)": dict(exit="sma5"),
        "exit at +1 sd (slower)": dict(exit="upper1"),
        "exit on close > yesterday's high": dict(exit="prevhigh"),
        "max hold 10d": dict(maxd=10),
        "max hold 25d": dict(maxd=25),
        "rank: strongest stock (RS) first": dict(rank="rs"),
        "rank: lowest RSI(2) first": dict(rank="rsi"),
        "rank: most volatile first": dict(rank="vol"),
        "only when SPY > 200-day": dict(spy=True),
        "stop loss -8%": dict(stop=0.08),
        "stop loss 3x ATR": dict(stop=3),
        "only volatile stocks (ADR > 3%)": dict(adr_min=0.03),
        "no 200-day trend filter": dict(trend=None),
        "10 slots x 10%": dict(slots=10),
        "buy next open instead of close": dict(entry="open"),
    }
    res = pd.DataFrame({n: row(**kw) for n, kw in V.items()}).T
    fmt = res.copy()
    for col in ["full CAGR", "15-20 CAGR", "21-26 CAGR", "maxDD", "win"]: fmt[col] = res[col].map(lambda x: f"{x:.1%}")
    fmt["final $"] = res["final $"].map(lambda x: f"{x:,.0f}"); fmt["PF"] = res["PF"].map(lambda x: f"{x:.2f}")
    print(fmt.drop(columns="avg hold")[["final $", "full CAGR", "15-20 CAGR", "21-26 CAGR", "maxDD", "trades", "win", "PF"]].to_string())
