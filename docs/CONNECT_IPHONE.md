# Connect Your iPhone & Apple Watch

This guide connects your workout app to Apple Health so your weight syncs
automatically every day, and your gym sessions show up in Apple Health (and
count toward your rings). No coding needed — just follow the taps.

Throughout this guide:

- **`YOUR-APP.vercel.app`** means your app's web address (the one you open in
  Safari to log workouts). Replace it everywhere you see it.
- **`YOUR_TOKEN`** means the secret token you create in step 1. It's like a
  house key for your data — keep it private and don't share screenshots of it.

---

## a) One-time server setup (do this first, once)

### 1. Create your secret token

You need one long random string. Pick either way:

- **Easy way:** open [passwordsgenerator.net](https://passwordsgenerator.net)
  or any password generator, and generate a random string of **at least 40
  characters** using only letters and numbers (no symbols — they can break
  web addresses).
- **Mac Terminal way:** open the Terminal app and run:

  ```
  openssl rand -hex 32
  ```

  It prints a 64-character string. That's your token.

Copy it somewhere safe (Notes app is fine for now — you'll paste it into your
phone in the next sections).

### 2. Add the token to Vercel

1. Go to [vercel.com](https://vercel.com) and log in.
2. Click your **workout app project**.
3. Click **Settings** (top menu) → **Environment Variables** (left menu).
4. In the **Key** field type exactly: `HEALTH_SYNC_TOKEN`
5. In the **Value** field paste your token.
6. Leave all environments checked, then click **Save**.

### 3. Redeploy so the token takes effect

1. Still in Vercel, click the **Deployments** tab.
2. On the newest deployment, click the **⋯** (three dots) menu → **Redeploy**
   → confirm **Redeploy**.
3. Wait until it shows **Ready** (usually 1–2 minutes).

### 4. Run the "Apply schema" action on GitHub

This prepares the database for health data. Only needed once.

1. Go to your app's repository on [github.com](https://github.com).
2. Click the **Actions** tab (top of the page).
3. In the left sidebar, click **Apply schema**.
4. On the right, click the **Run workflow** button → click the green
   **Run workflow** confirm button.
5. Wait for the green checkmark (about a minute). Done — you never need to
   touch this again unless the app tells you to.

### 5. Quick test (optional but recommended)

On your iPhone, open Safari and go to:

```
https://YOUR-APP.vercel.app/api/health/status?token=YOUR_TOKEN
```

If you see a page of text with things like `lastSampleByType`, everything is
wired up. If you see `Invalid or missing sync token`, re-check steps 1–3.

---

## b) Weight auto-sync (scale → app, every day)

Your smart scale (or manual entries) writes weight into Apple Health. This
section pushes that weight to your app daily, so your fat-loss chart updates
itself.

Pick **one** of the two options.

### Option 1 — RECOMMENDED: Health Auto Export app (~$5, most reliable)

1. On your iPhone, open the **App Store** and install **Health Auto Export —
   JSON+CSV** (one-time purchase, around $5).
2. Open the app and allow it to read Health data when asked. Make sure
   **Body Mass**, **Heart Rate**, and **Active Energy** are allowed
   (if you missed the prompt: iPhone **Settings → Privacy & Security →
   Health → Health Auto Export** and switch them on).
3. In Health Auto Export, tap the **Automations** tab at the bottom.
4. Tap **+** (or **Add Automation**) to create a new automation.
5. Set the automation type to **REST API**.
6. Fill in the fields:
   - **URL:**

     ```
     https://YOUR-APP.vercel.app/api/health/import?token=YOUR_TOKEN
     ```

     (paste your real app address and real token — no spaces).
   - **Export Format:** `JSON`
   - **Aggregate Data:** leave ON if you want tidier data (either works).
7. Under **Health Metrics** (Data to export), select exactly these three:
   - **Body Mass** (this is your weight)
   - **Heart Rate**
   - **Active Energy**
8. Set the **schedule / sync interval** to **Daily**.
9. Tap **Save** (or **Done**), then tap the automation and use
   **Export Now / Run** once to test it. It should report success
   (status 200).
10. Open your app's Stats page — your latest scale weight should appear
    within a minute.

That's it. Every day the app receives your weight, plus heart-rate and
calorie data that automatically enriches your logged gym sessions.

> Note: a weight you typed into the app by hand always wins — the sync will
> never overwrite a manual entry for that day.

### Option 2 — FREE: iOS Shortcuts automation

Same result, no purchase, slightly more fragile (see Troubleshooting).

**Build the shortcut first:**

1. Open the **Shortcuts** app on your iPhone.
2. Tap the **Shortcuts** tab → **+** to create a new shortcut.
3. Tap the name at the top and rename it **Send Weight**.
4. Tap **Add Action**, search for **Find Health Samples**, and add it.
   Configure it:
   - **Type:** `Weight` (Body Mass)
   - Tap **Add Filter** if you like, but the important part: set
     **Sort by: Start Date**, **Order: Latest First**, **Limit: ON**,
     **Get: 1 sample** — so it grabs your most recent weigh-in.
5. Tap **Add Action** again, search for **Get Contents of URL**, and add it.
   Configure it (tap the small arrow ▸ to expand):
   - **URL:**

     ```
     https://YOUR-APP.vercel.app/api/health/import
     ```

   - **Method:** `POST`
   - **Headers:** tap **Add new header**:
     - Key: `Authorization`
     - Value: `Bearer YOUR_TOKEN`  (the word "Bearer", a space, then your
       token)
   - **Request Body:** `JSON`, then add these fields:
     - Text field — Key: `type` Value: `weight`
     - Number field — Key: `value` Value: tap the field →
       **Select Variable** → choose **Health Sample** (the magic variable
       from step 4)
     - Text field — Key: `unit` Value: `kg`
6. Tap **Done**. Run it once by tapping it — the first run asks permission to
   access Health data and to contact your app's address. Allow both.

**Then make it run daily:**

1. In Shortcuts, tap the **Automation** tab at the bottom.
2. Tap **+** (New Automation) → **Time of Day**.
3. Pick a time after you usually weigh in (e.g. **9:00 AM**), **Daily**.
4. Important: select **Run Immediately** (not "Run After Confirmation") so it
   works silently without asking you every morning.
5. Tap **Next**, choose your **Send Weight** shortcut, tap **Done**.

---

## c) Send your gym workouts to Apple Health

This makes your logged sessions appear in the Apple Health / Fitness apps as
real workouts. You'll build one shortcut called **Log Gym Workout** and run it
after training (or automate it).

**Build the shortcut:**

1. Open **Shortcuts** → **+** new shortcut → rename it **Log Gym Workout**.
2. **Action 1 — fetch the workouts that haven't been synced yet.**
   Add **Get Contents of URL**:
   - **URL:**

     ```
     https://YOUR-APP.vercel.app/api/health/workouts?token=YOUR_TOKEN
     ```

   - **Method:** `GET`

   This returns a list; each item has `id`, `name`, `start`, `durationMin`,
   and `estKcal` (estimated calories).
3. **Action 2 — loop over them.** Add **Repeat with Each**. Set its input to
   the **Contents of URL** from Action 1.
4. **Action 3 — inside the repeat, log each one to Health.**
   Add **Log Workout** (inside the Repeat block). Configure:
   - **Activity Type:** `Traditional Strength Training`
   - **Start Time:** tap the field → **Select Variable** → **Repeat Item** →
     tap it again and choose **Get Value for `start`** (Get Dictionary
     Value: key `start`).
   - **End Time / Duration:** use the item's `durationMin` — either set
     **Duration** to Get Dictionary Value `durationMin` (minutes), or
     compute End = start + durationMin if your iOS version asks for an end
     time.
   - **Calories:** Get Dictionary Value `estKcal` from Repeat Item.
5. **Action 4 — after the Repeat block, tell the app they're synced** so they
   don't get logged twice. Add another **Get Contents of URL** (make sure it
   sits *after* / outside the Repeat block):
   - **URL:** `https://YOUR-APP.vercel.app/api/health/workouts`
   - **Method:** `POST`
   - **Headers:** `Authorization` : `Bearer YOUR_TOKEN`
   - **Request Body:** `JSON` → add a field of type **Array** with key
     `ids`, and fill it with each item's `id` from the fetched list.
     (Simplest reliable way: inside the Repeat block, add
     **Get Dictionary Value** for key `id` and then **Add to Variable** →
     variable name `SyncedIds`; then in this final action use the
     `SyncedIds` variable as the `ids` array.)
6. Tap **Done**. Run it once after your next session — allow Health write
   access when asked. Your workout appears in the Fitness app.

**When to run it:** tap it after each gym session, or attach it to a daily
Time-of-Day automation (same steps as the end of Option 2 above, e.g. 9 PM
daily, **Run Immediately**). Running it when there's nothing new is harmless —
the list will simply be empty.

---

## d) Apple Watch during workouts

Nothing to build here — just a habit:

1. Wear your Apple Watch at the gym.
2. When you start training, open the **Workout** app on the watch and start a
   **Traditional Strength Training** workout. End it when you finish.

The watch records your heart rate and active calories into Apple Health.
Then, via the daily weight sync in section (b) (which also sends Heart Rate
and Active Energy), the app automatically attaches **average HR, max HR, and
calories burned** to the gym session you logged that day. You don't have to
do anything — logged workouts just get richer.

---

## e) Troubleshooting

**"401" or "Invalid or missing sync token"**
The token the phone is sending doesn't match the one in Vercel. Check for:
extra spaces, a missing character from copy-paste, `Bearer` missing before
the token in a header, or you changed the token in Vercel but not on the
phone. Fix the token in the automation/shortcut so both sides match exactly,
and remember Vercel needs a **Redeploy** after changing an environment
variable.

**"500" or "HEALTH_SYNC_TOKEN is not configured on the server"**
You skipped (or misspelled) step a-2, or didn't redeploy after saving it.

**"Last sync" looks stale**
Open `https://YOUR-APP.vercel.app/api/health/status?token=YOUR_TOKEN` in
Safari. It shows the newest sample date for each data type
(`lastSampleByType`). If the newest **weight** date is days old, the daily
automation has stopped firing — open Health Auto Export (or Shortcuts) and
run it manually once, then check its schedule is still on. If a manual run
works but the schedule doesn't, see the next item. Note: "stale" can also
just mean you haven't stepped on the scale — the sync can only send what
Apple Health has.

**Shortcuts silently stop after an iOS update**
This is a known iOS quirk: after a software update, personal automations can
be paused or lose their Health permissions without telling you. After every
iOS update, open **Shortcuts → Automation**, confirm your automations are
still enabled and set to **Run Immediately**, and run each shortcut once by
hand — if a permission prompt appears, allow it, and the daily runs resume.

**Weight synced but doesn't show in the app**
If you manually logged a weight in the app that same day, the manual entry
wins on purpose. The synced value is still stored, it just won't overwrite
your manual one.

**Workout logged twice in Apple Health**
The final POST step of the **Log Gym Workout** shortcut (section c, action 4)
didn't run — usually because it was placed inside the Repeat block or the
token header is wrong there. Fix that step; already-synced workouts won't be
returned again once it succeeds. Delete the duplicate inside the Apple
Health app (Browse → Activity → Workouts → swipe left on the duplicate).
