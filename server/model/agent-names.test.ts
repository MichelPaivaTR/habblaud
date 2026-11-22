import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { agentIdFromCwd, AgentNames, fallbackAgentName, overrideFileOf } from './agent-names';

const ID = 'agent-3d36e8ea-5d84-4d50-9be7-d88973e927bc';

describe('agentIdFromCwd', () => {
  it('pasta do agente e subpastas dela', () => {
    expect(agentIdFromCwd(`/data/OpenBot/Agents/${ID}`)).toBe(ID);
    expect(agentIdFromCwd(`/data/OpenBot/Agents/${ID}/sub/pasta`)).toBe(ID);
  });

  it('outras pastas e ids inválidos não são de agente', () => {
    expect(agentIdFromCwd('/data/OpenBot/Agents')).toBeUndefined();
    expect(agentIdFromCwd('/data/OpenBot/Shared/Github/habblaud')).toBeUndefined();
    expect(agentIdFromCwd(`/data/OpenBot/Agents/${ID}x`)).toBeUndefined();
    expect(agentIdFromCwd('/data/OpenBot/Agents/agent-curto')).toBeUndefined();
  });
});

describe('fallbackAgentName', () => {
  it('agent- e os 8 primeiros caracteres do uuid', () => {
    expect(fallbackAgentName(ID)).toBe('agent-3d36e8ea');
  });
});

describe('overrideFileOf', () => {
  it('troca .json por .override.json ao lado', () => {
    expect(overrideFileOf('/x/agent-names.json')).toBe('/x/agent-names.override.json');
  });
});

describe('AgentNames', () => {
  let tmp: { dir: string; cleanup: () => void };
  let clock: number;
  beforeEach(() => {
    tmp = tempDir();
    clock = 1_000_000;
  });
  afterEach(() => tmp.cleanup());

  const file = () => join(tmp.dir, 'agent-names.json');
  const names = () => new AgentNames(file(), () => clock);

  it('arquivo ausente: mapa vazio, sem exceção', () => {
    expect(names().nameOf(ID)).toBeUndefined();
  });

  it('JSON inválido ou sem o campo agents: mapa vazio, sem exceção', () => {
    writeFileSync(file(), '{ não é json');
    expect(names().nameOf(ID)).toBeUndefined();
    writeFileSync(file(), JSON.stringify({ version: 1 }));
    expect(names().nameOf(ID)).toBeUndefined();
  });

  it('lê id → nome e ignora valores que não são texto', () => {
    writeFileSync(file(), JSON.stringify({ version: 1, agents: { [ID]: 'Faísca', outro: 3 } }));
    const n = names();
    expect(n.nameOf(ID)).toBe('Faísca');
    expect(n.nameOf('outro')).toBeUndefined();
  });

  it('o override vence sobre o arquivo exportado', () => {
    writeFileSync(file(), JSON.stringify({ agents: { [ID]: 'Faísca' } }));
    writeFileSync(overrideFileOf(file()), JSON.stringify({ agents: { [ID]: 'Faísca 2.0' } }));
    expect(names().nameOf(ID)).toBe('Faísca 2.0');
  });

  it('recarrega quando o arquivo muda, no máximo a cada 30 s', () => {
    writeFileSync(file(), JSON.stringify({ agents: { [ID]: 'Faísca' } }));
    const n = names();
    expect(n.nameOf(ID)).toBe('Faísca');
    writeFileSync(file(), JSON.stringify({ agents: { [ID]: 'Faísca Nova' } }));
    expect(n.nameOf(ID)).toBe('Faísca');
    clock += 30_000;
    expect(n.nameOf(ID)).toBe('Faísca Nova');
  });
});
