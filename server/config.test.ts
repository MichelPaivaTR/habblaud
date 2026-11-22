import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setQuiet } from './log';
import { loadConfig, parseRepoRoots } from './config';
import { tempDir } from './test/fixtures';

setQuiet(true);

describe('parseRepoRoots', () => {
  it('ausente ou vazia = nenhuma raiz', () => {
    expect(parseRepoRoots(undefined)).toEqual([]);
    expect(parseRepoRoots('')).toEqual([]);
    expect(parseRepoRoots(' , ,')).toEqual([]);
  });

  it('separa por vírgula, tira espaços, itens vazios e barras finais', () => {
    expect(parseRepoRoots(' /data/a/ , /data/b//,,/data/c ')).toEqual(['/data/a', '/data/b', '/data/c']);
  });
});

describe('loadConfig: repositórios e nomes', () => {
  let tmp: { dir: string; cleanup: () => void };
  beforeEach(() => {
    tmp = tempDir();
  });
  afterEach(() => tmp.cleanup());

  it('sem as variáveis: sem raízes e sem arquivo de nomes', () => {
    const cfg = loadConfig({ HOME: tmp.dir }, []);
    expect(cfg.repoRoots).toEqual([]);
    expect(cfg.agentNamesFile).toBeUndefined();
  });

  it('lê HABBLAUD_REPO_ROOTS e HABBLAUD_AGENT_NAMES_FILE', () => {
    const cfg = loadConfig(
      { HOME: tmp.dir, HABBLAUD_REPO_ROOTS: '/data/OpenBot/Shared/Github/', HABBLAUD_AGENT_NAMES_FILE: ' /data/nomes.json ' },
      [],
    );
    expect(cfg.repoRoots).toEqual(['/data/OpenBot/Shared/Github']);
    expect(cfg.agentNamesFile).toBe('/data/nomes.json');
  });

  it('combinação de produção desliga terminal, mensagens, World, atualização e Codex', () => {
    const cfg = loadConfig(
      {
        HOME: tmp.dir,
        HABBLAUD_IN_DOCKER: '0',
        HABBLAUD_HOST: '100.81.240.92',
        HABBLAUD_WORLD: '0',
        HABBLAUD_UPDATE_CHECK: '0',
        HABBLAUD_CODEX: '0',
      },
      [],
    );
    expect(cfg.host).toBe('100.81.240.92');
    expect(cfg.inDocker).toBe(false);
    expect(cfg.terminal).toBe(false);
    expect(cfg.messages).toBe(false);
    expect(cfg.world.enabled).toBe(false);
    expect(cfg.updateCheck).toBe(false);
    expect(cfg.codex).toBe(false);
  });
});
