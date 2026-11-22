import { posix } from 'node:path';

/** Campo do input de cada ferramenta que aponta para um caminho de arquivo ou pasta. */
const PATH_FIELD = new Map<string, string>([
  ['Read', 'file_path'],
  ['Edit', 'file_path'],
  ['Write', 'file_path'],
  ['MultiEdit', 'file_path'],
  ['NotebookEdit', 'notebook_path'],
  ['Glob', 'path'],
  ['Grep', 'path'],
]);

/** Caracteres que terminam um caminho dentro de um comando Bash. */
const BASH_PATH = /^[^\s"'`;|&<>()]+/;

function cleanRoots(roots: string[]): string[] {
  return roots
    .map((r) => posix.normalize(r.trim()).replace(/\/+$/, ''))
    .filter((r) => r.startsWith('/') && r !== '/' && r !== '');
}

/**
 * Sala de repositório de um caminho: `<raiz>/<repo>`, quando o caminho está estritamente dentro
 * de uma das raízes. A raiz em si, caminhos fora delas e segmentos vazios ou ocultos não valem.
 */
export function repoRoomOf(path: string, roots: string[]): string | undefined {
  if (!path.startsWith('/')) return undefined;
  const p = posix.normalize(path);
  for (const root of cleanRoots(roots)) {
    if (!p.startsWith(`${root}/`)) continue;
    const repo = p.slice(root.length + 1).split('/')[0];
    if (!repo || repo.startsWith('.')) return undefined;
    return `${root}/${repo}`;
  }
  return undefined;
}

/** Primeiro repositório citado no comando Bash (cd, git -C ou argumentos). */
function repoInCommand(command: string, roots: string[]): string | undefined {
  const hits: { index: number; room: string }[] = [];
  for (const root of cleanRoots(roots)) {
    for (let i = command.indexOf(`${root}/`); i !== -1; i = command.indexOf(`${root}/`, i + 1)) {
      if (i > 0 && /[\w./-]/.test(command[i - 1])) continue;
      const room = repoRoomOf(command.slice(i).match(BASH_PATH)?.[0] ?? '', roots);
      if (room) hits.push({ index: i, room });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits[0]?.room;
}

/** Evidência de repositório de uma chamada de ferramenta; undefined quando não há caminho de repositório. */
export function repoHintFromTool(tool: string, input: unknown, roots: string[]): string | undefined {
  if (!roots.length || !input || typeof input !== 'object') return undefined;
  const fields = input as Record<string, unknown>;
  if (tool === 'Bash') {
    return typeof fields.command === 'string' ? repoInCommand(fields.command, roots) : undefined;
  }
  const field = PATH_FIELD.get(tool);
  const value = field ? fields[field] : undefined;
  return typeof value === 'string' ? repoRoomOf(value, roots) : undefined;
}
