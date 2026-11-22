import { describe, expect, it } from 'vitest';
import { repoHintFromTool, repoRoomOf } from './repo-room';

const ROOTS = ['/data/OpenBot/Shared/Github'];
const REPO = '/data/OpenBot/Shared/Github/habblaud';

describe('repoRoomOf', () => {
  it('arquivo e subpasta dentro de um repositório valem o repositório', () => {
    expect(repoRoomOf(`${REPO}/server/config.ts`, ROOTS)).toBe(REPO);
    expect(repoRoomOf(`${REPO}/server/model`, ROOTS)).toBe(REPO);
    expect(repoRoomOf(REPO, ROOTS)).toBe(REPO);
  });

  it('a própria raiz e caminhos fora dela não são repositório', () => {
    expect(repoRoomOf('/data/OpenBot/Shared/Github', ROOTS)).toBeUndefined();
    expect(repoRoomOf('/data/OpenBot/Shared/Github/', ROOTS)).toBeUndefined();
    expect(repoRoomOf('/data/OpenBot/Shared/escritorio-virtual/02-desenho-tecnico.md', ROOTS)).toBeUndefined();
    expect(repoRoomOf('/data/OpenBot/Shared/GithubX/habblaud', ROOTS)).toBeUndefined();
  });

  it('normaliza .., // e barra final', () => {
    expect(repoRoomOf(`${REPO}/../habblaud2/x`, ROOTS)).toBe('/data/OpenBot/Shared/Github/habblaud2');
    expect(repoRoomOf('/data/OpenBot/Shared//Github//habblaud//a', ROOTS)).toBe(REPO);
    expect(repoRoomOf(`${REPO}/a/../..`, ROOTS)).toBeUndefined();
  });

  it('segmento vazio ou oculto não é repositório', () => {
    expect(repoRoomOf('/data/OpenBot/Shared/Github/.oculto/x', ROOTS)).toBeUndefined();
    expect(repoRoomOf('/data/OpenBot/Shared/Github/.git', ROOTS)).toBeUndefined();
  });

  it('caminho relativo não vale', () => {
    expect(repoRoomOf('habblaud/server/config.ts', ROOTS)).toBeUndefined();
  });

  it('aceita várias raízes e ignora raízes vazias', () => {
    const roots = ['', '/data/outra', '/data/OpenBot/Shared/Github/'];
    expect(repoRoomOf('/data/outra/proj/a.ts', roots)).toBe('/data/outra/proj');
    expect(repoRoomOf(`${REPO}/a.ts`, roots)).toBe(REPO);
  });

  it('sem raízes não há repositório', () => {
    expect(repoRoomOf(`${REPO}/a.ts`, [])).toBeUndefined();
  });
});

describe('repoHintFromTool', () => {
  it('Read, Edit, Write e MultiEdit usam file_path', () => {
    for (const tool of ['Read', 'Edit', 'Write', 'MultiEdit']) {
      expect(repoHintFromTool(tool, { file_path: `${REPO}/a.ts` }, ROOTS)).toBe(REPO);
    }
  });

  it('NotebookEdit usa notebook_path; Glob e Grep usam path', () => {
    expect(repoHintFromTool('NotebookEdit', { notebook_path: `${REPO}/n.ipynb` }, ROOTS)).toBe(REPO);
    expect(repoHintFromTool('Glob', { pattern: '**/*.ts', path: REPO }, ROOTS)).toBe(REPO);
    expect(repoHintFromTool('Grep', { pattern: 'x', path: REPO }, ROOTS)).toBe(REPO);
  });

  it('ferramenta sem caminho ou fora da lista não gera evidência', () => {
    expect(repoHintFromTool('Agent', { prompt: `${REPO}/a.ts` }, ROOTS)).toBeUndefined();
    expect(repoHintFromTool('Glob', { pattern: '**/*.ts' }, ROOTS)).toBeUndefined();
    expect(repoHintFromTool('Read', null, ROOTS)).toBeUndefined();
    expect(repoHintFromTool('Read', { file_path: 42 }, ROOTS)).toBeUndefined();
  });

  it('Bash: cd, git -C e argumentos citando o repositório', () => {
    expect(repoHintFromTool('Bash', { command: `cd ${REPO} && npm test` }, ROOTS)).toBe(REPO);
    expect(repoHintFromTool('Bash', { command: `git -C ${REPO} status` }, ROOTS)).toBe(REPO);
    expect(repoHintFromTool('Bash', { command: `cat "${REPO}/a.ts"` }, ROOTS)).toBe(REPO);
    expect(repoHintFromTool('Bash', { command: 'ls /data/OpenBot/Shared/Github' }, ROOTS)).toBeUndefined();
    expect(repoHintFromTool('Bash', { command: 'echo oi' }, ROOTS)).toBeUndefined();
  });

  it('Bash com dois repositórios: vale o primeiro', () => {
    const cmd = `cp /data/OpenBot/Shared/Github/alfa/x /data/OpenBot/Shared/Github/beta/y`;
    expect(repoHintFromTool('Bash', { command: cmd }, ROOTS)).toBe('/data/OpenBot/Shared/Github/alfa');
  });

  it('Bash ignora caminho que apenas termina com a raiz', () => {
    const cmd = `ls /x/data/OpenBot/Shared/Github/habblaud`;
    expect(repoHintFromTool('Bash', { command: cmd }, ROOTS)).toBeUndefined();
  });

  it('sem raízes configuradas nenhum sinal é emitido', () => {
    expect(repoHintFromTool('Read', { file_path: `${REPO}/a.ts` }, [])).toBeUndefined();
    expect(repoHintFromTool('Bash', { command: `cd ${REPO}` }, [])).toBeUndefined();
  });
});
