"""Five well-known swing strategies + Sean Trades, same universe, $5,000 start, 5 slots x 20% each."""
import warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
import bt
from bt import O, H, L, C, V, stocks, dates, E8, E21, E50, VOL50, RS

SLIP, CAP, SLOTS, START = 0.0005, 5000.0, 5, "2015-01-01"
LOG = []

def rsi(c, n):
    d = c.diff(); up = d.clip(lower=0).ewm(alpha=1/n, adjust=False).mean(); dn = (-d.clip(upper=0)).ewm(alpha=1/n, adjust=False).mean()
    return 100 - 100 / (1 + up / dn)

S = lambda df: df[stocks].to_numpy(float)
SMA200, SMA20, SMA5, SD20 = C.rolling(200).mean(), C.rolling(20).mean(), C.rolling(5).mean(), C.rolling(20).std()
TR = pd.concat([(H - L), (H - C.shift()).abs(), (L - C.shift()).abs()]).groupby(level=0).max()
ATR = TR.rolling(20).mean()
liq = (C > 5) & (VOL50 > 5e5)
o, h, l, c = S(O), S(H), S(L), S(C)
sma200, sma20, sma5, e21, e50 = S(SMA200), S(SMA20), S(SMA5), S(E21), S(E50)
rsi2 = S(rsi(C, 2)); atr = S(ATR)
d20h, d10l = S(H.rolling(20).max().shift(1)), S(L.rolling(10).min().shift(1))
low5 = S(L.rolling(5).min())
mom = S(C.shift(21) / C.shift(252) - 1)
spy_ok = (C["SPY"] > SMA200["SPY"]).to_numpy()
LIQ = S(liq.astype(float)) > 0
rs = RS.to_numpy(float)

# --- entry signals (evaluated on day i) ---
SIG = {
    "rsi2":  LIQ & (c > sma200) & (rsi2 < 10),                                  # buy close
    "boll":  LIQ & (c > sma200) & (c < sma20 - 2 * S(SD20)),                     # buy close
    "pull":  LIQ & (c > e50) & (e50 > sma200) & (l <= e21) & (c > e21) & (rs >= 0.7),  # buy close
}
don = np.zeros_like(c, bool); don[1:] = (LIQ & (c > sma200))[:-1]
SIG["donch"] = don & (h > d20h)                                                  # buy-stop at 20-day high


def simulate(kind, start=START, end=None):
    i0 = dates.searchsorted(pd.Timestamp(start)); i1 = len(dates) if end is None else dates.searchsorted(pd.Timestamp(end))
    cash, pos, trades, curve = CAP, [], [], []

    def sell(p, px, i):
        nonlocal cash
        px *= 1 - SLIP; cash += p["sh"] * px
        trades.append(p["pnl"] + p["sh"] * (px - p["entry"]))
        LOG.append((kind, stocks[p["j"]], dates[p["i0"]].date(), dates[i].date(), px / p["entry"] - 1, trades[-1])); p["sh"] = 0

    def part(p, frac, px):
        nonlocal cash
        n = p["sh"] * frac; px *= 1 - SLIP; cash += n * px; p["pnl"] += n * (px - p["entry"]); p["sh"] -= n

    eq = lambda i: cash + sum(p["sh"] * np.nan_to_num(c[i, p["j"]], nan=p["entry"]) for p in pos)

    for i in range(i0, i1):
        # ---------- exits ----------
        for p in pos:
            j = p["j"]
            if np.isnan(c[i, j]) or p["i0"] == i: continue
            age = i - p["i0"]
            if p["stop"] is not None and l[i, j] <= p["stop"]:
                sell(p, min(o[i, j], p["stop"]), i); continue
            if kind == "rsi2" and (c[i, j] > sma5[i, j] or age >= 10): sell(p, c[i, j], i)
            elif kind == "boll" and (c[i, j] > sma20[i, j] or age >= 15): sell(p, c[i, j], i)
            elif kind == "donch":
                if l[i, j] <= d10l[i, j]: sell(p, min(o[i, j], d10l[i, j]), i)
            elif kind == "pull":
                if not p["t1"] and h[i, j] >= p["T"]:
                    part(p, 0.5, max(o[i, j], p["T"])); p["t1"] = True; p["stop"] = p["entry"]
                if c[i, j] < (e21 if p["t1"] else e50)[i, j] or age >= 60: sell(p, c[i, j], i)
        pos = [p for p in pos if p["sh"] > 0]

        # ---------- momentum rotation: monthly ----------
        if kind == "mom":
            if i == i0 or dates[i].month != dates[i - 1].month:
                ok = LIQ[i] & (c[i] > sma200[i]) & ~np.isnan(mom[i])
                top = [] if not spy_ok[i] else list(np.argsort(-np.where(ok, mom[i], -np.inf))[:SLOTS])
                for p in pos:
                    if p["j"] not in top: sell(p, c[i, p["j"]], i)
                pos = [p for p in pos if p["sh"] > 0]
                held = {p["j"] for p in pos}; e = eq(i)
                for j in top:
                    if j in held: continue
                    amt = min(e / SLOTS, cash)
                    if amt < 50: break
                    px = c[i, j] * (1 + SLIP); cash -= amt
                    pos.append(dict(j=j, i0=i, entry=px, sh=amt / px, stop=None, pnl=0.0))
            curve.append(eq(i)); continue

        # ---------- entries ----------
        if len(pos) < SLOTS:
            held = {p["j"] for p in pos}; e = eq(i)
            js = np.flatnonzero(SIG[kind][i])
            score = {"rsi2": -rsi2[i, js], "boll": (sma20[i, js] - c[i, js]) / c[i, js],
                     "pull": rs[i, js], "donch": mom[i, js]}[kind]
            for j in js[np.argsort(-np.nan_to_num(score, nan=-9))]:
                if len(pos) >= SLOTS: break
                if j in held: continue
                if kind == "donch":
                    if o[i, j] > d20h[i, j] * 1.02: continue
                    px = max(o[i, j], d20h[i, j]); stop = px - 2 * atr[i - 1, j]
                elif kind == "pull":
                    px = c[i, j]; stop = min(low5[i, j], px * 0.98)
                else:
                    px, stop = c[i, j], None
                amt = min(e / SLOTS, cash)
                if amt < 50: break
                px *= 1 + SLIP; cash -= amt
                p = dict(j=j, i0=i, entry=px, sh=amt / px, stop=stop, pnl=0.0, t1=False)
                if kind == "pull": p["T"] = px + 2 * (px - stop)
                pos.append(p); held.add(j)
        curve.append(eq(i))
    for p in pos: sell(p, np.nan_to_num(c[i1 - 1, p["j"]], nan=p["entry"]), i1 - 1)
    return np.array(trades), pd.Series(curve, index=dates[i0:i1])


def sean(exit_mode, start=START, end=None):
    t, e = bt.run(exit_mode=exit_mode, risk=1.0, max_pos=SLOTS, start=start, end=end)   # risk=1 -> the 20% cap sets size
    return t.usd.to_numpy(), e / e.iloc[0] * CAP


def summary(tr, eq):
    yrs = (eq.index[-1] - eq.index[0]).days / 365.25
    yr = eq.resample("YE").last().pct_change().fillna(eq.resample("YE").last().iloc[0] / CAP - 1)
    w, lo = tr[tr > 0], tr[tr <= 0]
    return {"final $": f"{eq.iloc[-1]:,.0f}", "CAGR": f"{(eq.iloc[-1]/CAP)**(1/yrs)-1:.1%}",
            "max drop": f"{(eq/eq.cummax()-1).min():.0%}", "worst yr": f"{yr.min():.0%}",
            "losing yrs": int((yr < 0).sum()), "trades": len(tr), "win %": f"{len(w)/len(tr):.0%}",
            "profit factor": round(w.sum() / -lo.sum(), 2)}


if __name__ == "__main__":
    pd.set_option("display.width", 220)
    runs = {
        "1 RSI(2) mean reversion (Connors)": lambda **k: simulate("rsi2", **k),
        "2 Bollinger Band bounce": lambda **k: simulate("boll", **k),
        "3 Donchian 20-day breakout (Turtle)": lambda **k: simulate("donch", **k),
        "4 Momentum rotation, top 5 monthly": lambda **k: simulate("mom", **k),
        "5 Pullback to 21 EMA in uptrend": lambda **k: simulate("pull", **k),
        "6 Sean Trades breakout (video exits)": lambda **k: sean("video", **k),
        "6b Sean breakout (half 2R + 21 EMA)": lambda **k: sean("hyb21", **k),
    }
    rows, halves, curves = {}, {}, {}
    for name, f in runs.items():
        tr, eq = f(); rows[name] = summary(tr, eq); curves[name] = eq
        a = f(end="2021-01-01")[1]; b = f(start="2021-01-01")[1]
        halves[name] = {"2015-20 CAGR": summary(np.array([1, -1]), a)["CAGR"], "2021-26 CAGR": summary(np.array([1, -1]), b)["CAGR"]}
    for sym in ["SPY", "QQQ"]:
        s = C[sym].loc[START:]; eq = s / s.iloc[0] * CAP
        rows[f"Buy & hold {sym}"] = {**summary(np.array([1, -1]), eq), "trades": "-", "win %": "-", "profit factor": "-"}
        a = C[sym].loc[START:"2021-01-01"]; b = C[sym].loc["2021-01-01":]
        halves[f"Buy & hold {sym}"] = {"2015-20 CAGR": summary(np.array([1, -1]), a / a.iloc[0] * CAP)["CAGR"],
                                       "2021-26 CAGR": summary(np.array([1, -1]), b / b.iloc[0] * CAP)["CAGR"]}
        curves[f"Buy & hold {sym}"] = eq
    out = pd.DataFrame(rows).T.join(pd.DataFrame(halves).T)
    print(f"Start $5,000 on {dates[dates.searchsorted(pd.Timestamp(START))].date()}, end {dates[-1].date()}\n")
    print(out.to_string())
    pd.DataFrame(curves).resample("ME").last().to_csv("curves_monthly.csv")
    yearly = pd.DataFrame({k: v.resample("YE").last() for k, v in curves.items()})
    yearly = yearly.pct_change().fillna(yearly.iloc[0] / CAP - 1)
    print("\nReturn by year:"); print((yearly * 100).round(0).T.to_string())
