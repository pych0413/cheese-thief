# 🧀 Cheese Thief

手機開房嘅桌遊小工具 — **秘密骰仔** + **私人角色牌**，唔使註冊、唔使裝 app、唔使開 server。
一條 link 派出去，幾部手機㩒同一組骰仔房號就玩得。

> 冇實體桌遊喺手都照玩。骰仔冚住，㩒住先睇到；角色牌逐個人私下派。

---

## 佢做到啲乜

| | |
|---|---|
| 🏠 **開房／入房** | 房號係 **4 粒骰**（每粒 1–6，例如 ⚀⚄⚁⚄）。入房唔使打字 — 下面一行六粒骰㩒落去就得。仲有 QR code 同 share link。 |
| 🎲 **秘密骰仔** | 每個人有自己一個倒轉骰盅。㩒住先掀起，一放手即刻冚返。1–5 粒骰，d4 / d6 / d8 / d10 / d12 / d20。 |
| 🔒 **鎖定** | 角色牌鎖咗第二個人點㩒都掀唔開；骰盅鎖咗係鎖死個點數 — 自己照睇得，但唔可以重搖，要主持先解得。 |
| 🃏 **私人角色牌** | 每個人淨係收到自己張牌 — 其他人張牌**根本唔會傳到你部機**。 |
| ⚙️ **自訂角色** | 人數 2–16，角色可以改名、改 emoji、加減數量。內置 Cheese Thief / 狼人殺 / 臥底 範本。 |
| 🔓 **主持控制** | 重新派牌、下一回合、全體搖骰、開晒骰、開晒角色。 |
| 🔁 **斷線重連** | 房主 refresh 咗、部機瞓著咗，房間同角色都保留返，朋友自動重連。 |

---

## 點玩

1. 五個人開同一條 link。
2. 一個人㩒 **創建房間** → 揀人數（例如 5）、調角色 → **開房**。
3. 其餘四個㩒 **加入房間**，照住房主部機顯示嘅四粒骰㩒返出嚟（或者直接掃 QR code）。
4. 房主等夠人 → **開始遊戲**。
5. 每個人㩒住骰盅睇點數、㩒住張牌睇身份。**放手即刻冚返**。
6. 搖完㩒 **🔓 鎖定點數** 定案；睇完角色㩒 **🔓 鎖定角色牌** 免得畀人亂㩒。
7. 玩完 → 房主㩒 **開晒角色**，或者 **下一回合** 重新派牌。

### 兩個鎖唔同嘢

| | 鎖咗之後 | 邊個解 |
|---|---|---|
| **角色牌** 🔒 | **掀唔開** — 畀人搶部機亂㩒都睇唔到 | 自己（再㩒一次） |
| **骰盅** 🔒 | **點數定死** — 自己照樣㩒住睇得，但搖唔到新骰 | **淨係主持**，喺主持控制㩒「🔓 解鎖骰盅」 |

骰盅嗰個唔係遮住你對眼，係封住個重搖掣：大家搖完各自鎖定，就冇人可以偷偷搖多次搵個靚啲嘅數。
鎖咗個骰盅會喺個盅右上角出個細細嘅 🔒，角色牌鎖咗就成張暗晒加個大鎖。
派新牌或者重新搖骰會自動解鎖（新嘢梗係要畀你睇）。

---

## 角色配置點計

角色列表入面有**一個「自動填充」角色**（預設係「村民」）。你淨係要指定特殊角色嘅數量，剩低幾多人就自動全部當村民 —
5 人局：小偷 ×1 + 偵探 ×1 → 自動 3 個村民。改成 8 人局？自動變 6 個村民，唔使你逐次改。

想每個角色都手動指定，喺「剩低嘅人數自動當」揀「（唔自動填充）」，咁總數就要啱返人數先開得。

---

## ⚠️ 要知嘅兩件事

**1. 房主部手機就係 server。**
冇後端、冇資料庫 — 全部靠 WebRTC 直連，房主部機做中心點。所以：

- 房主玩緊唔好熄屏 / 唔好切走個 browser（app 會自動叫 screen wake lock，但係唔好靠曬佢）。
- 房主真係斷咗，返去首頁㩒 **↩︎ 返去 XXXX** 就恢復到同一個房號同角色，其他人會自動駁返。

**2. 房主技術上可以偷睇。**
派牌嘅運算喺房主部機行，所以開 devtools 係睇得晒全場角色嘅。其他玩家之間就真係睇唔到 —
每張牌只會經自己嗰條 DataChannel 送出，其他人部機由頭到尾都收唔到。

要絕對公平：開房嗰陣熄咗 **「房主都要玩」**，房主淨係做主持（法官），唔攞牌。

---

## 自己部署

純靜態網站，零 build step。

### GitHub Pages

```bash
git clone https://github.com/<你>/cheese-thief.git
cd cheese-thief
# push 完去 Settings → Pages → Source: Deploy from a branch → main / (root)
```

幾分鐘後就開到 `https://<你>.github.io/cheese-thief/`。

**改完 `styles.css` 或者 `js/` 記住行呢句先 push：**

```bash
./tools/bump-version.sh
```

GitHub Pages 硬性 `Cache-Control: max-age=600` 而且改唔到。冇版本號嘅話，10 分鐘內開過個網嘅人
會攞到**新嘅 index.html 配舊嘅 css/js** — 畫面會半爛。個 script 會喺所有 asset URL 同
module import 補返個 `?v=`，等成個 module graph 一齊換版本。

### 本地跑

ES modules 開唔到 `file://`，要行個 static server：

```bash
python -m http.server 5178
```

然後開 `http://localhost:5178`。同一部機開兩個 tab 可以試，但兩個 tab 共用 localStorage，記住改唔同名。

---

## 技術細節

| | |
|---|---|
| **Stack** | Vanilla ES modules，冇 framework、冇 build、冇 npm install |
| **傳輸** | WebRTC DataChannel（PeerJS 1.5），star topology，房主做 hub |
| **Signalling** | PeerJS 公共雲，唔使 API key。房號 = 房主個 peer id（`cheesethief-v1-<CODE>`） |
| **NAT** | Google + Twilio STUN，再加 openrelay TURN 做後備（手機數據網要用到） |
| **隨機數** | `crypto.getRandomValues` + rejection sampling，Fisher-Yates 洗牌 — 冇 `Math.random()` 嘅 modulo bias |
| **持久化** | localStorage 存房間 snapshot 同玩家 token，8 鐘頭內恢復得返 |
| **版面** | 全部用 `rem`，root font-size = `clamp(13px, 4.1vw, 19px)`。成個 UI 跟住部機大細等比例縮放，唔係 reflow — 320px 同 430px 部機上面每件嘢佔螢幕嘅百分比一模一樣，去到平板就封頂 30rem 置中 |

```
index.html          全部 screen（home / join / create / lobby / game）
tools/bump-version.sh  撞穿 GitHub Pages 10 分鐘快取用
styles.css          mobile-first 深色主題
js/util.js          crypto 隨機、DOM helper、wake lock、safe localStorage
js/roles.js         角色範本 + 牌堆生成
js/net.js           PeerJS 傳輸層（HostNet / ClientNet，含重連）
js/game.js          房間狀態機（房主專用）— 秘密都收喺呢度
js/app.js           畫面、互動、host/client 接線
```

### 房號會唔會撞

4 粒骰 = 6⁴ = **1296** 個組合。撞咗嘅話開房會自動換過一個（最多試 14 次），你唔會察覺。
換言之全世界同一時間最多開 1296 個房 — 同班friend玩綽綽有餘，真係要做大先至要加返位數。

### 鎖定擋到啲乜

擋到「畀人搶部機亂㩒」同「自己手多㩒錯」。擋唔到部機主人自己開 devtools —
呢個同上面房主嗰段係同一個道理：所有本機保護都係本機保護。

---

## License

MIT
