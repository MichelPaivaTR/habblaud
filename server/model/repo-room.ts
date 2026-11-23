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

/** `dono/repo` → sala (pasta clonada cujo origin é esse repositório); ver GithubRepos. */
export type GithubRoomResolver = (ownerRepo: string) => string | undefined;

const NAME = '[\\w.-]+';
// Referências do GitHub num comando: gh -R/--repo dono/repo, gh api repos/dono/repo, URL github.com/dono/repo (https ou ssh).
const GITHUB_REFS = [
  new RegExp(`(?:^|[\\s;&|(])(?:-R|--repo)(?:\\s+|=)["']?(${NAME}/${NAME})`, 'g'),
  new RegExp(`(?:^|[\\s"'=/])repos/(${NAME}/${NAME})`, 'g'),
  new RegExp(`github\\.com[/:](${NAME}/${NAME})`, 'gi'),
];

/**
 * Repositório do GitHub citado no comando (primeiro, na ordem do comando, que tem clone nas raízes). Sem clone local o
 * repositório não vira sala (CA11.2). `api.github.com/repos/o/r` entra pela forma `repos/o/r`, não pela URL.
 */
function githubRoomInCommand(command: string, resolve: GithubRoomResolver): string | undefined {
  const hits: { index: number; ref: string }[] = [];
  for (const re of GITHUB_REFS) {
    for (const m of command.matchAll(re)) {
      const ref = m[1].replace(/\.git$/, '');
      if (re.source.startsWith('github') && /^repos\//.test(ref)) continue;
      hits.push({ index: m.index ?? 0, ref });
    }
  }
  hits.sort((a, b) => a.index - b.index);
  for (const h of hits) {
    const room = resolve(h.ref);
    if (room) return room;
  }
  return undefined;
}

/**
 * Evidência de repositório de uma chamada de ferramenta; undefined quando não há. Caminho local vale primeiro; só sem
 * caminho um comando Bash com referência ao GitHub (`github`) desempata (H11).
 */
export function repoHintFromTool(tool: string, input: unknown, roots: string[], github?: GithubRoomResolver): string | undefined {
  if (!roots.length || !input || typeof input !== 'object') return undefined;
  const fields = input as Record<string, unknown>;
  if (tool === 'Bash') {
    if (typeof fields.command !== 'string') return undefined;
    return repoInCommand(fields.command, roots) ?? (github ? githubRoomInCommand(fields.command, github) : undefined);
  }
  const field = PATH_FIELD.get(tool);
  const value = field ? fields[field] : undefined;
  return typeof value === 'string' ? repoRoomOf(value, roots) : undefined;
}
