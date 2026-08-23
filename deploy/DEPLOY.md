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
Internet ──(443/80)──> Caddy (auto-TLS) ──(127.0.0.1:8787)──> node dist-server/
                          on the VM                            Hono + dist/ + /api
                                                                    │
                                                  /opt/pax-planner/data/data.sqlite

/opt/pax-planner/
  repo/                      git checkout, only a source for builds
  releases/<stamp>-<sha>/    built trees (last 5 kept)
  current -> releases/...    symlink the systemd unit runs from
  data/data.sqlite           database, outside every release
  backups/                   local snapshots (copy these off-box!)
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

## Step 4 — Install runtime + first release

The service runs from `/opt/pax-planner/current`, a symlink that
[`deploy.sh`](deploy.sh) swaps atomically. Set the layout up once:

```bash
sudo apt-get install -y build-essential python3 git curl   # better-sqlite3 may compile from source
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

sudo mkdir -p /opt/pax-planner && sudo chown $USER /opt/pax-planner
mkdir -p /opt/pax-planner/{releases,data}
git clone <your repo URL> /opt/pax-planner/repo
```

Then cut the first release:

```bash
/opt/pax-planner/repo/deploy/deploy.sh origin/main
```

The script builds into `releases/<timestamp>-<sha>/`, runs `npm ci`,
`fetch:icons`, `build` (Vite → `dist/`, esbuild → `dist-server/`), `typecheck`
and the tests, prunes devDependencies, and only then points `current` at it. On
the very first run there is no service to health-check yet — do Step 5 and
re-run.

> **1 GB is tight.** Add swap before the first build if the instance has none:
> ```bash
> sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
> sudo mkswap /swapfile && sudo swapon /swapfile
> echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
> ```

## Step 5 — systemd service

```bash
sudo cp deploy/pax-planner.service /etc/systemd/system/pax-planner.service
sudo systemctl daemon-reload
sudo systemctl enable --now pax-planner
sudo systemctl status pax-planner          # should be active (running)
```

The unit runs `node dist-server/index.js` from `WorkingDirectory=/opt/pax-planner/current`
— point it at the symlink, never at a release directory, or rollback stops
working. It sets `DB_PATH=/opt/pax-planner/data/data.sqlite` (honored by
`openDb()` in `server/db.ts`), `HOST=127.0.0.1`, `PORT=8787`, and
`LIST_TTL_DAYS=90` (retention — see Security notes). If your login user isn't
`ubuntu`, edit `User=` in the unit.

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
/opt/pax-planner/repo/deploy/deploy.sh            # deploys origin/main
/opt/pax-planner/repo/deploy/deploy.sh v1.4.0     # or a specific ref
/opt/pax-planner/repo/deploy/deploy.sh --rollback # back to the previous release
```

The deploy is atomic: a new release is built in its own directory and `current`
only moves once the build, typecheck, tests **and** a `/healthz` probe have all
passed. If the new release fails to come up, the script puts the old symlink
back and restarts — so a bad deploy is a no-op rather than an outage. Five
releases are kept for rollback.

Things it handles that the old in-place `git pull` did not:

- `npm ci` wiping `node_modules` mid-deploy can no longer break the running
  service, because the running service is a different directory.
- Icons are copied forward from the previous release before `fetch:icons` runs,
  so each deploy only downloads genuinely new ones. They are a gitignored build
  artifact regenerated from the committed `data/dataset.json`, so without this
  step `dist/icons/` would be empty and every item image would 404.
- `npm prune --omit=dev` runs after the build. Nothing on the start path comes
  from devDependencies any more — the server is compiled to `dist-server/`
  rather than run through `tsx`.

The SQLite file lives in `/opt/pax-planner/data/`, outside every release, so
deploys and rollbacks never touch it.

## Security notes

- Only 22/80/443 are public; never expose the app port (8787) in the Security List.
- The exposed-API hardening (body cap + rate limits, `server/index.ts`) still
  applies. Rate limits are split by method: reads 240/min/client, writes
  120/min/client, and `POST /api/lists` — the one unauthenticated, DB-growing
  endpoint — 600/hour/client on top of that. The limiter keys on client IP, so
  everyone behind one NAT counts as a single client; see [../docs/CAPACITY.md](../docs/CAPACITY.md)
  before lowering these. If abuse appears, add a shared-secret env gate.
- **Retention bounds database growth.** Lists with no *write* activity for
  `LIST_TTL_DAYS` (default 90) are swept daily, progress rows cascading with
  them. Without this, `POST /api/lists` was an unauthenticated disk-exhaustion
  path — and because the database shares the boot volume with the OS, filling it
  takes down sshd and journald too. Reads deliberately don't count as activity;
  see [../docs/CAPACITY.md](../docs/CAPACITY.md). If you change the env var,
  change `LIST_TTL_DAYS` in `shared/listTypes.ts` too — that is what the UI
  tells users.
- **Security headers** are set by the app (`server/securityHeaders.ts`), not by
  Caddy: a CSP is a property of the application, so it belongs next to the code
  that would break it. The app loads no third-party assets — game data is bundled
  and icons are served locally — so the policy is a strict `default-src 'self'`,
  relaxed only for inline *styles* (the recipe tooltip positions itself with a
  computed `style` attribute). `script-src` stays `'self'` with no `unsafe-*`.
  Caddy keeps HSTS, which is genuinely transport-level. Don't set the same
  headers in both places or every response carries them twice.
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

## Monitoring

Two critical failure modes used to be silent: the box going down, and the volume
filling up. Both now announce themselves.

**Uptime.** `GET /healthz` returns `ok` (200) when the process is up and the
database answers, and 503 when the database is unreachable or free space is
below the guard's floor. Point any free external pinger at
`https://<host>/healthz` — `deploy.sh` gates on the same endpoint. It is
deliberately detail-free, so it is safe to leave unauthenticated.

**Disk.** [`disk-alert.sh`](disk-alert.sh) warns at 80% and shouts at 90%,
listing the usual space hogs so you do not have to go looking:

```bash
sudo cp deploy/disk-alert.sh /usr/local/bin/pax-planner-disk-alert
sudo chmod +x /usr/local/bin/pax-planner-disk-alert
crontab -e   # */30 * * * * /usr/local/bin/pax-planner-disk-alert
journalctl -t pax-planner-disk --since '7 days ago'
```

Defence in depth, in the order it engages: the retention sweep bounds growth over
time; `server/diskGuard.ts` refuses **new list creation** (503) below 256 MB free
while leaving existing lists fully usable; this cron tells a human. Reaching an
actually-full volume is the case worth avoiding — SQLite in WAL mode can be left
corrupt, and journald and sshd fail too, so you may not be able to log in to fix
it.

## Verification (run after deploy)

1. **TLS + serve:** `curl -I https://<host>` returns 200; browser shows a valid
   padlock and the SPA loads.
2. **Health probe:** `curl https://<host>/healthz` returns `ok`. This is what
   `deploy.sh` gates on, and what an external uptime checker should watch.
3. **Compression:** `curl -sI -H 'Accept-Encoding: gzip' https://<host>/assets/<bundle>.js | grep -i content-encoding`
   shows `gzip` (or `zstd`). Without it the host ships 1.82 MB instead of ~182 KB.
4. **Rollback:** `deploy.sh --rollback` puts the previous release back and the
   site still works.
5. **Create + share:** create a list, open the share link in a second browser —
   both see the same list.
6. **Concurrent progress:** from two clients, fire `+gathered` on the same item at
   the same time — the total must **sum** (atomic additive delta), not overwrite.
7. **Persistence across reboot:** `sudo reboot`; after it's back, reload a share
   link — the list and progress survive.
8. **Auto-restart:** `sudo systemctl kill pax-planner`; the URL works again within
   a couple seconds (systemd `Restart=always`).

## Fallbacks

- A1 out of capacity / account declined → AMD micro shape, or **Hetzner CX23
  (~€3.49/mo)** / **Netcup VPS Lite (~€1.34/mo)** with the identical setup.
- Prefer push-to-deploy later → Northflank Sandbox (free, keep SQLite on a volume)
  or Render/Koyeb free + Turso (free hosted SQLite, needs an async DB rewrite).
