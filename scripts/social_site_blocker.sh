#!/usr/bin/env bash
set -euo pipefail

HOSTS_FILE="/etc/hosts"
BACKUP_FILE="/etc/hosts.portfolio-social-backup"
START_MARKER="# BEGIN Portfolio Social Focus Block"
END_MARKER="# END Portfolio Social Focus Block"
DEFAULT_OAUTH_MINUTES=10

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"

DOMAINS=(
  facebook.com
  www.facebook.com
  m.facebook.com
  mbasic.facebook.com
  business.facebook.com
  developers.facebook.com
  instagram.com
  www.instagram.com
  m.instagram.com
  help.instagram.com
  business.instagram.com
  threads.net
  www.threads.net
  mastodon.social
  www.mastodon.social
  x.com
  www.x.com
  twitter.com
  www.twitter.com
  t.co
  linkedin.com
  www.linkedin.com
  reddit.com
  www.reddit.com
  old.reddit.com
  new.reddit.com
  tiktok.com
  www.tiktok.com
  youtube.com
  www.youtube.com
  m.youtube.com
  youtu.be
  pinterest.com
  www.pinterest.com
  tumblr.com
  www.tumblr.com
  bsky.app
  bluesky.social
  medium.com
  www.medium.com
  substack.com
  www.substack.com
)

usage() {
  cat <<'USAGE'
Usage:
  scripts/social_site_blocker.sh status
  sudo scripts/social_site_blocker.sh block
  sudo scripts/social_site_blocker.sh allow-oauth [minutes]
  sudo scripts/social_site_blocker.sh unblock

Commands:
  status                 Show whether the managed social block is active.
  block                  Add the managed social block to /etc/hosts.
  allow-oauth [minutes]  Temporarily remove the block, then restore it automatically.
  unblock                Remove the managed social block until block is run again.

Notes:
  - block/unblock/allow-oauth require sudo because /etc/hosts is root-owned.
  - allow-oauth defaults to 10 minutes.
  - This blocks normal browsing on this Mac only. AWS/backend API calls are unaffected.
USAGE
}

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "This command needs sudo because ${HOSTS_FILE} is root-owned." >&2
    exit 1
  fi
}

strip_managed_block() {
  awk -v start="${START_MARKER}" -v end="${END_MARKER}" '
    $0 == start { skip = 1; next }
    $0 == end { skip = 0; next }
    skip != 1 { print }
  ' "${HOSTS_FILE}"
}

write_hosts() {
  local tmp_file
  tmp_file="$(mktemp)"
  cat > "${tmp_file}"
  install -o root -g wheel -m 0644 "${tmp_file}" "${HOSTS_FILE}"
  rm -f "${tmp_file}"
}

flush_dns() {
  dscacheutil -flushcache || true
  killall -HUP mDNSResponder 2>/dev/null || true
}

is_block_active() {
  grep -qxF "${START_MARKER}" "${HOSTS_FILE}" && grep -qxF "${END_MARKER}" "${HOSTS_FILE}"
}

status() {
  if is_block_active; then
    echo "Social focus block: active"
  else
    echo "Social focus block: inactive"
  fi
}

block() {
  require_root
  if [[ ! -f "${BACKUP_FILE}" ]]; then
    cp "${HOSTS_FILE}" "${BACKUP_FILE}"
  fi

  {
    strip_managed_block
    printf '\n%s\n' "${START_MARKER}"
    for domain in "${DOMAINS[@]}"; do
      printf '127.0.0.1 %s\n' "${domain}"
      printf '::1 %s\n' "${domain}"
    done
    printf '%s\n' "${END_MARKER}"
  } | write_hosts

  flush_dns
  echo "Social focus block is active."
}

unblock() {
  require_root
  strip_managed_block | write_hosts
  flush_dns
  echo "Social focus block is inactive."
}

allow_oauth() {
  require_root
  local minutes="${1:-${DEFAULT_OAUTH_MINUTES}}"
  if ! [[ "${minutes}" =~ ^[0-9]+$ ]] || [[ "${minutes}" -lt 1 ]] || [[ "${minutes}" -gt 240 ]]; then
    echo "Minutes must be a whole number between 1 and 240." >&2
    exit 1
  fi

  unblock
  echo "OAuth window is open for ${minutes} minute(s). The social block will restore automatically."
  (
    sleep "$((minutes * 60))"
    "${SCRIPT_PATH}" block
  ) >/tmp/portfolio-social-site-blocker.log 2>&1 &
}

command="${1:-}"
case "${command}" in
  status)
    status
    ;;
  block)
    block
    ;;
  unblock)
    unblock
    ;;
  allow-oauth)
    allow_oauth "${2:-${DEFAULT_OAUTH_MINUTES}}"
    ;;
  -h|--help|help|'')
    usage
    ;;
  *)
    echo "Unknown command: ${command}" >&2
    usage >&2
    exit 1
    ;;
esac
