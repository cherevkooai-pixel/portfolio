# Swing backtest

A daily-bar backtest of a momentum swing strategy (10-day base breakouts and undercut-and-rally entries, low-of-day stops) on S&P 500, S&P 400 and Nasdaq-100 stocks.

- `fetch.py`: downloads ticker lists and daily prices
- `bt.py`: the backtest (slippage, entry/exit rules; see the docstring for the approximations)
- `compare.py`, `analyze.py`, `boll.py`: exit-rule comparisons and analysis

Finding: the edge is thin, and trailing exits beat fixed-R targets. Research only, not trading advice.
