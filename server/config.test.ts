import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setQuiet } from './log';
import { isTailnetBind, loadConfig, parseRepoRoots, viewOffReason } from './config';
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

  it('combinação de produção: leitura pela tailnet, terminal e mensagens desligados, World, atualização e Codex desligados', () => {
    const cfg = loadConfig(
      {
        HOME: tmp.dir,
        HABBLAUD_IN_DOCKER: '0',
        HABBLAUD_HOST: '100.81.240.92',
        HABBLAUD_WORLD: '0',
        HABBLAUD_UPDATE_CHECK: '0',
        HABBLAUD_CODEX: '0',
        HABBLAUD_VIEW_REMOTE: '1',
      },
      [],
    );
    expect(cfg.host).toBe('100.81.240.92');
    expect(cfg.inDocker).toBe(false);
    expect(cfg.view).toBe(true);
    expect(cfg.terminal).toBe(false);
    expect(cfg.messages).toBe(false);
    expect(cfg.world.enabled).toBe(false);
    expect(cfg.updateCheck).toBe(false);
    expect(cfg.codex).toBe(false);
  });
});

describe('isTailnetBind', () => {
  it('IPs da tailnet (100.64.0.0/10 e fd7a:115c:a1e0::/48) valem', () => {
    for (const ip of ['100.81.240.92', '100.64.0.1', '100.127.255.255', 'fd7a:115c:a1e0::1']) expect(isTailnetBind(ip)).toBe(true);
  });

  it('fora da tailnet não vale: 0.0.0.0, ::, loopback, LAN, nomes e faixa vizinha', () => {
    for (const host of ['100.128.0.1', '100.63.255.255', '0.0.0.0', '::', '127.0.0.1', '192.168.1.5', 'habblaud.lan', 'localhost', '']) {
      expect(isTailnetBind(host)).toBe(false);
    }
  });
});

describe('viewOffReason', () => {
  it('sem a flag não há motivo (nada a registrar)', () => {
    expect(viewOffReason({}, '0.0.0.0')).toBeUndefined();
  });

  it('flag ligada com IP da tailnet: liga (sem motivo)', () => {
    expect(viewOffReason({ HABBLAUD_VIEW_REMOTE: '1' }, '100.81.240.92')).toBeUndefined();
  });

  it('flag ligada com host de fora da tailnet: explica por que ficou desligado', () => {
    expect(viewOffReason({ HABBLAUD_VIEW_REMOTE: '1' }, '0.0.0.0')).toContain('0.0.0.0');
  });
});

describe('loadConfig: modo de visualização', () => {
  let tmp: { dir: string; cleanup: () => void };
  beforeEach(() => {
    tmp = tempDir();
  });
  afterEach(() => tmp.cleanup());

  it('view só com a flag e host da tailnet; terminal e mensagens continuam desligados', () => {
    const cfg = loadConfig({ HOME: tmp.dir, HABBLAUD_HOST: '100.81.240.92', HABBLAUD_VIEW_REMOTE: '1' }, []);
    expect(cfg.view).toBe(true);
    expect(cfg.terminal).toBe(false);
    expect(cfg.messages).toBe(false);
  });

  it('sem a flag, view é falso', () => {
    expect(loadConfig({ HOME: tmp.dir, HABBLAUD_HOST: '100.81.240.92' }, []).view).toBe(false);
  });

  it('flag com host fora da tailnet: view falso (fail-closed)', () => {
    expect(loadConfig({ HOME: tmp.dir, HABBLAUD_HOST: '0.0.0.0', HABBLAUD_VIEW_REMOTE: '1' }, []).view).toBe(false);
  });
});
