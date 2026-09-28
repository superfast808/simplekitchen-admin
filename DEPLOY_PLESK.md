# Simple Kitchen Admin — Plesk/Docker deployment

This deployment runs the Express/Vite application and PostgreSQL 16 under Docker Compose.

- Application container port: 5000
- Host-only published port: 8093 by default
- Database is not published to the host/network
- Plesk should reverse-proxy `admin.simplekitchenprep.com` to `http://127.0.0.1:8093`

## 1. Clone

```bash
cd /opt
git clone git@github.com:superfast808/simplekitchen-admin.git
cd /opt/simplekitchen-admin
```

If the repository already exists:

```bash
cd /opt/simplekitchen-admin
git pull --ff-only origin main
```

## 2. Production environment

```bash
cp .env.example .env
chmod 600 .env

printf 'POSTGRES_PASSWORD='
openssl rand -hex 32
printf 'SESSION_SECRET='
openssl rand -hex 32

nano .env
```

Put the generated values into `.env`, then add the WooCommerce, SMTP and webhook secrets required by this installation.

If the restored database already contains portal users, leave `BOOTSTRAP_ADMIN_USERNAME` and `BOOTSTRAP_ADMIN_PASSWORD` blank.

## 3. Start PostgreSQL only

```bash
docker compose up -d db
docker compose ps
```

Wait until the database reports healthy.

## 4. Locate the Replit dump currently uploaded through Plesk

The dump should only remain in the domain directory long enough to restore it.

```bash
DUMP="$(find /var/www/vhosts -type f -name admin-db.dump -path '*admin.simplekitchenprep.com*' -print -quit)"
printf 'Dump: %s\n' "$DUMP"
test -n "$DUMP" && test -f "$DUMP"
```

Inspect the custom-format dump using the PostgreSQL container:

```bash
cat "$DUMP" | docker compose exec -T db sh -lc 'pg_restore --list - | head -40'
```

## 5. Restore the database

This replaces the empty Docker database. Do this before starting the application.

```bash
docker compose exec -T db sh -lc '
  dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"
  createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
'

cat "$DUMP" | docker compose exec -T db sh -lc '
  pg_restore     -U "$POSTGRES_USER"     -d "$POSTGRES_DB"     --no-owner     --no-privileges     --exit-on-error
'
```

Quick database check:

```bash
docker compose exec -T db sh -lc '
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "\dt"
'
```

## 6. Remove the dump from the web directory

Once the restore is confirmed:

```bash
install -d -m 700 /opt/backups/simplekitchen-admin
mv "$DUMP" /opt/backups/simplekitchen-admin/admin-db-$(date +%Y%m%d-%H%M%S).dump
chmod 600 /opt/backups/simplekitchen-admin/*.dump
```

Do not leave PostgreSQL dumps in a web-accessible vhost directory.

## 7. Build and start the application

```bash
cd /opt/simplekitchen-admin
docker compose up -d --build app
docker compose ps
docker compose logs --tail=100 app
```

Local test:

```bash
curl -I http://127.0.0.1:8093/
```

## 8. Plesk proxy

Point the HTTPS vhost for `admin.simplekitchenprep.com` at:

```text
http://127.0.0.1:8093
```

Keep SSL termination in Plesk. The Express application trusts one proxy hop so HTTPS-aware session cookies work correctly.

## Normal updates

```bash
cd /opt/simplekitchen-admin
git pull --ff-only origin main
docker compose up -d --build
docker compose ps
```

## Back up the Docker PostgreSQL database

Example custom-format backup:

```bash
install -d -m 700 /opt/backups/simplekitchen-admin

docker compose exec -T db sh -lc '
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges
' > "/opt/backups/simplekitchen-admin/admin-db-$(date +%Y%m%d-%H%M%S).dump"

chmod 600 /opt/backups/simplekitchen-admin/*.dump
```
