import { BASE } from './constants.js';

interface BillResponse {
  msg: string;
  code: number;
  map: { showData: { 信息: string }; data: { room: string } };
}

export const getBills = async (token: string) => {
  const feeitemids = Array.from({ length: 3 }, (_, i) => i + 1); // electric, ac, water

  const responses = await Promise.all(
    feeitemids.map((id) =>
      fetch(`${BASE}/charge/feeitem/getThirdDataByFeeItemId?feeitemid=${id}&synAccessSource=h5`, {
        method: 'GET',
        headers: {
          'Synjones-Auth': `bearer ${token}`
        }
      })
    )
  );

  const data = (await Promise.all(responses.map((r) => r.json()))) as BillResponse[];

  const parseBill = (billData: BillResponse, isWater: boolean) => {
    const raw = isWater
      ? (billData.map.showData.信息.split(',').pop() || '0').trim()
      : billData.map.showData.信息.trim();
    const match = raw.match(/[-\d.]+/);
    return parseFloat(match ? match[0] : '0');
  };

  const electric = parseBill(data[0], false);
  const water = parseBill(data[2], true);
  const ac = parseBill(data[1], false);
  const room = data[0].map.data.room;

  return { water, ac, electric, room };
};
