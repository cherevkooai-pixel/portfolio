import io, os, pickle, ssl, urllib.request, certifi
import pandas as pd, yfinance as yf
ctx = ssl.create_default_context(cafile=certifi.where())
def table(url, col):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    html = urllib.request.urlopen(req, context=ctx).read().decode()
    for t in pd.read_html(io.StringIO(html)):
        if col in t.columns: return t[col].tolist()
spx = table("https://en.wikipedia.org/wiki/List_of_S%26P_500_companies", "Symbol")
ndx = table("https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies", "Ticker") or table("https://en.wikipedia.org/wiki/List_of_NASDAQ-100_companies", "Symbol") or []
mid = table("https://en.wikipedia.org/wiki/List_of_S%26P_400_companies", "Symbol") or []
print(len(spx), len(ndx), len(mid))
tickers = sorted({t.replace(".", "-") for t in spx + ndx + mid})
print(len(tickers), "stocks")
data = yf.download(tickers + ["QQQ", "SPY"], start="2014-01-01", auto_adjust=True, progress=False, threads=True, group_by="ticker")
pickle.dump(data, open("prices.pkl", "wb"))
print(data.shape, data.index[0].date(), data.index[-1].date())
