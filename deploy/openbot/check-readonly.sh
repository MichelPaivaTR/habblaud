#!/usr/bin/env bash
# Verificação do modo de visualização pela tailnet (para o QA). Imprime OK/FALHA por item e sai com 1 se algo falhar.
# Leitura (terminal, histórico, snapshot) tem de responder 200; escrita, entregas e edição 403; World 404.
# Uso: check-readonly.sh [host=100.81.240.92] [porta=4747] [pid do serviço] [log=/data/.habblaud/logs/habblaud.log]
#      [pasta do Claude=/data/.claude] [linha de base=/data/.habblaud/claude-baseline.txt]
# Conexões de saída: SAMPLES amostras (padrão 5) com INTERVAL segundos entre elas (padrão 2); vale a pior amostra.
set -u

HOST="${1:-100.81.240.92}"
PORT="${2:-4747}"
PID="${3:-}"
LOG="${4:-/data/.habblaud/logs/habblaud.log}"
CLAUDE_DIR="${5:-/data/.claude}"
BASELINE="${6:-/data/.habblaud/claude-baseline.txt}"
BASE="http://$HOST:$PORT"
checks=0
fails=0

ok() { checks=$((checks + 1)); echo "OK     $1"; }
fail() { checks=$((checks + 1)); fails=$((fails + 1)); echo "FALHA  $1"; }

# Método, caminho e status esperado (200 nas leituras, 403 nas escritas, 404 no World).
expect_status() {
  local name="$1" method="$2" path="$3" want="$4" code
  local args=(-s -o /dev/null -w '%{http_code}' --max-time 5 -X "$method")
  [ "$method" = POST ] && args+=(-H 'Content-Type: application/json' --data '{}')
  [ "$method" = PUT ] && args+=(-H 'Content-Type: application/json' --data '{}')
  code=$(curl "${args[@]}" "$BASE$path" 2>/dev/null)
  if [ "$code" = "$want" ]; then ok "$name: $method $path -> $code"; else fail "$name: $method $path -> ${code:-sem resposta} (esperado $want)"; fi
}

SNAP=$(mktemp)
trap 'rm -f "$SNAP"' EXIT
if curl -s --max-time 5 "$BASE/api/snapshot" -o "$SNAP" && [ -s "$SNAP" ]; then
  ok "leitura: GET /api/snapshot -> 200 (com conteúdo)"
else
  fail "leitura: GET /api/snapshot sem conteúdo"
fi

expect_status 'histórico' GET /api/sessions/recent 200
expect_status 'acesso' GET /api/access 200
ACCESS=$(curl -s --max-time 5 "$BASE/api/access")
if printf '%s' "$ACCESS" | python3 -c "import json,sys; a=json.load(sys.stdin); sys.exit(0 if a.get('terminal') is True and a.get('local') is False and a.get('permissions') is False and a.get('messages') is False and a.get('spawn') is False else 1)" 2>/dev/null; then
  ok "acesso coerente: terminal sim; local, permissões, mensagens e spawn não"
else
  fail "acesso incoerente: $ACCESS"
fi

# Um agente principal vivo: o terminal dele tem de abrir (o SSE fica aberto; conta o status do começo).
AGENT=$(python3 -c "
import json,sys
try:
    s=json.load(open('$SNAP'))
    a=[x for x in s.get('agents',[]) if x.get('kind')=='main' and x.get('status') not in ('offline','done')]
    print(a[0]['id'] if a else '')
except Exception:
    print('')
" 2>/dev/null)
if [ -z "$AGENT" ]; then
  fail "terminal: nenhum agente principal vivo no snapshot"
else
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$BASE/api/agents/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$AGENT")/terminal" 2>/dev/null)
  if [ "$code" = 200 ]; then ok "terminal: GET /api/agents/$AGENT/terminal -> 200"; else fail "terminal: GET /api/agents/$AGENT/terminal -> ${code:-sem resposta} (esperado 200)"; fi
fi

expect_status 'escrita: mensagens' POST /api/messages 403
expect_status 'escrita: permissões' POST /api/permissions 403
expect_status 'escrita: PTY' POST /api/pty/new 403
expect_status 'escrita: entregas' GET /api/deliveries 403
expect_status 'escrita: renomear sala' POST /api/rooms/rename 403
expect_status 'escrita: demo' POST /api/demo 403
expect_status 'escrita: verificar versão' POST /api/updates/check 403
expect_status 'World escondido' GET /api/world/status 404

if grep -q '"email"' "$SNAP"; then fail "privacidade: e-mail aparece no snapshot"; else ok "privacidade: sem e-mail no snapshot"; fi

if [ ! -r "$LOG" ]; then
  fail "log de subida ilegível: $LOG"
else
  for text in 'Terminal: somente leitura pela tailnet' 'Responder pelo escritório: desligado' 'Habblaud World: escondido' 'verificação desligada'; do
    if grep -F -q "$text" "$LOG"; then ok "log: \"$text\""; else fail "log sem \"$text\" ($LOG)"; fi
  done
fi

# Conexão de saída do serviço: sockets TCP ESTABLISHED do PID cuja porta local não é a do Habblaud (as de entrada usam essa porta).
if [ -z "$PID" ] || [ ! -d "/proc/$PID" ]; then
  fail "PID do serviço não informado ou não está rodando"
else
  port_hex=$(printf '%04X' "$PORT")
  samples="${SAMPLES:-5}"
  interval="${INTERVAL:-2}"
  out=0
  for ((i = 0; i < samples; i++)); do
    inodes=$(for fd in /proc/"$PID"/fd/*; do readlink "$fd" 2>/dev/null; done | sed -n 's/^socket:\[\([0-9]*\)\]$/\1/p')
    n=$(printf '%s\n' $inodes | awk -v port="$port_hex" '
      NR == FNR { owned[$1] = 1; next }
      FNR > 1 && $4 == "01" { split($2, local, ":"); if (($10 in owned) && local[2] != port) n++ }
      END { print n + 0 }
    ' - /proc/net/tcp /proc/net/tcp6)
    [ "$n" -gt "$out" ] && out=$n
    [ "$i" -lt $((samples - 1)) ] && sleep "$interval"
  done
  if [ "$out" = 0 ]; then ok "sem conexão de saída do PID $PID ($samples amostras)"; else fail "$out conexão(ões) de saída do PID $PID em alguma das $samples amostras"; fi

  # Endereço de escuta: o socket LISTEN da porta, do PID do serviço, tem de estar no IP informado (não em 0.0.0.0 nem ::).
  # /proc guarda o IPv4 em hexadecimal little-endian (100.81.240.92 aparece como 5CF05164).
  ip_hex=$(IFS=. read -r a b c d <<< "$HOST"; printf '%02X%02X%02X%02X' "$d" "$c" "$b" "$a")
  listen=$(printf '%s\n' $inodes | awk -v port="$port_hex" -v ip="$ip_hex" '
    NR == FNR { owned[$1] = 1; next }
    FNR > 1 && $4 == "0A" && ($10 in owned) {
      split($2, local, ":")
      if (local[2] != port) next
      if (local[1] == ip) good++
      else if (local[1] ~ /^0+$/) wildcard++
      else other++
    }
    END { print good + 0, wildcard + 0, other + 0 }
  ' - /proc/net/tcp /proc/net/tcp6)
  read -r good wildcard other <<< "$listen"
  if [ "$wildcard" != 0 ]; then fail "o serviço escuta em todas as interfaces (0.0.0.0 ou ::) na porta $PORT"
  elif [ "$other" != 0 ] && [ "$good" = 0 ]; then fail "o serviço escuta em outro endereço, não em $HOST"
  elif [ "$good" != 0 ]; then ok "escuta só em $HOST:$PORT"
  else fail "sem socket de escuta em $HOST:$PORT para o PID $PID"; fi
fi

# /data/.claude não muda: hash do settings.json e a lista de nomes do primeiro nível. Sem linha de base, grava a atual.
if [ -r "$CLAUDE_DIR/settings.json" ]; then
  current=$({ sha256sum "$CLAUDE_DIR/settings.json"; find "$CLAUDE_DIR" -maxdepth 1 -mindepth 1 -printf '%f\n' | sort; } 2>/dev/null)
  if [ -f "$BASELINE" ]; then
    if [ "$current" = "$(cat "$BASELINE")" ]; then ok "$CLAUDE_DIR: settings.json e lista de arquivos iguais à linha de base"; else fail "$CLAUDE_DIR mudou em relação à linha de base ($BASELINE)"; fi
  else
    mkdir -p "$(dirname "$BASELINE")" && printf '%s\n' "$current" > "$BASELINE"
    ok "$CLAUDE_DIR: linha de base gravada em $BASELINE"
  fi
else
  fail "$CLAUDE_DIR/settings.json ilegível"
fi

echo "$checks verificação(ões), $fails falha(s)"
[ "$fails" = 0 ]
