export type CommunityJsonbFixture = {
  name: string;
  seed: Record<string, unknown> | unknown[];
  expectedSeedJsonbText: string;
};

export const communityJsonbFixtures: readonly CommunityJsonbFixture[] = [
  {
    name: 'nested multi-key arrays',
    seed: { alpha: { first: [1, 'two'], second: [true, null] }, omega: ['end'] },
    expectedSeedJsonbText:
      '{"alpha": {"first": [1, "two"], "second": [true, null]}, "omega": ["end"]}'
  },
  {
    name: 'empty object and array branches',
    seed: { object: {}, array: [] },
    expectedSeedJsonbText: '{"object": {}, "array": []}'
  },
  {
    name: 'escaped keys and values',
    seed: { 'quote"\\': 'line\n tab\t control\b\f\r' },
    expectedSeedJsonbText: '{"quote\\\"\\\\": "line\\n tab\\t control\\b\\f\\r"}'
  },
  {
    name: 'Cyrillic and astral text',
    seed: { ключ: '🎾 ракетка', '🧡': '𐐷' },
    expectedSeedJsonbText: '{"ключ": "🎾 ракетка", "🧡": "𐐷"}'
  },
  {
    name: 'exponential 1e21',
    seed: { value: 1e21 },
    expectedSeedJsonbText: '{"value": 1000000000000000000000}'
  },
  {
    name: 'exponential 1e-7',
    seed: { value: 1e-7 },
    expectedSeedJsonbText: '{"value": 0.0000001}'
  },
  {
    name: 'smallest subnormal',
    seed: { value: 5e-324 },
    expectedSeedJsonbText: `{"value": 0.${'0'.repeat(323)}5}`
  },
  { name: 'negative zero', seed: { value: -0 }, expectedSeedJsonbText: '{"value": 0}' },
  {
    name: 'mixed nested number string and container',
    seed: { match: { score: [1e-7, '🎾', { won: true }] } },
    expectedSeedJsonbText: '{"match": {"score": [0.0000001, "🎾", {"won": true}]}}'
  }
];

export function buildFixtureAtBytes(
  descriptor: CommunityJsonbFixture,
  targetBytes: 4095 | 4096 | 4097
): Record<string, unknown> {
  const baseBytes = Buffer.byteLength(
    '{"fixture": ' + descriptor.expectedSeedJsonbText + ', "padding": ""}',
    'utf8'
  );
  const paddingBytes = targetBytes - baseBytes;
  if (paddingBytes < 0) {
    throw new Error(
      `Fixture ${descriptor.name} exceeds target ${targetBytes} bytes before padding`
    );
  }
  return { fixture: descriptor.seed, padding: 'a'.repeat(paddingBytes) };
}

export function compactJsonBytes(settings: unknown): number {
  return Buffer.byteLength(JSON.stringify(settings), 'utf8');
}
