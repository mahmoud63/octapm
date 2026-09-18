# OctaPM Mobile User Guide

The OctaPM field app puts the project in your hand on site: what needs you, today's log, the drawings, the checklists, the stock and the approvals, all on the same records your office sees on the web. Anything you do here shows on the web at once, and anything done on the web shows here.

This guide is for everyone who uses the app. Your role decides what you see; the [role quick guides](OCTAPM_MOBILE_ROLE_QUICK_GUIDES.md) give each role its one page.

## 1. Getting in

**Sign in.** Open the app and enter your work email and password, the same ones as on the web. If your company uses single sign-on, choose **Sign in with company SSO**; it opens the web sign-in and returns you to the app. **Forgot password** opens the web as well.

**Unlock with your face or fingerprint.** In **More**, turn on **Unlock with biometrics**. From then on, coming back to the app asks for your face or fingerprint instead of your password. Your password is never stored on the phone.

**Staying signed in.** The app keeps you signed in for as long as the web would. If your session is ended (by you elsewhere, by an administrator, or because it expired), the app returns to the sign-in screen and tells you why. Anything you had captured while offline is kept for when you sign in again as the same person.

**Sign out.** More → **Sign out**. This ends the session on the server too, and removes this device from your push notifications.

## 2. Finding your way

Five destinations along the bottom on a phone, along the left on a tablet:

| Destination | What it is |
|---|---|
| **Home** | Your control centre: the project you are on, what needs you, today's items, the project's health, your latest notifications, and the quick actions your role has |
| **Projects** | Every project you belong to; tap one to switch |
| **Needs You** | Everything waiting on you, with the ball-in-court and overdue counts |
| **Search** | Find any record by reference or word, on this project or all of them |
| **More** | Your account, biometrics, the outbox, this build, sign out |

**The project strip.** Every screen shows the project you are on at the top. Tap it to switch. Switching drops the previous project's data from the screen so you never act on the wrong site.

**Back.** Back always returns to where you came from. A record opened from a notification or a link has its own list underneath, so back lands somewhere sensible.

**Records the app has no screen for** open on the web platform at the exact record, in your browser, where the web signs you in itself. The app tells you when it hands over.

## 3. Home

- **Needs You**: the top three items waiting on you and **See all**.
- **Today**: overdue, due today, and ball-in-court items.
- **Project health**: the overall score and its seven dimensions. A note says when a figure is pending review.
- **Notifications**: the unread count and the latest three; tap to open the inbox.
- **Quick actions**: only the ones your role can use, each a short form with the project, you and today's date already filled in: raise an RFI, add a punch item, start an inspection, take a site photo, raise a change event.
- **Outbox**: shows only when something is waiting to be sent (section 12).
- **Offline bar**: a bar across the top says when you are offline and what the app is showing you.

## 4. Needs You, Search and Notifications

**Needs You** lists every assignment, review and approval waiting on you, with chips for **Ball in court**, **Overdue** and by record type. Tap a row to open the record and act; when the server moves it on, it leaves the list.

**Search** takes two characters and a short pause. Switch between **This project** and **All projects**; narrow by record type. Tap a hit to open it.

**Notifications** shows **Unread** and **All**. Opening one marks it read and opens its record; long-press to archive; **Mark all read** at the top. **Preferences** at the bottom lets you switch each category on or off for in-app and push.

## 5. RFIs

**RFIs** lists the project's RFIs with chips for **My court**, **Overdue**, **Status** and a search box, all applied by the server. Tap a row for the record: the question, the official answer, the response thread, the people, the place, the activity, impacts, attachments, discussion and history.

**What you can do** depends on the RFI's state and on your role: submit a draft, add a response, answer officially (holders of the answer right), approve and close, reject, reopen, convert to a change. A button appears only when both the state and your role allow it.

**Raise an RFI** from Home's quick action or the list's **New RFI**: the project and the manager are filled in; pick the people, the location and the activity from searchable lists; save as draft or open it. Raising an RFI needs a signal; it is not queued.

## 6. Tasks, documents and drawings

**Tasks** shows the tasks assigned to you on this project first; switch to **All I can see** and across projects. A task takes comments, **Start**, **Blocked** and **Mark done**.

**Documents** is the register by folder with search; a file opens in your device's viewer.

**Drawings** lists the sheets by discipline, with **Favourites**, **Recent** and obsolete ones marked. A sheet opens fitted to width; pinch to zoom, drag to pan. If the sheet has a newer revision, the app says so before anything else. From a sheet you can **Raise an RFI** about it, and **Keep offline** to have it in airplane mode; when a kept sheet is superseded, the register says **Newer revision** and the viewer offers **Keep the latest revision**.

## 7. Site: daily log, activities, photos, timesheets

**Daily log** shows the day: date arrows, status, totals, weather, summary, and six sections you add entries to (manpower, equipment, work done, deliveries, visitors, notes). **Copy yesterday** copies the structure, not the figures. **Submit the day** when it is complete. A manpower entry needs its trade. An entry captured offline says so on the screen and goes to the outbox.

**Activities** lists today's work, yours, the critical ones, milestones, delayed and all. An activity shows its approved progress and any pending update, float, dates, how progress is measured, the submissions, attachments, and **Update progress** by the method the activity uses (percent, quantity, milestone, checklist). A hold point warns you before an update that needs an inspection. **Raise RFI** and the **Lookahead board** are one tap away. On a tablet, the **Timeline** chip draws a bar per activity with today marked, and managers approve or reject submitted updates there.

**Photos** is the gallery with tags and search. **Take photo** or **Choose photo** → **Mark up photo** if you want to circle or arrow something (section 11) → caption → the photo goes onto today's daily log. Photos taken offline wait in the outbox behind the note that starts the day's log.

**Timesheets** lists the last two weeks; open one for its entries and **Submit**; **New timesheet** starts one for a crew.

## 8. Quality

**Quality home** shows the quality score and what drives it, with doors to the modules your role may read.

**Inspections**: the list by mine, overdue, status, type and search. **New inspection** picks a template. A checklist has items by section (pass/fail, yes/no, options, number, text), a note per item, photos per answered item, hold points and **signature** items. **Save answers** sends them in one request. From a failed item, **Raise punch item** creates one linked to the inspection. **Complete** when every required answer, photo and signature is there; managers close, reopen or void.

**Signing.** On a signature item, tap **Sign**, check your name, sign in the box with a finger, stylus or mouse, and **Sign**. The signature is stored as an image with your name and the role the item names.

**Punch list**: punch items, observations or both, mine, overdue, status. An item shows photos, discussion and history and the actions its state allows: open, ready for review, close, reopen, dispute, resolve, void. **New punch item** starts with the photo (mark it up if useful), then the title, the responsible party, the location and the due date. Punch items are queued when offline.

**NCRs** and **Safety incidents**: lists by mine, overdue, status and severity; a record shows the disposition, the responsible party, evidence and history. **Submit closeout** takes a comment, a due date and evidence photos; quality approves or rejects. **Raise NCR** and **Report an incident** are the forms.

**Material tests**: pending first; open one to **Record result** (pass/fail, value, date, lab); **Schedule a test** for a new one.

## 9. Inventory

**Inventory home** remembers the warehouse this device works from and shows the server's tiles, with doors to **Scan**, **Items**, **Goods in**, **Transfers** and **Movements**.

**Scan** opens the camera on a phone or tablet; type the code anywhere. The item shows its stock by warehouse.

**Items**: find an item, filter to low stock, open it for balances, locations and recent movements, and **Move stock**: issue to an activity, return, reserve or release, receive, adjust, damage, quarantine, release. Each movement is a sheet sent once, and refused without a signal: stock is never queued.

**Goods in**: the orders awaiting delivery; open one for the lines still due and **Receive delivery**: correct the quantities from the delivery note, choose the bin, add the note number, **Post**. The receipt number is made on the device, so posting again after a lost reply counts once. A receipt captured offline waits in the outbox.

**Transfers**: by status; **New transfer** picks from, to, items and quantities; **Dispatch**, then **Receive** line by line with received and damaged quantities.

**Movements**: the ledger by warehouse and type, or for one item.

## 10. Commercial, approvals and procurement

**Approvals** (from Home) is your inbox of workflow steps waiting on you, on this project or all. Open a step to see the record and every step so far, and answer with the choices the template allows; a negative answer asks for a comment. The server moves the change order, commitment or pay application; the app never approves on its own.

**Commercial home** shows approvals waiting, change-event totals and the doors your role has. **Change events**: list by status, kind and search; **Raise change event** takes what changed, the kind, origin, activity, place, a rough order of magnitude and days; pricing, quotes and conversion follow on the web. **Change orders**, **Commitments** and **Pay applications** are read here with their money, schedule of values and who holds them; a party submits its pay application for review; decisions stay on the web or in Approvals.

**Procurement**: the overview with counts and lead-time alerts you can **Acknowledge**; **Packages** with dates, activity and alerts; **Purchase orders** by status with lines and deliveries, and **Receive delivery** hands over to Inventory; **Long lead** is the register.

## 11. Marking up a photo

After taking or choosing a photo, tap **Mark up photo**. Pick a pen colour (red, yellow, white, black), draw over the photo with a finger, a stylus or the mouse, **Undo** the last stroke or **Clear**, then **Use marked photo**. The button then reads **Marked up · edit**. The marked copy, at the photo's own size, is what gets uploaded; the original stays on your device untouched. Available on site photos and on new punch items.

## 12. Working offline

**What you see.** When the signal goes, a bar across the top says **Offline · showing what was saved on this device**, and every list's freshness line says how old what it shows is. Screens you have opened before still open from the copy kept on the device.

**What you can capture.** Raising a punch item, starting an inspection, adding a daily-log entry, starting a timesheet, posting a goods receipt and taking photos onto the daily log all work offline: the item goes to the **outbox** with a replay key, the form says so, and you carry on. Anything that must be sent once and cannot be retried safely (a stock movement, an approval, a new RFI, NCR, task or change event) waits for a signal and tells you.

**When the signal returns.** The bar says **Sending n items…**, the outbox sends oldest first, photos after the record they belong to, and each item turns **Sent**. The same happens when you bring the app to the front. Nothing is sent twice: every queued item carries a key the server recognises.

**When the server refuses one.** The bar turns red: **1 item needs your attention**. Open the outbox: the server's reason is under the item, with **Try again** and **Discard**. Nothing is dropped quietly.

**If you are signed out.** The queue is kept and locked; signing in again as the same person sends it. A different person signing in on the device discards it.

**Kept sheets.** Drawings you keep offline stay on the device; a superseded one is flagged and can be replaced with the latest.

## 13. Tablet and iPad

The same five destinations along a rail on the left. Lists stay on the left with their filters while the record opens on the right; back returns the right side to **Choose a record on the left**; rotating keeps you on the same record. The activities **Timeline**, approving or rejecting a submitted progress update, and the full-size signature pad are wide-screen work.

## 14. Notifications on your phone and links

**Push.** The first time you sign in on a device, the app asks to send notifications. Allow it, and assignments, mentions, due items and approvals arrive as notifications; tap one to open the record. Turn categories on or off in Notifications → Preferences; turn the whole thing off in your phone's settings. Signing out removes the device from your notifications.

**Links.** A link from an email or the web, or an `octapm://` link, opens the record in the app, switching to its project first if needed. A link the app has no screen for lands on Home.

**Live updates.** When someone else changes a record you have open, or adds to a list you are looking at, the screen refreshes on its own. You never need to pull to refresh to see the office's changes, though pulling still works.

## 15. When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| "Your session has ended" on the sign-in screen | The session expired or was ended elsewhere | Sign in again; anything captured offline is kept for you |
| "You don't have access to this" | Your role does not hold that right on this project | Ask the project manager; the web shows the same |
| A red bar: "1 item needs your attention" | The server refused a queued item | Open the outbox, read the reason, Try again or Discard |
| "Waits for a signal" on a form | That record cannot be queued safely | Send it when you have a signal |
| "Newer revision" on a kept sheet | The drawing was superseded | Open it and Keep the latest revision |
| A record opens on the web instead of in the app | The app has no screen for it yet | Use the web page that opened |
| Camera or photo access refused | The phone's permission is off | Turn it on in the phone's Settings for OctaPM |
| The freshness line says "Offline · 2 h ago" | You are offline and seeing the last copy | Act if the form allows queuing; otherwise wait for a signal |

Your request id: when you report a problem, the error text carries a short request id; give it to support and they can find the request on the server.
