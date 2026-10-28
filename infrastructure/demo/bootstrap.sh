#!/bin/bash
set -euo pipefail
umask 077
cd /opt/relay

# Only deployment files and public release metadata are supplied in user data.
# Every secret is generated on this instance; do not enable shell tracing.
for attempt in $(seq 1 30); do
  if curl -fsSI --connect-timeout 5 --max-time 10 https://awscli.amazonaws.com/AWSCLIV2.msi >/dev/null; then
    break
  fi
  sleep 5
done
dnf install -y docker python3 python3-pip openssl curl-minimal dnf-automatic
systemctl enable --now docker amazon-ssm-agent
systemctl mask --now sshd.service
if systemctl list-unit-files sshd.socket --no-legend | grep -q sshd.socket; then
  systemctl mask --now sshd.socket
fi
sed -i 's/^apply_updates = .*/apply_updates = yes/' /etc/dnf/automatic.conf
systemctl enable --now dnf-automatic.timer

install -d -m 0755 /usr/local/lib/docker/cli-plugins
curl -fsSL --retry 3 "$COMPOSE_DOWNLOAD_URL" -o /usr/local/lib/docker/cli-plugins/docker-compose
printf '%s  %s\n' "$COMPOSE_SHA256" /usr/local/lib/docker/cli-plugins/docker-compose | sha256sum --check -
chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose

python3 -m venv /opt/relay/venv
/opt/relay/venv/bin/pip install --no-cache-dir 'boto3>=1.40,<2'

# Do not replace credentials or database configuration on a retry.
if [ ! -f app.env ]; then
  database_password=$(openssl rand -hex 32)
  redis_password=$(openssl rand -hex 32)
  jwt_secret=$(openssl rand -hex 48)
  printf 'POSTGRES_USER=relay\nPOSTGRES_DB=relay\nPOSTGRES_PASSWORD=%s\n' "$database_password" > postgres.env
  printf 'REDIS_PASSWORD=%s\n' "$redis_password" > redis.env
  {
    printf 'NODE_ENV=production\nPORT=3000\nCOOKIE_SECURE=true\nLOG_LEVEL=info\nAWS_REGION=us-east-2\n'
    printf 'DATABASE_URL=postgresql://relay:%s@postgres:5432/relay?schema=public&connection_limit=5&pool_timeout=10\n' "$database_password"
    printf 'REDIS_URL=redis://:%s@redis:6379\n' "$redis_password"
    printf 'JWT_SECRET=%s\nFRONTEND_ORIGIN=https://%s\n' "$jwt_secret" "$RELAY_HOST"
    printf 'QUEUE_URL=\nATTACHMENTS_BUCKET=\nAWS_EC2_METADATA_DISABLED=true\n'
  } > app.env
  unset database_password redis_password jwt_secret
fi
chmod 0600 app.env postgres.env redis.env .env

if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 0600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi

cat > /etc/systemd/system/relay-demo.service <<'UNIT'
[Unit]
Description=Relay credits-only demo
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/relay
EnvironmentFile=/opt/relay/.env
ExecStart=/opt/relay/venv/bin/python /opt/relay/registry.py
ExecStop=/usr/bin/docker compose -f /opt/relay/compose.yaml stop
TimeoutStartSec=900

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now relay-demo.service
touch /opt/relay/bootstrap-complete
