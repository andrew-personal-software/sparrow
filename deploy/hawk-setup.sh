#!/usr/bin/env bash
# Run as root by `hawk setup sparrow`, after it makes $DATA.
set -euo pipefail
install -d -o sparrow -g sparrow -m 0750 "$DATA/attachments"

# Secrets for access control. Root only; systemd reads it before it drops to the sparrow user.
# SPARROW_PROXY_SECRET must match /etc/caddy/caddy.env, SPARROW_SERVICE_TOKEN crow's /etc/crow/crow.env,
# and SPARROW_HAWK_TOKEN /etc/hawk/sparrow-hawk-token.
if [[ ! -f /etc/sparrow/sparrow.env ]]; then
  install -d -m 0755 /etc/sparrow
  install -m 0600 /dev/null /etc/sparrow/sparrow.env
  printf 'SPARROW_PROXY_SECRET=\nSPARROW_SERVICE_TOKEN=\nSPARROW_HAWK_TOKEN=\n' >/etc/sparrow/sparrow.env
fi
