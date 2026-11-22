// Nomes dos agentes do OpenBot (id `agent-<uuid>` da pasta de trabalho → nome), lidos de um JSON que um exportador grava
// (deploy/openbot/export-agent-names.py) e de um arquivo `.override.json` ao lado, que vence. Sem arquivo, o mapa é vazio.
import { readFileSync, statSync } from 'node:fs';
import { parseCharacterName } from '../../shared/appearance';

const OPENBOT_CWD = /^\/data\/OpenBot\/Agents\/(agent-[0-9a-f-]{36})(\/|$)/;
const RECHECK_MS = 30_000;

/** Id do agente do OpenBot (`agent-<uuid>`) pela pasta de trabalho da sessão; undefined para outras pastas. */
export function agentIdFromCwd(cwd: string): string | undefined {
  return OPENBOT_CWD.exec(cwd)?.[1];
}

/** Nome padrão de quem não tem nome no arquivo: `agent-` e os 8 primeiros caracteres do uuid. */
export function fallbackAgentName(agentId: string): string {
  return `agent-${agentId.slice(6, 14)}`;
}

export function overrideFileOf(file: string): string {
  return file.replace(/\.json$/i, '') + '.override.json';
}

function stampOf(file: string): string {
  try {
    const s = statSync(file);
    return `${s.mtimeMs}:${s.size}`;
  } catch {
    return '-';
  }
}

function readNames(file: string): Array<[string, string]> {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { agents?: Record<string, unknown> };
    // O nome vem de fora: o mesmo critério dos personagens (NFC, sem controle, até NAME_MAX). Nome recusado vira o padrão.
    return Object.entries(j.agents ?? {}).flatMap(([id, name]) => {
      const clean = parseCharacterName(name);
      return clean ? [[id, clean] as [string, string]] : [];
    });
  } catch {
    return [];
  }
}

export class AgentNames {
  private names = new Map<string, string>();
  private stamp = '';
  private checkedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** Nome do agente, ou undefined quando o id não está nos arquivos. Recarrega quando os arquivos mudam (checagem a cada 30 s). */
  nameOf(agentId: string): string | undefined {
    this.refresh();
    return this.names.get(agentId);
  }

  private refresh(): void {
    const t = this.now();
    if (t - this.checkedAt < RECHECK_MS) return;
    this.checkedAt = t;
    const override = overrideFileOf(this.file);
    const stamp = `${stampOf(this.file)}|${stampOf(override)}`;
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.names = new Map([...readNames(this.file), ...readNames(override)]);
  }
}
