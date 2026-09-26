#!/usr/bin/env bash
# Pushes the Twilio values from .env.production.local to Vercel production and points the number's inbound
# SMS webhook at APP_URL/api/sms/inbound. Values are read from the file and never printed. Run once after pasting them.
set -euo pipefail
cd "$(dirname "$0")/.."
S=${VERCEL_SCOPE:-shanelabountyai-8212s-projects}
get() { grep -E "^$1=" .env.production.local | head -1 | cut -d= -f2- | tr -d '\r\n'; }
SID=$(get TWILIO_ACCOUNT_SID); TOKEN=$(get TWILIO_AUTH_TOKEN); FROM=$(get TWILIO_FROM)
[ -n "$SID" ] && [ -n "$TOKEN" ] && [ -n "$FROM" ] || { echo "Fill TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (E.164, e.g. +15551234567) in .env.production.local first."; exit 1; }
APP_URL=$(vercel env pull --environment production --scope "$S" /dev/stdout 2>/dev/null | grep -E '^APP_URL=' | cut -d= -f2- | tr -d '"\r\n')
[ -n "$APP_URL" ] || { echo "APP_URL is not set on Vercel production."; exit 1; }

for k in TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_FROM; do
  vercel env rm "$k" production --yes --scope "$S" >/dev/null 2>&1 || true
  printf '%s' "$(get $k)" | vercel env add "$k" production --scope "$S" >/dev/null && echo "vercel: $k set"
done

# The number's SID, then its SmsUrl. Twilio signs inbound posts over this exact URL (src/lib/inbound.ts).
PN=$(curl -sS -u "$SID:$TOKEN" "https://api.twilio.com/2010-04-01/Accounts/$SID/IncomingPhoneNumbers.json?PhoneNumber=$(printf '%s' "$FROM" | sed 's/+/%2B/')" | python3 -c 'import sys,json; r=json.load(sys.stdin)["incoming_phone_numbers"]; print(r[0]["sid"] if r else "")')
[ -n "$PN" ] || { echo "Twilio has no number $FROM on this account."; exit 1; }
curl -sS -o /dev/null -w "twilio: webhook set (%{http_code})\n" -u "$SID:$TOKEN" -X POST "https://api.twilio.com/2010-04-01/Accounts/$SID/IncomingPhoneNumbers/$PN.json" \
  --data-urlencode "SmsUrl=$APP_URL/api/sms/inbound" --data-urlencode "SmsMethod=POST"
echo "Redeploy to pick up the env: push a commit, or run: vercel redeploy \$(vercel ls callboard --prod --scope $S 2>/dev/null | awk 'NR==3{print \$1}') --scope $S"
