# Deploying pax-planner on Oracle Cloud "Always Free"

> **Status:** live and verified at **https://paxdei.erech.fi** (Oracle Always-Free
> ARM VM, `129.151.221.127`). End-to-end checks below — TLS, create/share,
> concurrent additive progress, reboot persistence, and systemd auto-restart — all
> pass. This file is the runbook to reproduce or update that deployment.

Host pax-planner for a small group (≤20 daily users) for **$0/month** on an
Oracle Cloud Infrastructure (OCI) Always-Free VM. The app keeps shared lists in a
SQLite file on local disk, so a plain VM with a persistent boot volume runs it
unchanged — no managed database, no code rewrite.

```
Internet ──(443/80)──> Caddy (auto-TLS) ──(127.0.0.1:8787)──> npm start
                          on the VM                            Hono + dist/ + /api
                                                                    │
                                                  /opt/pax-planner/data/data.sqlite
```

The only public listener is Caddy; the Node app stays on loopback. systemd keeps
it always-on. Files referenced below live in this `deploy/` directory:
[`pax-planner.service`](pax-planner.service) and [`Caddyfile`](Caddyfile).

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
  applies. The one unauthenticated, DB-growing endpoint is `POST /api/lists`; fine
  for a known ≤20-person group. If abuse appears, add a shared-secret env gate.
- Enable `unattended-upgrades` for OS patches.

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
