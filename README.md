# 🧀 Cheese Thief

手機開房嘅桌遊小工具 — **秘密骰仔** + **私人角色牌**，唔使註冊、唔使裝 app、唔使開 server。
一條 link 派出去，幾部手機入同一個 4 位房號就玩得。

> 冇實體桌遊喺手都照玩。骰仔冚住，㩒住先睇到；角色牌逐個人私下派。

---

## 佢做到啲乜

| | |
|---|---|
| 🏠 **開房／入房** | 房主開房攞一個 4 位數字母房號（例如 `TKTU`），其他人入同一個房號就同枱。仲有 QR code 同 share link。 |
| 🎲 **秘密骰仔** | 每個人有自己嘅骰盅。㩒住先掀起，一放手即刻冚返。1–5 粒骰，d4 / d6 / d8 / d10 / d12 / d20。 |
| 🃏 **私人角色牌** | 每個人淨係收到自己張牌 — 其他人張牌**根本唔會傳到你部機**。 |
| ⚙️ **自訂角色** | 人數 2–16，角色可以改名、改 emoji、加減數量。內置 Cheese Thief / 狼人殺 / 臥底 範本。 |
| 🔓 **主持控制** | 重新派牌、下一回合、全體搖骰、開晒骰、開晒角色。 |
| 🔁 **斷線重連** | 房主 refresh 咗、部機瞓著咗，房間同角色都保留返，朋友自動重連。 |

---

## 點玩

1. 五個人開同一條 link。
2. 一個人㩒 **創建房間** → 揀人數（例如 5）、調角色 → **開房**。
3. 其餘四個㩒 **加入房間**，入房號（或者直接掃 QR code）。
4. 房主等夠人 → **開始遊戲**。
5. 每個人㩒住自己張牌睇身份，㩒住骰盅睇點數。
6. 玩完 → 房主㩒 **開晒角色**，或者 **下一回合** 重新派牌。

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

```
index.html          全部 screen（home / join / create / lobby / game）
styles.css          mobile-first 深色主題
js/util.js          crypto 隨機、DOM helper、wake lock、safe localStorage
js/roles.js         角色範本 + 牌堆生成
js/net.js           PeerJS 傳輸層（HostNet / ClientNet，含重連）
js/game.js          房間狀態機（房主專用）— 秘密都收喺呢度
js/app.js           畫面、互動、host/client 接線
```

### 房號會唔會撞

4 位、31 個字母（去咗 `0O1IL`）＝ 924k 個組合。撞咗嘅話開房會自動換一個，唔使理。

---

## License

MIT
