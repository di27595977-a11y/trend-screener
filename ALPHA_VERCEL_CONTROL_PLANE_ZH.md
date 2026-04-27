# Alpha 雲端控制台部署說明

這份是給你把策略控制台做成可上線版本用的。

## 這次改完後的架構

現在不是：

- Vercel 直接改你本機的 `Alpha-engine`

而是改成：

1. `trend-screener` 前端部署到 Vercel
2. 策略控制台把策略 spec 存到 Supabase
3. `Alpha-engine` 在你本機或 VPS 上，自己去 Supabase 拉最新策略
4. `Alpha-engine` 重新產生 `signal_config_candidate.yaml`
5. `Alpha-engine` 再跑 paper trading

也就是：

- Vercel 負責操作畫面
- Supabase 負責控制面資料
- Alpha-engine 負責真正交易

## 你要先做什麼

### 1. 在 Supabase 建控制台資料表

如果你是新專案：

- 直接跑 [supabase/schema.sql](C:/Users/di275/Desktop/專案/trend-screener/supabase/schema.sql:1)

如果你原本的 Supabase 已經在用了：

- 只要再跑 [supabase/alpha_strategy_console.sql](C:/Users/di275/Desktop/專案/trend-screener/supabase/alpha_strategy_console.sql:1)

### 2. 部署 Supabase Edge Function

目前策略控制台的雲端模式會走：

- [supabase/functions/trend-api/index.ts](C:/Users/di275/Desktop/專案/trend-screener/supabase/functions/trend-api/index.ts:1)

所以這支 function 要一起部署。

### 3. 在 Vercel 設前端環境變數

至少要有：

```dotenv
VITE_SUPABASE_URL=你的 Supabase URL
VITE_SUPABASE_ANON_KEY=你的 Supabase anon key
```

如果你是讓前端只走 Supabase Edge Function，不走本機 Express API：

- `VITE_API_TARGET` 可以不填

## Alpha-engine 端怎麼接

### 1. 開啟遠端策略同步

在 `Alpha-engine` 的 `.env` 加上：

```dotenv
ALPHA_REMOTE_STRATEGY_SYNC_ENABLED=true
SUPABASE_URL=你的 Supabase URL
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service role key
```

### 2. 啟動 Alpha-engine

```powershell
Set-Location C:\Users\di275\Desktop\專案\Alpha-engine
.\venv\Scripts\Activate.ps1
python main.py --skip iteration,report
```

現在 `Alpha-engine` 啟動時會：

1. 從 Supabase 抓遠端策略 spec
2. 寫回本機 `strategy_specs`
3. 重新產生 `signal_config_candidate.yaml`
4. 用新的 candidate 策略啟動 paper trading

## 你在網頁上的實際流程

### 在 `/strategy`

1. 開啟策略控制台
2. 修改策略 spec
3. 按「儲存並套用到 Alpha-engine」

如果現在是雲端模式：

- 這個動作會先把策略寫進 Supabase
- 再建立一筆 apply job
- 之後等 `Alpha-engine` 做遠端同步

## 這次跟以前最大的差別

以前：

- 控制台只能碰本機檔案
- 所以不能真正上 Vercel

現在：

- 控制台可以走 Supabase
- 所以前端可以上 Vercel
- 本機或 VPS 的 `Alpha-engine` 只要會連 Supabase 就能同步策略

## 你要注意的事

- Vercel 前端不會直接操作你本機硬碟
- 真正的 `Alpha-engine` 還是要在本機或 VPS 跑
- 如果你按了套用，但 `Alpha-engine` 沒同步，策略不會自己生效
- 最穩的做法是讓 `Alpha-engine` 每次啟動先同步一次

## 你現在最推薦的上線型態

### 前端

- `trend-screener` 部署到 Vercel

### 控制面

- Supabase

### 交易核心

- `Alpha-engine` 跑在你自己的 Windows 主機或 VPS

這樣最符合你現在的系統分工，也最不容易壞。 
