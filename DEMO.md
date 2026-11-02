# True POS: 10-minute meeting script

Everything on screen is generated dummy data shaped like the shops. No real sales, stock or customers are in this app.
Product names and MRPs come from the public price list; all quantities and rupee figures are made up.

## Before you start

- Run the built app, not the dev server, so the offline step works: `npm run build && npm run preview`, then open http://localhost:4173.
- The very first visit builds the dummy shop data (about 6 seconds on a laptop). After that it opens at once.
- Demo PINs: Cashier `1111`, Manager `2222`, Office `3333`, Owner `4444`. The login screen lists them under "Demo".
- Hidden demo panel: press Ctrl+Shift+D, or tap the "True POS" logo three times quickly. Press Esc or Close to hide it.
- To start over at any time: demo panel > Reset demo data.

## The script

### 1. A child bills 5 bottles (1 min)

1. On the login screen tap **Cashier 1**, then type `1111`.
2. The bill screen opens with the shop's 12 best sellers as big tiles. Tap **OC 90** five times (or any five tiles).
3. Point out: no search, no menus, one tap per bottle. The cart on the right shows `OC 90 ×5` and `TOTAL ₹275`.

### 2. Pay by cash, show the change (1 min)

1. Tap **Cash ₹275**.
2. Show the quick amounts. Tap **₹500**: the screen says "Give back ₹225" and shows the notes to hand back.
3. Tap **Done** (or **Exact** if the customer gave the exact amount). The 80 mm receipt shows for a few seconds; tap it to close.
4. Five bottles for cash takes 7 taps: 5 bottles, Cash, Exact.

### 3. Turn the wifi off and keep billing (2 min)

1. Turn the wifi off (on a laptop you can also use the browser's offline mode). The badge top-right turns to `● Offline`.
2. Reload the page. It still opens, because the app is installed in the browser.
3. Bill one bottle: tap a tile, **Cash**, **Exact**. The badge says `● Offline · 1 bill will sync`.
4. Turn the wifi on. The badge goes back to `● Online` and the bill is sent.

### 4. The manager closes the shift and the day locks (2 min)

The manager is one chain-wide admin with no shift of their own. Logging out does not end the cashier's shift, so the manager closes it.

1. Tap **Log out**, then **Manager** and `2222`. The back-office home opens: the same to-do list as Office, with a **Manager** row of quick actions (Close shift, Bills, Prices, Shops & staff) and today at a glance. The shop picker starts on the hub, TS1.
2. Tap **Close shift**. One shift is listed: **Cashier 1**.
3. Tap it, count the cash with the note buttons (the screen shows "Expected cash" and whether it matches), tap **Close**. The screen says "Shift closed" and "Day locked. Today's figures are final.", because a manager closed the last open shift of the day. Tap **Done**. A cashier's own **End shift** never locks the day.
4. Go back to the home. Today's figures now say "Closed day: locked figures".
5. Log in as **Cashier 1** and tap a bottle: instead of the pay buttons the screen says "Day closed for today. Ask your manager."
6. Open the demo panel and tap **Next day**: billing works again.

### 5. The office to-do list shows the planted problems (2 min)

1. Log out, then **Office** and `3333`. The Today list shows what needs doing, for example:
   - "TS1 delivery: 2 cases short" with a **Raise claim** button
   - "Transfer TR-PLANT-1 not received (2 days)" with **Call shop**
   - "Cor Premium 500 at −3 in TS1" with **Count it**
   - "Bud 650 at TS5 expires in 20 days" with **Move/Sell**
   - "TS4 did not close yesterday" with **Remind**
   - "4 shops low on UB Premium 650" with **Make order**
2. Stock arrived: an order to KSBCL was placed yesterday and has not been delivered. Open **Deliveries**, pick that order in "New KSBCL delivery", type an invoice number such as `SMYH26123456`, tap **Add delivery**.
3. Open **Stock arrived** (Office and Manager both have it, with a shop picker that starts on the hub) and tap **Count it**. Every line starts as "Matches"; change one line to show a short or broken bottle, then tap **Done**.
4. Transfers are received at the receiving shop: in **Stock arrived**, pick **TS8** in the shop picker and tap **Receive** on `TR-PLANT-1` (the stuck transfer). The office to-do item goes away.
5. Log in as **Manager** to show what Office does not get: **Close shift**, **Bills** (void a bill with the manager PIN), **Practice mode** for a shop, **Prices** and **Offers** (push a price, run an offer), and **Shops & staff** with **Change PIN** for each person. Office sees Products but only to read.

### 6. The owner page and the WhatsApp preview (1 min)

1. Log in as **Owner** and `4444`. Every shop is one card: takings, cash/UPI/card, cash short, low stock, closed or not closed.
2. Scroll to "WhatsApp nightly summary preview". It is the text the owner would get each night, one line per shop. Tap **Copy**. Nothing is sent anywhere in the demo.
3. Show the downloads (excise statement, stock valuation, discounts) and **Push new prices**.

### 7. Loyalty on: scan a member QR and earn points (1 min)

1. Open the demo panel and tap **Loyalty ON**.
2. Log in as the cashier. Open the demo panel, under "Simulate a scan" tap **Ravi 7K3M9QX2RA**. This acts like scanning his phone's QR. The customer line shows `R••• ··4821 · 240 points`.
3. Tap **OC 90** five times, **Cash**, **Exact**. A ₹275 bill earns 2 points.
4. Scan Ravi again: 242 points.

### 8. Loyalty off: it disappears everywhere (30 s)

1. Open the demo panel and tap **Loyalty OFF**.
2. On the bill screen the customer line and "Add customer" are gone. Scanning a member QR does nothing.
3. The only place it still shows is the read-only ON/OFF in Office > **Shops & staff**.

## Known limits

- Office > Deliveries: the **Local suppliers** and **Returns** tabs are empty in the dummy data.
- Not deployed yet: it runs on localhost only. Deploying to Cloudflare Pages comes later (see README).
- First load of the full dummy data, measured in Chromium at 1280 x 800 on a laptop (3 fresh runs): login screen ready in about 6.0 s (5.9 to 6.0 s), cashier bill screen ready about 0.4 s after the PIN (6.3 to 6.4 s from first navigation). A reload after that opens the bill screen in about 0.3 s. Tablet timings have not been measured: do that by hand.
- The "Next day" button moves the demo clock only; it does not create a new day of sales.
- Loyalty runs on a stand-in that follows the real app's rules; no customer app is connected.
- Barcode scanning is not built on Stock arrived or Count shelf; items are found by search only. (The bill screen does take scans.)
- The Kannada strings need a native-speaker pass before showing Kannada to the client.

## Manual checks before the meeting

- [ ] Print preview of an A4 report in Chrome and in Safari: page breaks fall between rows and the header row repeats on each page.
- [ ] Print preview of the 80 mm receipt (Reprint > Print): one narrow slip, nothing cut off.
- [ ] On the tablet: open the built app, install it as an app (Add to Home Screen / Install), turn the wifi off, open it again and make a bill.
