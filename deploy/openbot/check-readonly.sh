#!/usr/bin/env bash
# Verificação de somente leitura do Habblaud na tailnet (para o QA). Imprime OK/FALHA por item e sai com 1 se algo falhar.
# Uso: check-readonly.sh [host=100.81.240.92] [porta=4747] [pid do serviço] [log=/data/.habblaud/logs/habblaud.log]
set -u

HOST="${1:-100.81.240.92}"
PORT="${2:-4747}"
PID="${3:-}"
LOG="${4:-/data/.habblaud/logs/habblaud.log}"
BASE="http://$HOST:$PORT"
checks=0
fails=0

ok() { checks=$((checks + 1)); echo "OK     $1"; }
fail() { checks=$((checks + 1)); fails=$((fails + 1)); echo "FALHA  $1"; }

# Método, caminho e status esperado: a escrita tem de responder 403; /api/world* tem de responder 404.
expect_status() {
  local name="$1" method="$2" path="$3" want="$4" code
  local args=(-s -o /dev/null -w '%{http_code}' --max-time 5 -X "$method")
  [ "$method" = POST ] && args+=(-H 'Content-Type: application/json' --data '{}')
  code=$(curl "${args[@]}" "$BASE$path" 2>/dev/null)
  if [ "$code" = "$want" ]; then ok "$name: $method $path -> $code"; else fail "$name: $method $path -> ${code:-sem resposta} (esperado $want)"; fi
}

expect_status 'terminal bloqueado' GET /api/agents/x/terminal 403
expect_status 'mensagens bloqueadas' POST /api/messages 403
expect_status 'permissões bloqueadas' POST /api/permissions 403
expect_status 'World escondido' GET /api/world/status 404

if [ ! -r "$LOG" ]; then
  fail "log de subida ilegível: $LOG"
else
  for text in 'Terminal: desligado' 'Habblaud World: escondido' 'verificação desligada'; do
    if grep -F -q "$text" "$LOG"; then ok "log: \"$text\""; else fail "log sem \"$text\" ($LOG)"; fi
  done
fi

# Conexão de saída do serviço: sockets TCP ESTABLISHED do PID cuja porta local não é a do Habblaud (as de entrada usam essa porta).
if [ -z "$PID" ] || [ ! -d "/proc/$PID" ]; then
  fail "PID do serviço não informado ou não está rodando"
else
  port_hex=$(printf '%04X' "$PORT")
  inodes=$(for fd in /proc/"$PID"/fd/*; do readlink "$fd" 2>/dev/null; done | sed -n 's/^socket:\[\([0-9]*\)\]$/\1/p')
  out=$(printf '%s\n' $inodes | awk -v port="$port_hex" '
    NR == FNR { owned[$1] = 1; next }
    FNR > 1 && $4 == "01" { split($2, local, ":"); if (($10 in owned) && local[2] != port) n++ }
    END { print n + 0 }
  ' - /proc/net/tcp /proc/net/tcp6)
  if [ "$out" = 0 ]; then ok "sem conexão de saída do PID $PID"; else fail "$out conexão(ões) de saída do PID $PID"; fi
fi

echo "$checks verificação(ões), $fails falha(s)"
[ "$fails" = 0 ]
