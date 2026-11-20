# Site Monitor Starter

Get a Telegram message when your website goes down, and another when it comes back.

It checks your site from the outside, the same way a visitor would, so it works
with any website you own or manage. No libraries, no build step, about 150 lines
of Node.

By the end you'll have:
- Your own Telegram bot that messages you.
- A monitor that checks your site every 15 minutes.
- It running **in the cloud** (recommended) or **on your computer**.

No prior experience needed. Setup takes about 20 to 30 minutes.

---

## What it checks

Every run, it looks at three things:
1. **Is the site up?** It should answer with a normal `200 OK`.
2. **Is the real page there?** A word you expect (like "Example Domain") is in the page.
3. **Is the HTTPS lock healthy?** It warns you before the security certificate expires.

It only messages you when the status **changes**: one "🔴 DOWN" message, then
quiet until it's fixed, then one "✅ RECOVERED". No spam.

---

## What an alert looks like

When the site goes down:

```
🔴 DOWN: https://example.com
page loaded but "Example Domain" was missing
2026-01-15T03:14:07.512Z
```

Other reasons you might see on the second line: `HTTP 503`, or
`could not reach site: timed out`.

When it's back:

```
✅ RECOVERED: https://example.com is back up.
2026-01-15T03:29:08.201Z
```

And if your HTTPS certificate is close to expiring (at most once a day):

```
Heads up on https://example.com:
⚠️ HTTPS certificate expires in 6 day(s). Renew it soon.
```

---

## Try it in 30 seconds (no Telegram needed)

If no bot token is set, the monitor prints alerts to your terminal instead of
sending them. You need Node.js 18 or newer.

```bash
MONITOR_URL=https://example.com MONITOR_KEYWORD="Example Domain" node monitor.mjs
```

You'll see `Dry run: ...` and `no change (status=up)`. Use a keyword that isn't
on the page and you'll see the DOWN alert printed.

---

## Step 1: Create your Telegram bot (5 min)

1. Open Telegram and message **@BotFather**.
2. Send `/newbot`, pick a name and a username ending in `bot`.
3. BotFather gives you a **token** like `123456789:AAE...`. Copy it. This is your
   `TELEGRAM_BOT_TOKEN`. Treat it like a password.
4. Message **@userinfobot**. It replies with your **numeric id** (e.g. `123456789`).
   That's your `TELEGRAM_CHAT_IDS`.
5. Open a chat with *your* new bot and send it any message (say "hi"). A bot
   can't message you until you've messaged it first.

> Want a teammate or a shared chat to get the alerts too? Put both ids in
> `TELEGRAM_CHAT_IDS`, comma-separated: `yourId,otherId`.

---

## Step 2: Pick your route

| | **Route A: Cloud (recommended)** | **Route B: Your computer** |
|---|---|---|
| Runs on | GitHub's computers | Your own laptop or desktop |
| Keeps running when your laptop is **off or asleep**? | ✅ Yes | ❌ No |
| Cost | Free | Free |
| Setup | Add secrets in GitHub, done | Install Node, set up a scheduler |
| Good for | Real monitoring | Learning and testing |

A monitor is only useful if it's watching when you're not. Your site can go down
at 3am while your laptop is closed. Route A keeps watching because GitHub runs it
on a timer. Route B runs the exact same code, but only while your computer is on
and awake. Use A for real monitoring and B to learn or test. You can start with B
to see it work, then switch to A.

---

## Route A: Cloud (GitHub Actions)

1. **Fork this repo** to your own GitHub account (top-right "Fork" button).
2. In your fork, go to **Settings → Secrets and variables → Actions →
   New repository secret**, and add these four secrets:
   - `TELEGRAM_BOT_TOKEN`: your BotFather token
   - `TELEGRAM_CHAT_IDS`: your numeric id (comma-separate for more)
   - `MONITOR_URL`: the site to watch, e.g. `https://example.com`
   - `MONITOR_KEYWORD`: a word that should be on the page, e.g. `Example Domain`
3. Go to the **Actions** tab and enable workflows (GitHub asks once on a fork).
4. Open the **site-monitor** workflow and click **Run workflow** to test it now.
   Then break the keyword on purpose (set `MONITOR_KEYWORD` to something not on
   your page) and run it again. You should get a 🔴 DOWN message. Set it back and
   run again for the ✅ RECOVERED.

That's it. From now on it runs itself every 15 minutes, laptop off or not.

Good to know:
- The schedule is `*/15 * * * *` in `.github/workflows/monitor.yml`. GitHub's free
  timer is best-effort and can lag a few minutes. Fine for this.
- GitHub pauses scheduled workflows on repos with no activity for 60 days. If the
  alerts stop, open the Actions tab and re-enable the workflow.
- The last status is kept between runs in the Actions cache (`state.json`). If the
  cache is ever cleared, the monitor just starts fresh.

---

## Route B: Your own computer

Same code, but it only checks while your computer is on and awake.

1. Install **Node.js 18 or newer** from https://nodejs.org (get the "LTS").
2. Download this repo (green **Code** button, then **Download ZIP**, or `git clone`).
3. In the project folder, copy `.env.example` to `.env` and fill in your values.
4. Test it once:
   ```bash
   node monitor.mjs
   ```
   You should see `no change (status=up)` or an alert. To force an alert, set a
   wrong `MONITOR_KEYWORD` in `.env` and run again.
5. **Make it run automatically.**

   **Mac / Linux**: run every 15 minutes with cron:
   ```bash
   crontab -e
   # add this line (use the full path to the project folder):
   */15 * * * * cd /full/path/to/site-monitor-starter && /usr/local/bin/node monitor.mjs >> monitor.log 2>&1
   ```
   (`which node` tells you the path to use in place of `/usr/local/bin/node`.)

   **Windows**: use Task Scheduler. Create a Basic Task, trigger "Daily", repeat
   every 15 minutes, action "Start a program", program `node`, arguments
   `monitor.mjs`, "Start in" set to the project folder.

If the computer sleeps or shuts off, monitoring pauses until it's back.

You can also use `config.json` instead of `.env` (copy `config.example.json`).
Environment variables win over `config.json`.

---

## Testing tip (both routes)

The easiest safe way to see a real alert: temporarily set `MONITOR_KEYWORD` to a
word that's **not** on your homepage (like `zzztest`). The site is still up, but
the monitor won't find the word, so it reports DOWN and messages you. Set it back
and the next run sends RECOVERED. This proves the whole chain works without
taking your site offline.

---

## How it works

- `monitor.mjs` is the checker. It reads your settings, checks the site, remembers
  the last status in `state.json`, and messages Telegram only when the status flips.
- `.github/workflows/monitor.yml` is the cloud timer (Route A).
- Your secrets live in GitHub Actions Secrets (Route A) or a local `.env`
  (Route B), never in the code. `.gitignore` keeps `.env`, `config.json`, and
  `state.json` out of git.

Open `monitor.mjs` and read it. It's meant to be understood. Change the checks,
add more sites, make it yours.

## License

MIT. See [LICENSE](LICENSE).
