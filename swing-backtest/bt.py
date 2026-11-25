"""Daily-bar backtest of the Sean Trades momentum swing strategy.

Approximations (daily data only):
- Breakout: buy-stop at the 10-day base high. Gap opens above the pivot are skipped.
  Stop = low of day. OHLC path rule: green day = open->low->high->close (low came before
  entry, stop = day low); red day = open->high->low->close (pre-entry low ~ open, so the
  trade is stopped at the open the same day).
- Undercut & rally (UNR): day undercuts the prior 10-day base low and closes back above it;
  buy at the close, stop = that day's low.
- 30-minute pivot: not testable on daily bars.
"""
import pickle, sys
import numpy as np, pandas as pd

SLIP = 0.0005          # per side
START = "2015-01-01"

d = pickle.load(open("prices.pkl", "rb"))
O, H, L, C, V = (d.xs(f, axis=1, level=1) for f in ["Open", "High", "Low", "Close", "Volume"])
stocks = [c for c in C.columns if c not in ("QQQ", "SPY")]
ema = lambda x, n: x.ewm(span=n, adjust=False, min_periods=n).mean()
E8, E21, E50 = ema(C, 8), ema(C, 21), ema(C, 50)
ADR = (H / L - 1).rolling(20).mean()
VOL50 = V.rolling(50).mean()
RS = (C / C.shift(63) - 1)[stocks].rank(axis=1, pct=True)
BH, BL = H.rolling(10).max(), L.rolling(10).min()
DEPTH = (BH - BL) / BH

trend = (C > 3) & (VOL50 > 5e5) & (ADR > 0.02) & (E21 > E50) & (E50 > E50.shift(10)) & (RS >= 0.8)
tight = (DEPTH <= np.minimum(2.5 * ADR, 0.15)) & (V.rolling(10).mean() < VOL50) & (BL > E50)
setup = (trend & tight & (C > E21))[stocks]
# breakout on day i from a setup on day i-1
BO = setup.shift(1, fill_value=False) & (O < BH.shift(1)) & (H > BH.shift(1))
# UNR on day i: base from days i-10..i-1, undercut its low, close back above
blp, bhp = BL.shift(1), BH.shift(1)
UNR = (trend.shift(1, fill_value=False) & tight.shift(1, fill_value=False))[stocks] & (L < blp) & (C > blp) & (C > O)

q = "QQQ"
strong = (C[q] > E21[q]) & (E21[q] > E50[q]) & (E21[q] > E21[q].shift(5))
down = (C[q] < E50[q]) & (E50[q] < E50[q].shift(5))
REG = pd.Series(np.where(strong, 2, np.where(down, 0, 1)), index=C.index)  # 2 strong, 1 chop, 0 down

A = lambda df: df[stocks].to_numpy(float)
o_, h_, l_, c_ = A(O), A(H), A(L), A(C)
e8, e21, e50, adr, rs = A(E8), A(E21), A(E50), A(ADR), RS.to_numpy(float)
bh1, bl1, bo, unr = A(BH.shift(1)), A(BL.shift(1)), BO[stocks].fillna(False).to_numpy(bool), UNR[stocks].fillna(False).to_numpy(bool)
reg = REG.to_numpy()
dates = C.index


def run(exit_mode="video", entries=("bo",), regime_filter=True, risk=0.005, max_pos=10, start=START, end=None, red="open"):
    i0 = dates.searchsorted(pd.Timestamp(start))
    i1 = len(dates) if end is None else dates.searchsorted(pd.Timestamp(end))
    cash, pos, trades, curve = 100_000.0, [], [], []

    def sell(p, n, px, i):
        nonlocal cash
        n = min(n, p["sh"])
        if n <= 0: return
        px *= 1 - SLIP
        cash += n * px
        p["pnl"] += n * (px - p["entry"])
        p["sh"] -= n
        if p["sh"] <= 1e-9:
            trades.append(dict(tk=stocks[p["j"]], d0=dates[p["i0"]], d1=dates[i], kind=p["kind"],
                               reg=p["reg"], R=p["pnl"] / (p["risk"] * p["sh0"]), days=i - p["i0"], usd=p["pnl"], riskusd=p["risk"] * p["sh0"]))

    def manage(p, i, entry_day=False):
        j = p["j"]; o, h, l, c = o_[i, j], h_[i, j], l_[i, j], c_[i, j]
        if np.isnan(c): return
        if not entry_day and l <= p["stop"]:
            return sell(p, p["sh"], min(o, p["stop"]), i)
        R, sh0 = p["risk"], p["sh0"]
        if exit_mode == "video":
            f1 = 0.3 if p["reg"] == 2 else 0.5
            if not p["t1"] and h >= p["T1"]:
                sell(p, round(f1 * sh0), max(o, p["T1"]) if not entry_day else p["T1"], i); p["t1"] = True
            ext = e8[i, j] * (1 + 3 * adr[i, j])
            if p["ext"] < 2 and h >= ext and p["sh"] > 0:
                sell(p, round(0.2 * sh0), max(o, ext), i); p["ext"] += 1
            if p["sh"] <= 0: return
            if c < e50[i, j]: return sell(p, p["sh"], c, i)
            if p["t1"]:
                if p["reg"] == 2:
                    if c < e21[i, j] and not p["s21"]: sell(p, p["sh"] / 2, c, i); p["s21"] = p["s8"] = True
                    elif c < e8[i, j] and not p["s8"]: sell(p, p["sh"] / 2, c, i); p["s8"] = True
                elif c < e8[i, j]: sell(p, p["sh"], c, i)
        elif exit_mode.startswith("R"):               # fixed target, e.g. R3
            k = float(exit_mode[1:]); T = p["entry"] + k * R
            if h >= T: return sell(p, p["sh"], max(o, T) if not entry_day else T, i)
            if i - p["i0"] >= 60: sell(p, p["sh"], c, i)
        elif exit_mode.startswith("hyb"):             # half at 2R, stop to break-even, trail rest on EMA
            n = int(exit_mode[3:]); trail = {8: e8, 21: e21, 50: e50}[n]
            T = p["entry"] + 2 * R
            if not p["t1"] and h >= T:
                sell(p, sh0 / 2, max(o, T) if not entry_day else T, i); p["t1"] = True; p["stop"] = p["entry"]
            if p["sh"] > 0 and c < trail[i, j]: sell(p, p["sh"], c, i)

    for i in range(i0, i1):
        for p in [p for p in pos if p["i0"] < i]: manage(p, i)
        pos = [p for p in pos if p["sh"] > 1e-9]
        r = reg[i - 1]
        if regime_filter and r == 0: r = None
        if r is not None and len(pos) < max_pos:
            held = {p["j"] for p in pos}
            equity = cash + sum(p["sh"] * np.nan_to_num(c_[i - 1, p["j"]], nan=p["entry"]) for p in pos)
            cands = []
            if "bo" in entries: cands += [(rs[i - 1, j], j, "bo") for j in np.flatnonzero(bo[i])]
            if "unr" in entries: cands += [(rs[i - 1, j], j, "unr") for j in np.flatnonzero(unr[i])]
            for _, j, kind in sorted(cands, reverse=True):
                if len(pos) >= max_pos or j in held: continue
                if kind == "bo":
                    entry = bh1[i, j] * (1 + SLIP)
                    green = c_[i, j] >= o_[i, j]
                    green = green or red == "low"
                    stop = l_[i, j] if green else o_[i, j]
                    T1 = bh1[i, j] + (bh1[i, j] - bl1[i, j])
                else:
                    entry = c_[i, j] * (1 + SLIP); green = True
                    stop = l_[i, j]
                    T1 = bh1[i, j] if bh1[i, j] > entry * 1.02 else entry + 2 * (entry - stop)
                stop = min(stop, entry * 0.995)
                rk = entry - stop
                if rk / entry > 1.5 * adr[i - 1, j]: continue          # too far from low of day
                rp = risk if (r == 2 or not regime_filter) else risk / 2
                sh = min(equity * rp / rk, 0.2 * equity / entry, cash / entry)
                if sh * entry < 1000: continue
                cash -= sh * entry
                p = dict(j=j, i0=i, entry=entry, stop=stop, risk=rk, sh=sh, sh0=sh, T1=T1, pnl=0.0,
                         kind=kind, reg=r, t1=False, s8=False, s21=False, ext=0)
                held.add(j)
                if kind == "bo" and not green:
                    sell(p, sh, stop, i)                                # failed breakout, stopped same day
                    continue
                if kind == "bo": manage(p, i, entry_day=True)
                if p["sh"] > 1e-9: pos.append(p)
        curve.append(cash + sum(p["sh"] * np.nan_to_num(c_[i, p["j"]], nan=p["entry"]) for p in pos))
    for p in pos:                                                         # close open trades at the end
        last = np.nan_to_num(c_[i1 - 1, p["j"]], nan=p["entry"])
        sell(p, p["sh"], last, i1 - 1)
    return pd.DataFrame(trades), pd.Series(curve, index=dates[i0:i1])


def stats(t, eq):
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    dd = (eq / eq.cummax() - 1).min()
    w, lo = t[t.R > 0], t[t.R <= 0]
    return dict(trades=len(t), win=f"{len(w)/len(t):.0%}", avgW=round(w.R.mean(), 2), avgL=round(lo.R.mean(), 2),
                expR=round(t.R.mean(), 3), PF=round(w.R.sum() / -lo.R.sum(), 2), hold=round(t.days.mean(), 1),
                CAGR=f"{(eq.iloc[-1]/eq.iloc[0])**(1/yrs)-1:.1%}", maxDD=f"{dd:.1%}")


def bench(sym=None, start=START, end=None):
    s = C.loc[start:end]
    r = s[sym].pct_change() if sym else s[stocks].pct_change().mean(axis=1)
    eq = (1 + r.fillna(0)).cumprod()
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    return dict(CAGR=f"{eq.iloc[-1]**(1/yrs)-1:.1%}", maxDD=f"{(eq/eq.cummax()-1).min():.1%}")


if __name__ == "__main__":
    pd.set_option("display.width", 200)
    rows = {}
    for name, kw in {
        "video exits, breakout, regime filter": dict(),
        "video exits, breakout, NO filter": dict(regime_filter=False),
        "video exits, UNR only": dict(entries=("unr",)),
        "video exits, breakout + UNR": dict(entries=("bo", "unr")),
        "fixed 2R": dict(exit_mode="R2"), "fixed 3R": dict(exit_mode="R3"), "fixed 5R": dict(exit_mode="R5"),
        "half at 2R + BE stop, trail 8": dict(exit_mode="hyb8"),
        "half at 2R + BE stop, trail 21": dict(exit_mode="hyb21"),
        "half at 2R + BE stop, trail 50": dict(exit_mode="hyb50"),
    }.items():
        t, eq = run(**kw); rows[name] = stats(t, eq)
    print(pd.DataFrame(rows).T.to_string())
    print("\nBenchmarks", START, "->", dates[-1].date())
    print("SPY", bench("SPY"), "| QQQ", bench("QQQ"), "| equal-weight universe", bench())
