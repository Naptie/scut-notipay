import { CARD_BASE, DFYC_BASE, NORETRY_ERROR_PREFIX } from './constants.js';
import config from '../../config.json' with { type: 'json' };
import type { Campus } from './database.js';
import { fetch } from './fetch.js';

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
export const getBills = async (
  token: string,
  TGC: string,
  locSession: string,
  campus: Campus,
  retryCount: number = config.billingRetryCount
) => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      return await (campus === 'GZIC' ? getBillsGZIC(token) : getBillsDXC(token, TGC, locSession));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message.startsWith(NORETRY_ERROR_PREFIX)) {
        console.error(
          `[Billing] Non-retriable error encountered: ${lastError.message.replace(
            NORETRY_ERROR_PREFIX,
            ''
          )}`
        );
        break;
      }
      lastError.message = lastError.message.replace(NORETRY_ERROR_PREFIX, '');

      if (attempt < retryCount) {
        console.debug(`[Billing] Attempt ${attempt + 1} failed: ${lastError.message}. Retrying...`);
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      } else {
        console.error(`[Billing] All ${retryCount + 1} attempts failed.`);
      }
    }
  }

  // If we've exhausted all retries, throw the last error
  throw lastError || new Error('Failed to fetch bills after all retries');
};

const getBillsGZIC = async (token: string) => {
  const feeitemids = Array.from({ length: 3 }, (_, i) => i + 1); // electric, ac, water

  const responses = await Promise.all(
    feeitemids.map((id) =>
      fetch(
        `${CARD_BASE}/charge/feeitem/getThirdDataByFeeItemId?feeitemid=${id}&synAccessSource=h5`,
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
    const retryIndicator = failedResponse.status === 401 ? NORETRY_ERROR_PREFIX : '';
    throw new Error(retryIndicator + `HTTP ${failedResponse.status}: ${failedResponse.statusText}`);
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
};

const getBillsDXC = async (token: string, TGC: string, locSession: string) => {
  let jsessionid = '';

  // redirect
  const redirectResponse = await fetch(
    `${CARD_BASE}/berserker-base/redirect?appId=360&loginFrom=h5&synAccessSource=h5&synjones-auth=${token}&type=app`,
    {
      method: 'GET',
      redirect: 'manual', // Don't auto-follow redirects
      headers: {
        Cookie: `TGC=${TGC}; error_times=0; locSession=${locSession}`
      }
    }
  );

  if (redirectResponse.status !== 302) {
    throw new Error(`Get redirect failed: Expected 302, got ${redirectResponse.status}`);
  }

  // thirdLogin
  const thirdLoginUrl = httpToHttps(redirectResponse.headers.get('location'));
  if (!thirdLoginUrl) {
    throw new Error('Get redirect: No redirect location found');
  }

  const thirdLoginResponse = await fetch(thirdLoginUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Cookie: `TGC=${TGC}; locSession=${locSession}; error_times=0`
    }
  });

  const setCookie = thirdLoginResponse.headers.get('set-cookie');
  if (setCookie) {
    const match = setCookie.match(/JSESSIONID=([^;]+)/);
    if (match) {
      jsessionid = match[1];
    }
  }
  if (!jsessionid) {
    throw new Error('Get thirdLogin: Failed to get JSESSIONID cookie');
  }

  if (thirdLoginResponse.status !== 302) {
    throw new Error(`Get thirdLogin failed: Expected 302, got ${thirdLoginResponse.status}`);
  }

  // authorize
  const authorizeUrl = httpToHttps(thirdLoginResponse.headers.get('location'));
  if (!authorizeUrl) {
    throw new Error('Get thirdLogin: No redirect location found');
  }

  const authorizeResponse = await fetch(authorizeUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Cookie: `JSESSIONID=${jsessionid}; TGC=${TGC}; locSession=${locSession}; error_times=0`
    }
  });

  if (authorizeResponse.status !== 302) {
    throw new Error(`Get authorize failed: Expected 302, got ${authorizeResponse.status}`);
  }

  // getCode
  const getCodeUrl = httpToHttps(authorizeResponse.headers.get('location'));
  if (!getCodeUrl) {
    throw new Error('Get authorize: No redirect location found');
  }

  const getCodeUrlResponse = await fetch(getCodeUrl, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Cookie: `JSESSIONID=${jsessionid}; TGC=${TGC}; locSession=${locSession}; error_times=0`
    }
  });

  if (getCodeUrlResponse.status !== 302) {
    throw new Error(`Get getCode failed: Expected 302, got ${getCodeUrlResponse.status}`);
  }

  if (getCodeUrlResponse.headers.get('location') !== '/sdms-weixin-pay-sp/newWeixin/index.html') {
    throw new Error(
      `Get getCode failed: Expected redirect to index, got ${getCodeUrlResponse.headers.get('location')}`
    );
  }

  // *** All auth completed ***

  // userInfo
  const userInfoResponse = await fetch(`${DFYC_BASE}/sdms-weixin-pay-sp/service/find/userinfo`, {
    method: 'GET',
    headers: {
      Cookie: `JSESSIONID=${jsessionid}`
    }
  });
  if (!userInfoResponse.ok) {
    const retryIndicator = userInfoResponse.status === 401 ? NORETRY_ERROR_PREFIX : '';
    throw new Error(retryIndicator + `Get userInfo failed: HTTP ${userInfoResponse.status}`);
  }
  const userInfo = await userInfoResponse.json();
  if (userInfo.statusCode !== '200') {
    throw new Error(`Get userInfo API Error: ${userInfo.message || 'Unknown error'}`);
  }
  const room = userInfo.resultObject.roomName;

  // ammeterBalance
  const ammeterBalanceResponse = await fetch(
    `${DFYC_BASE}/sdms-weixin-pay-sp/service/ammeterBalance?type=1`,
    {
      method: 'GET',
      headers: {
        Cookie: `JSESSIONID=${jsessionid}`
      }
    }
  );
  if (!ammeterBalanceResponse.ok) {
    const retryIndicator = ammeterBalanceResponse.status === 401 ? NORETRY_ERROR_PREFIX : '';
    throw new Error(
      retryIndicator + `Get ammeterBalanceResponse failed: HTTP ${ammeterBalanceResponse.status}`
    );
  }
  const electricData = await ammeterBalanceResponse.json();
  if (electricData.statusCode !== '200') {
    throw new Error(
      `Get ammeterBalanceResponse API Error: ${electricData.message || 'Unknown error'}`
    );
  }
  const electric = parseFloat(electricData.resultObject.leftMoney.toString());

  // waterBalance
  const waterBalanceResponse = await fetch(
    `${DFYC_BASE}/sdms-weixin-pay-sp/service/waterBalance?type=3&systemType=1`,
    {
      method: 'GET',
      headers: {
        Cookie: `JSESSIONID=${jsessionid}`
      }
    }
  );
  if (!waterBalanceResponse.ok) {
    const retryIndicator = waterBalanceResponse.status === 401 ? NORETRY_ERROR_PREFIX : '';
    throw new Error(
      retryIndicator + `Get waterBalance failed: HTTP ${waterBalanceResponse.status}`
    );
  }
  const waterData = await waterBalanceResponse.json();
  if (waterData.statusCode !== '200') {
    throw new Error(`Get waterBalance API Error: ${waterData.message || 'Unknown error'}`);
  }
  const water = parseFloat(waterData.resultObject.leftMoney);

  const ac = 0; // DXC campus has no AC balance

  return { water, ac, electric, room };
};

const httpToHttps = (url: string | null): string | null => {
  if (!url) {
    return null;
  }
  return url.replace(/^http:/, 'https:');
};
