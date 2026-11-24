import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { GithubRepos, originUrlOf, ownerRepoOfUrl } from './github-repos';

describe('ownerRepoOfUrl', () => {
  it('https, ssh e scp, com ou sem .git e barra final', () => {
    for (const url of [
      'https://github.com/michelcpaiva-personal/fiscal-natural-uso',
      'https://github.com/michelcpaiva-personal/fiscal-natural-uso.git',
      'https://github.com/michelcpaiva-personal/fiscal-natural-uso/',
      'git@github.com:michelcpaiva-personal/fiscal-natural-uso.git',
      'ssh://git@github.com/michelcpaiva-personal/fiscal-natural-uso.git',
      'ssh://git@github.com:22/michelcpaiva-personal/fiscal-natural-uso.git',
    ]) {
      expect(ownerRepoOfUrl(url), url).toBe('michelcpaiva-personal/fiscal-natural-uso');
    }
  });

  it('descarta credenciais da URL e ignora outros hosts e caminhos locais', () => {
    expect(ownerRepoOfUrl('https://x-access-token:ghp_segredo@github.com/o/r.git')).toBe('o/r');
    expect(ownerRepoOfUrl('https://gitlab.com/o/r.git')).toBeUndefined();
    expect(ownerRepoOfUrl('/data/repos/r.git')).toBeUndefined();
    expect(ownerRepoOfUrl('')).toBeUndefined();
  });
});

describe('originUrlOf', () => {
  it('lê só o remote origin', () => {
    const cfg = '[core]\n\tbare = false\n[remote "upstream"]\n\turl = https://github.com/a/b.git\n[remote "origin"]\n\turl = git@github.com:c/d.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n';
    expect(originUrlOf(cfg)).toBe('git@github.com:c/d.git');
    expect(originUrlOf('[core]\n')).toBeUndefined();
  });
});

describe('GithubRepos', () => {
  let tmp: { dir: string; cleanup: () => void };
  let clock: number;
  const clone = (name: string, url: string) => {
    mkdirSync(join(tmp.dir, name, '.git'), { recursive: true });
    writeFileSync(join(tmp.dir, name, '.git', 'config'), `[remote "origin"]\n\turl = ${url}\n`);
  };
  beforeEach(() => {
    tmp = tempDir('habblaud-ghrepos-');
    clock = 1_000_000;
  });
  afterEach(() => tmp.cleanup());

  it('dono/repo (sem diferenciar maiúsculas) vira a pasta clonada, não um apelido', () => {
    clone('fiscal-natural-uso', 'https://github.com/michelcpaiva-personal/fiscal-natural-uso.git');
    const repos = new GithubRepos([tmp.dir], () => clock);
    expect(repos.lookup('MichelCPaiva-Personal/Fiscal-Natural-Uso')).toBe(`${tmp.dir}/fiscal-natural-uso`);
  });

  it('repositório sem clone nas raízes não tem sala (CA11.2)', () => {
    clone('fiscal-natural-uso', 'https://github.com/michelcpaiva-personal/fiscal-natural-uso.git');
    expect(new GithubRepos([tmp.dir], () => clock).lookup('outro/repo')).toBeUndefined();
  });

  it('pasta sem .git, com .git arquivo (worktree) ou oculta é ignorada', () => {
    mkdirSync(join(tmp.dir, 'sem-git'), { recursive: true });
    mkdirSync(join(tmp.dir, 'wt'), { recursive: true });
    writeFileSync(join(tmp.dir, 'wt', '.git'), 'gitdir: /x/.git/worktrees/wt');
    clone('.oculta', 'https://github.com/o/oculta.git');
    const repos = new GithubRepos([tmp.dir], () => clock);
    expect(repos.lookup('o/oculta')).toBeUndefined();
    expect(repos.lookup('o/wt')).toBeUndefined();
  });

  it('clone novo é visto sem reiniciar, relendo no máximo a cada 5 s (CA11.4)', () => {
    const repos = new GithubRepos([tmp.dir], () => clock);
    expect(repos.lookup('o/novo')).toBeUndefined();
    clone('novo', 'https://github.com/o/novo.git');
    clock += 1_000;
    expect(repos.lookup('o/novo')).toBeUndefined();
    clock += 5_000;
    expect(repos.lookup('o/novo')).toBe(`${tmp.dir}/novo`);
  });

  it('só lê o .git/config: o clone não é alterado', () => {
    clone('r', 'https://github.com/o/r.git');
    const file = join(tmp.dir, 'r', '.git', 'config');
    const before = statSync(file).mtimeMs;
    new GithubRepos([tmp.dir], () => clock).lookup('o/r');
    expect(statSync(file).mtimeMs).toBe(before);
  });

  it('sem raízes, nada', () => {
    expect(new GithubRepos([], () => clock).lookup('o/r')).toBeUndefined();
  });
});
