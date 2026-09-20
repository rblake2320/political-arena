import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as api from '../src/api';
import { useArenaStore } from '../src/store';

vi.mock('../src/api', () => ({ getRaces: vi.fn() }));
const getRaces = vi.mocked(api.getRaces);
const race = { id: 'fixture', name: 'Fixture race', candidate_count: 0 };

beforeEach(() => {
  getRaces.mockReset();
  useArenaStore.setState({ races: [], raceTotal: 0, raceError: null, _raceRequest: 0 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

it('exposes a failed refresh, retains cached races, and clears the error on retry', async () => {
  useArenaStore.setState({ races: [race as any], raceTotal: 1 });
  getRaces.mockRejectedValueOnce(new Error('offline'));
  await useArenaStore.getState().fetchRaces();
  expect(useArenaStore.getState().raceError).toContain('could not be refreshed');
  expect(useArenaStore.getState().races).toEqual([race]);
  getRaces.mockResolvedValueOnce({ races: [], total: 0 });
  await useArenaStore.getState().fetchRaces();
  expect(useArenaStore.getState().raceError).toBeNull();
  expect(useArenaStore.getState().races).toEqual([]);
  expect(useArenaStore.getState().raceTotal).toBe(0);
});

it('does not let an older sort overwrite the latest response', async () => {
  let finish!: (value: any) => void;
  getRaces.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const older = useArenaStore.getState().fetchRaces('trending');
  getRaces.mockResolvedValueOnce({ races: [race] as any, total: 9 });
  await useArenaStore.getState().fetchRaces('state');
  finish({ races: [], total: 0 });
  await older;
  expect(useArenaStore.getState().races).toEqual([race]);
  expect(useArenaStore.getState().raceTotal).toBe(9);
});

it('ignores a stale failure after a newer successful refresh', async () => {
  let fail!: (reason: Error) => void;
  getRaces.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const older = useArenaStore.getState().fetchRaces('trending');
  getRaces.mockResolvedValueOnce({ races: [race] as any, total: 1 });
  await useArenaStore.getState().fetchRaces('state');
  fail(new Error('late failure'));
  await older;
  expect(useArenaStore.getState().raceError).toBeNull();
  expect(useArenaStore.getState().races).toEqual([race]);
});
