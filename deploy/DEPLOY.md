# Deploying pax-planner on Oracle Cloud "Always Free"

> **Status:** live and verified at **https://paxdei.erech.fi** (Oracle Always-Free
> `VM.Standard.E2.1.Micro`, x86, `129.151.221.127`). End-to-end checks below — TLS, create/share,
> concurrent additive progress, reboot persistence, and systemd auto-restart — all
> pass. This file is the runbook to reproduce or update that deployment.

Host pax-planner for **$0/month** on an Oracle Cloud Infrastructure (OCI)
Always-Free VM. The live deployment is a **VM.Standard.E2.1.Micro** — 1/8 OCPU
and 1 GB RAM — which carries roughly **60 concurrent open tabs**, or a community
of around 750 people at typical peak concurrency. See
[../docs/CAPACITY.md](../docs/CAPACITY.md) for the arithmetic and for the tuning
constants that depend on it.

> **Shape matters below.** Steps 1 and 4 describe the larger A1 shape and build
> on the host. On the 1 GB micro that is risky: `npm ci` deletes `node_modules`
> before reinstalling and `npm start` needs `tsx` (a devDependency), so an
> OOM-killed build leaves the service unable to start with no rollback. Ensure
> the instance has swap, or build off-host and copy `dist/` across.

The app keeps shared lists in a SQLite file on local disk, so a plain VM with a
persistent boot volume runs it unchanged — no managed database, no code rewrite.

```
Internet ──(443/80)──> Caddy (auto-TLS) ──(127.0.0.1:8787)──> npm start
                          on the VM                            Hono + dist/ + /api
                                                                    │
                                                  /opt/pax-planner/data/data.sqlite
```

The only public listener is Caddy; the Node app stays on loopback. systemd keeps
it always-on. Files referenced below live in this `deploy/` directory:
[`pax-planner.service`](pax-planner.service), [`Caddyfile`](Caddyfile) and
[`backup.sh`](backup.sh).

---

## Step 1 — Provision the instance

1. Create a free OCI account. **2026 reality:** signups are sometimes flagged for
   manual review, and a region may be "out of capacity" for Ampere A1. Pick a home
   region with A1 capacity. If A1 creation fails, retry later or use the AMD micro
   shape (`VM.Standard.E2.1.Micro`, x86, 1 OCPU/1 GB) — also Always Free, and its
   x86 better-sqlite3 prebuilt binaries are more reliable.
2. Shape **VM.Standard.A1.Flex**, 1–2 OCPU / 6–12 GB. Image **Ubuntu 22.04 or
   24.04 LTS**. Add your SSH key. Note the **public IP**.

## Step 2 — Open the firewall (BOTH layers)

OCI blocks ports in two independent places; miss either and it silently fails.

1. **OCI Security List / NSG** (console): add ingress rules — Source `0.0.0.0/0`,
   TCP, destination ports **80** and **443**. (22 is already open.)
2. **Host iptables** (Ubuntu images REJECT everything after SSH, so *insert*
   ACCEPT rules before the REJECT, then persist):
   ```bash
   sudo apt-get update && sudo apt-get install -y iptables-persistent
   sudo iptables -L INPUT --line-numbers      # find the REJECT line; insert above it
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80  -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

## Step 3 — A hostname for HTTPS

Share tokens travel in the URL, so HTTPS is required, which means a hostname (a
bare IP can't get a free trusted cert). Pick one:

- **Real-domain subdomain (recommended, current setup):** point a subdomain's DNS
  **A record** at the VM's public IP — e.g. `paxdei.erech.fi` → `129.151.221.127`.
  Add it as a plain A record at whatever is authoritative for the domain (e.g.
  cPanel **Zone Editor** — *not* the "Subdomains" tool, which would point the name
  at the cPanel host instead of the VM). The app serves at the subdomain root, so
  **no code changes** are needed. Avoid a sub*path* of an existing site
  (`domain.tld/thing`): that needs a cross-server reverse proxy plus Vite `base` /
  API-prefix changes.
- **No domain yet (free, for testing):** a `sslip.io`/`nip.io` name embedding the
  IP — `129-151-221-127.sslip.io` — gets a real Let's Encrypt cert with no signup.
  Caveat: some networks DNS-block these services, so it may not resolve everywhere;
  fine as a stopgap until a real domain is in place.

In all cases the DNS name must resolve to the VM **before** Caddy can obtain the
cert (the HTTP-01 challenge requires Let's Encrypt to reach the VM at that name).
Put the chosen hostname in the `Caddyfile` (Step 7).

## Step 4 — Install runtime + build

```bash
sudo apt-get install -y build-essential python3 git   # for better-sqlite3 if it compiles from source
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo mkdir -p /opt/pax-planner && sudo chown $USER /opt/pax-planner
git clone <your repo URL> /opt/pax-planner
cd /opt/pax-planner
npm ci            # installs devDeps too (tsx is needed by `npm start`); builds better-sqlite3
npm run fetch:icons   # downloads item icons into public/icons/ (gitignored build artifact, NOT in the repo)
npm run build     # Vite -> dist/ (copies public/icons/ -> dist/icons/)
mkdir -p /opt/pax-planner/data
```

## Step 5 — systemd service

```bash
sudo cp deploy/pax-planner.service /etc/systemd/system/pax-planner.service
sudo systemctl daemon-reload
sudo systemctl enable --now pax-planner
sudo systemctl status pax-planner          # should be active (running)
```

The unit sets `DB_PATH=/opt/pax-planner/data/data.sqlite` (honored by
`openDb()` in `server/db.ts`), `HOST=127.0.0.1`, and `PORT=8787`. If your login
user isn't `ubuntu`, edit `User=` in the unit.

## Step 6 — Caddy reverse proxy + automatic HTTPS

```bash
# Install Caddy from its official apt repo (see https://caddyserver.com/docs/install)
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
# edit the hostname in /etc/caddy/Caddyfile to match Step 3
sudo systemctl reload caddy
```

Caddy fetches and auto-renews the Let's Encrypt cert on first request. The app is
now live at `https://<your-host>`.

## Updating later

```bash
cd /opt/pax-planner && git pull && npm ci && npm run fetch:icons && npm run build && sudo systemctl restart pax-planner
```

The SQLite file in `data/` is outside the checkout, so `git pull` never touches it.
`fetch:icons` skips icons already present in `public/icons/`, so it only downloads
new ones on subsequent updates. Icons are a gitignored build artifact (regenerated
from the committed `data/dataset.json`), so this step is required on every host —
without it `dist/icons/` is empty and all item images 404.

## Security notes

- Only 22/80/443 are public; never expose the app port (8787) in the Security List.
- The exposed-API hardening (body cap + rate limits, `server/index.ts`) still
  applies. Rate limits are split by method: reads 240/min/client, writes
  120/min/client, and `POST /api/lists` — the one unauthenticated, DB-growing
  endpoint — 600/hour/client on top of that. The limiter keys on client IP, so
  everyone behind one NAT counts as a single client; see [../docs/CAPACITY.md](../docs/CAPACITY.md)
  before lowering these. If abuse appears, add a shared-secret env gate.
- **Nothing ever deletes a list.** There is no TTL or GC, and the database shares
  the boot volume with the OS, so sustained list creation is a disk-exhaustion
  path that can take the whole VM down (not just the app). Watch free space.
- Enable `unattended-upgrades` for OS patches.

## Backups (do this — it is the biggest single risk)

Every list and all progress live in one SQLite file on one boot volume. Nothing
copies it anywhere by default, and Oracle reclaims Always Free instances that look
idle — a low-traffic app on 1/8 of a core fits that profile. Losing the volume
loses everything.

[`backup.sh`](backup.sh) takes a consistent snapshot of the live database with
`sqlite3 .backup` (never `cp` — the server holds it open in WAL mode), gzips it,
and prunes old copies:

```bash
sudo apt-get install -y sqlite3
sudo cp deploy/backup.sh /usr/local/bin/pax-planner-backup
sudo chmod +x /usr/local/bin/pax-planner-backup
crontab -e   # 17 4 * * * /usr/local/bin/pax-planner-backup >> /var/log/pax-planner-backup.log 2>&1
```

**A backup on the same volume is not a backup.** Uncomment one of the off-box
copy lines at the bottom of the script (Oracle Object Storage, rsync, or rclone)
once you have somewhere to put it.

## Usage metrics

The server keeps anonymous, aggregate-only usage metrics in SQLite (see
`server/metrics.ts`): daily event counters (lists created) and a unique-visitor
count based on an HMAC-hashed client IP — no cookies, no client-side tracking,
no raw IPs stored. To read them, set a `STATS_TOKEN` in the systemd unit
(uncomment the line in `pax-planner.service`, pick a long random string, then
`sudo systemctl daemon-reload && sudo systemctl restart pax-planner`) and query:

```bash
curl -H "Authorization: Bearer <STATS_TOKEN>" https://<host>/api/stats
```

Without `STATS_TOKEN` the endpoint doesn't exist (404); collection still runs.

## Verification (run after deploy)

1. **TLS + serve:** `curl -I https://<host>` returns 200; browser shows a valid
   padlock and the SPA loads.
2. **Create + share:** create a list, open the share link in a second browser —
   both see the same list.
3. **Concurrent progress:** from two clients, fire `+gathered` on the same item at
   the same time — the total must **sum** (atomic additive delta), not overwrite.
4. **Persistence across reboot:** `sudo reboot`; after it's back, reload a share
   link — the list and progress survive.
5. **Auto-restart:** `sudo systemctl kill pax-planner`; the URL works again within
   a couple seconds (systemd `Restart=always`).

## Fallbacks

- A1 out of capacity / account declined → AMD micro shape, or **Hetzner CX23
  (~€3.49/mo)** / **Netcup VPS Lite (~€1.34/mo)** with the identical setup.
- Prefer push-to-deploy later → Northflank Sandbox (free, keep SQLite on a volume)
  or Render/Koyeb free + Turso (free hosted SQLite, needs an async DB rewrite).
