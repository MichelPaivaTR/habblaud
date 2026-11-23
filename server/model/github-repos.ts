// H11: sala pelo repositório do GitHub. Liga `dono/repo` à pasta clonada nas raízes (HABBLAUD_REPO_ROOTS) lendo só o
// `origin` de <raiz>/<pasta>/.git/config: sem rede, sem token, sem git e sem alterar o clone. A sala é a pasta (nome da pasta,
// sem apelido). Clone novo aparece sozinho: uma busca sem resultado relê as raízes (no máximo a cada MISS_RESCAN_MS).
import { readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

const FULL_RESCAN_MS = 60_000;
const MISS_RESCAN_MS = 5_000;
const CONFIG_MAX = 64 * 1024;

/** `dono/repo` (minúsculo, sem .git) de uma URL do GitHub; credenciais na URL são descartadas. Outro host = undefined. */
export function ownerRepoOfUrl(url: string): string | undefined {
  const u = url.trim();
  const m =
    /^(?:https?|ssh|git):\/\/(?:[^@/\s]+@)?github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(u) ??
    /^(?:[^@/\s]+@)?github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(u);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : undefined;
}

/** URL do `[remote "origin"]` de um .git/config. */
export function originUrlOf(config: string): string | undefined {
  let inOrigin = false;
  for (const raw of config.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      inOrigin = /^\[remote\s+"origin"\s*\]$/.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const m = /^url\s*=\s*(.+)$/.exec(line);
    if (m) return m[1].trim();
  }
  return undefined;
}

export class GithubRepos {
  private map = new Map<string, string>();
  private scannedAt = -Infinity;
  private readonly roots: string[];

  constructor(
    roots: string[],
    private readonly now: () => number = Date.now,
  ) {
    this.roots = roots.map((r) => posix.normalize(r).replace(/\/+$/, '')).filter((r) => r.startsWith('/') && r !== '');
  }

  /** Sala (`<raiz>/<pasta>`) do clone cujo origin é `dono/repo`; undefined quando não há clone nas raízes. */
  lookup(ownerRepo: string): string | undefined {
    if (!this.roots.length) return undefined;
    const key = ownerRepo.toLowerCase().replace(/\.git$/, '');
    const age = this.now() - this.scannedAt;
    if (age > FULL_RESCAN_MS) this.scan();
    let room = this.map.get(key);
    if (!room && this.now() - this.scannedAt > MISS_RESCAN_MS) {
      this.scan();
      room = this.map.get(key);
    }
    return room;
  }

  private scan(): void {
    this.scannedAt = this.now();
    const next = new Map<string, string>();
    for (const root of this.roots) {
      let names: string[];
      try {
        names = readdirSync(root, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
          .map((d) => d.name)
          .sort();
      } catch {
        continue;
      }
      for (const name of names) {
        let text: string;
        try {
          text = readFileSync(`${root}/${name}/.git/config`, 'utf8').slice(0, CONFIG_MAX);
        } catch {
          continue; // sem .git/config (ou .git é um arquivo de worktree): sem clone
        }
        const url = originUrlOf(text);
        const key = url ? ownerRepoOfUrl(url) : undefined;
        if (key && !next.has(key)) next.set(key, `${root}/${name}`);
      }
    }
    this.map = next;
  }
}
