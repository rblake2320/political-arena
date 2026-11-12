import { afterEach, expect, it, vi } from 'vitest';
import axios from 'axios';
import { getRaces } from '../src/api';
import { US_STATES } from '../src/us-states';

afterEach(() => vi.restoreAllMocks());
const response = (races: unknown[], total: number) => ({ data: { success: true, data: { races, total } } });
function mockPages(pages: ReturnType<typeof response>[]) {
  const get = vi.fn();
  for (const page of pages) get.mockResolvedValueOnce(page);
  // The module-created axios instance dispatches through Axios.prototype.request.
  vi.spyOn(axios.Axios.prototype, 'request').mockImplementation(get);
  return get;
}
it('offers all 50 states plus DC even without race records', () => {
  expect(US_STATES.length).toBe(51);
  expect(new Set(US_STATES).size).toBe(51);
  expect(US_STATES).toContain('AK');
  expect(US_STATES).toContain('DC');
});
it('loads records past the old 600-race cutoff', async () => {
  const rows = Array.from({ length: 601 }, (_, i) => ({ id: `r${i}` }));
  const get = mockPages([0,200,400,600].map(start => response(rows.slice(start,start+200),601)));
  const result = await getRaces('name');
  expect(result.races).toEqual(rows);
  expect(result.total).toBe(601);
  expect(get).toHaveBeenCalledTimes(4);
});
it('fails rather than returning an incomplete directory', async () => {
  mockPages([response([{ id: 'r1' }],2),response([],2)]);
  await expect(getRaces()).rejects.toThrow('Incomplete');
});
it('fails on duplicated pages', async () => {
  mockPages([response([{ id: 'r1' }],2),response([{ id: 'r1' }],2)]);
  await expect(getRaces()).rejects.toThrow('Duplicate');
});
it('fails if the total changes between pages', async () => {
  mockPages([response([{ id: 'r1' }],2),response([{ id: 'r2' }],3)]);
  await expect(getRaces()).rejects.toThrow('changed');
});
