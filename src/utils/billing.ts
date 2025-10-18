import { BASE } from './constants.js';
import config from '../../config.json' with { type: 'json' };

interface BillResponse {
  msg: string;
  code: number;
  map: { showData: { 信息: string }; data: { room: string } };
}

/**
 * Fetch bills with retry logic
 * @param token Access token for authentication
 * @param retryCount Number of retries (defaults to config value)
 * @returns Billing data or throws error
 */
export const getBills = async (token: string, retryCount: number = config.billingRetryCount) => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const feeitemids = Array.from({ length: 3 }, (_, i) => i + 1); // electric, ac, water

      const responses = await Promise.all(
        feeitemids.map((id) =>
          fetch(
            `${BASE}/charge/feeitem/getThirdDataByFeeItemId?feeitemid=${id}&synAccessSource=h5`,
            {
              method: 'GET',
              headers: {
                'Synjones-Auth': `bearer ${token}`
              }
            }
          )
        )
      );

      // Check if any response is not ok
      const failedResponse = responses.find((r) => !r.ok);
      if (failedResponse) {
        throw new Error(`HTTP ${failedResponse.status}: ${failedResponse.statusText}`);
      }

      const data = (await Promise.all(responses.map((r) => r.json()))) as BillResponse[];

      // Check if any response indicates an error
      const errorResponse = data.find((d) => d.code !== 200);
      if (errorResponse) {
        throw new Error(`API Error ${errorResponse.code}: ${errorResponse.msg}`);
      }

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
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < retryCount) {
        console.log(`[Billing] Attempt ${attempt + 1} failed: ${lastError.message}. Retrying...`);
        // Optional: Add a small delay between retries
        await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      }
    }
  }

  // If we've exhausted all retries, throw the last error
  throw lastError || new Error('Failed to fetch bills after all retries');
};
