import warnings; warnings.filterwarnings("ignore")
import numpy as np, pandas as pd
import bt
from bt import run, stats, bench
pd.set_option("display.width", 200)

def exposure(kw):
    # rough: invested fraction ~ average of (equity - cash)/equity is not tracked; recompute via trade overlap
    t, eq = run(**kw)
    days = pd.Series(0, index=eq.index)
    for r in t.itertuples():
        days.loc[r.d0:r.d1] += 1
    return t, eq, days.mean()

base = dict(exit_mode="video")
t, eq, avgpos = exposure(base)
print("video/breakout: avg open positions", round(avgpos, 2))
print("same-day stop-outs (red breakout days):", f"{(t.days==0).mean():.0%}", " expR of the rest:", round(t[t.days>0].R.mean(),3))
print("\nBy market regime at entry (2 strong, 1 choppy):")
print(t.groupby("reg").R.agg(["count", "mean", lambda r: (r>0).mean()]).round(3))
print("\nR distribution percentiles:", t.R.quantile([.1,.5,.9,.99]).round(2).to_dict(), " max", round(t.R.max(),1))
top = t.R.sort_values(ascending=False)
print("share of total R from top 5% of trades:", f"{top.head(len(t)//20).sum()/t.R.sum():.0%}")
print("\nYearly expR (video / hyb50):")
t2, _ = run(exit_mode="hyb50")
y = pd.DataFrame({"video": t.groupby(t.d0.dt.year).R.mean(), "hyb50": t2.groupby(t2.d0.dt.year).R.mean(),
                  "n": t.groupby(t.d0.dt.year).R.size()}).round(2)
print(y.T.to_string())

print("\nIn-sample 2015-2020 vs out-of-sample 2021-2026:")
rows = {}
for m in ["video", "R3", "hyb21", "hyb50"]:
    for lbl, s, e in [("15-20", "2015-01-01", "2021-01-01"), ("21-26", "2021-01-01", None)]:
        tt, ee = run(exit_mode=m, start=s, end=e); rows[f"{m} {lbl}"] = stats(tt, ee)
print(pd.DataFrame(rows).T.to_string())
print("SPY 15-20", bench("SPY", end="2021-01-01"), " SPY 21-26", bench("SPY", start="2021-01-01"))
print("EW univ 15-20", bench(end="2021-01-01"), " EW 21-26", bench(start="2021-01-01"))

print("\nRisk per trade / max positions (hyb50, breakout):")
rows = {}
for rk in [0.005, 0.01, 0.02]:
    tt, ee = run(exit_mode="hyb50", risk=rk); rows[f"risk {rk:.1%}"] = stats(tt, ee)
print(pd.DataFrame(rows).T.to_string())
