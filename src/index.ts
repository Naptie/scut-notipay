import { execSync } from 'child_process';
import { NCWebsocket } from 'node-napcat-ts';
import type { AllHandlers, SendMessageSegment } from 'node-napcat-ts';
import config from '../config.json' with { type: 'json' };
import { obtainToken as login } from './utils/session.js';
import { getBills } from './utils/billing.js';
import { db, scheduler, type Campus } from './utils/database.js';
import { generateBillingCharts, generateBillingSummary } from './utils/presentation.js';
import { APP_NAME, CAMPUSES, DATA_COLLECTION_BATCH_SIZE, GITHUB_LINK } from './utils/constants.js';

let commitHash: string;
try {
  commitHash = execSync('git rev-parse HEAD').toString().trim().slice(0, 7);
} catch (e) {
  console.error('Failed to get git commit hash:', e);
  commitHash = 'unknown';
}

/**
 * Parse a time parameter from user input (using local time UTC+8)
 * Supports formats like:
 * - "7h" (7 hours ago)
 * - "3d" (3 days ago)
 * - "2w" (2 weeks ago)
 * - "1030" (Oct 30 00:00)
 * - "10302330" (Oct 30 23:30)
 * - "10-30|23:30" (with delimiters)
 */
const parseTimeParameter = (param: string): Date => {
  // Get current time in local timezone (UTC+8)
  const now = new Date();

  // Remove all non-digit and non-letter characters for initial check
  const cleanParam = param.replace(/[^0-9a-zA-Z]/g, '');

  // Check if it ends with time unit (h, d, w)
  const unitMatch = cleanParam.match(/^(\d+)([hdw])$/i);
  if (unitMatch) {
    const value = parseInt(unitMatch[1], 10);
    const unit = unitMatch[2].toLowerCase();

    // Create a new date and subtract time
    const result = new Date(now);
    if (unit === 'h') {
      result.setHours(result.getHours() - value);
    } else if (unit === 'd') {
      result.setDate(result.getDate() - value);
    } else if (unit === 'w') {
      result.setDate(result.getDate() - value * 7);
    }
    return result;
  }

  // Check for delimiters (-, /, :, |, space) to parse as date/time
  const hasDelimiters = /[-/::\s|]/.test(param);

  if (hasDelimiters) {
    // Split by delimiters and extract numbers
    const parts = param.split(/[-/::\s|]+/).filter((p) => p.trim());

    if (parts.length < 2) {
      throw new Error('日期格式不正确，需要至少包含月份和日期');
    }

    // Parse as: month day [hour] [minute]
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    const hour = parts.length > 2 ? parseInt(parts[2], 10) : 0;
    const minute = parts.length > 3 ? parseInt(parts[3], 10) : 0;

    if (isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
      throw new Error('日期格式不正确');
    }

    if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new Error('时间格式不正确');
    }

    // Create date in local timezone
    const result = new Date(now.getFullYear(), month - 1, day, hour, minute, 0, 0);

    // If the parsed date is in the future, assume it's from last year
    if (result > now) {
      result.setFullYear(result.getFullYear() - 1);
    }

    return result;
  }

  // Parse as continuous digits (e.g., "1030" or "10302330")
  const digitsOnly = cleanParam;

  if (digitsOnly.length < 4) {
    // Less than 4 digits, treat as hours with default unit
    const hours = parseInt(digitsOnly, 10);
    if (isNaN(hours)) {
      throw new Error('时间参数格式不正确');
    }
    const result = new Date(now);
    result.setHours(result.getHours() - hours);
    return result;
  }

  // 4 or more digits: parse as MMDD or MMDDHHMM
  const month = parseInt(digitsOnly.substring(0, 2), 10);
  const day = parseInt(digitsOnly.substring(2, 4), 10);

  let hour = 0;
  let minute = 0;

  if (digitsOnly.length >= 6) {
    hour = parseInt(digitsOnly.substring(4, 6), 10);
  }
  if (digitsOnly.length >= 8) {
    minute = parseInt(digitsOnly.substring(6, 8), 10);
  }

  if (isNaN(month) || isNaN(day) || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error('日期格式不正确');
  }

  if (isNaN(hour) || isNaN(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('时间格式不正确');
  }

  // Create date in local timezone
  const result = new Date(now.getFullYear(), month - 1, day, hour, minute, 0, 0);

  // If the parsed date is in the future, assume it's from last year
  if (result > now) {
    result.setFullYear(result.getFullYear() - 1);
  }

  return result;
};

/**
 * Store an access token for a user
 */
const storeToken = (
  qqId: string,
  accessToken: string,
  TGC: string,
  loc_session: string,
  expiresIn: number
) => {
  db.updateTokens(qqId, accessToken, TGC, loc_session, expiresIn);
  console.log(`[Token] Stored token for QQ ${qqId}, expires in ${expiresIn}s`);
};

/**
 * Get a valid access token for a user
 * Uses cached token if available and valid, otherwise obtains a new one
 */
const getValidToken = async (qqId: string): Promise<[string, string, string]> => {
  // Try to get stored token
  const storedToken = db.getTokens(qqId);
  if (storedToken) {
    return storedToken;
  }

  // No valid stored token, need to login
  const credentials = db.getCredentials(qqId);
  if (!credentials) {
    throw new Error('No credentials found for user');
  }

  const result = await login(credentials.cardId, credentials.password);
  if (result === null) {
    throw new Error('Login failed');
  }

  // Store the new token
  storeToken(qqId, result.access_token, result.TGC, result.locSession, result.expires_in);

  return [result.access_token, result.TGC, result.locSession];
};

/**
 * Get the user's campus
 */
const getCampus = (qqId: string): Campus => {
  const result = db.getCampus(qqId);

  if (!result) {
    throw new Error('No campus found for user');
  }

  return result;
};

/**
 * Get bills with automatic token refresh on failure
 */
const getBillsWithTokenRefresh = async (qqId: string) => {
  try {
    // First attempt with cached token
    const [token, TGC, locSession] = await getValidToken(qqId);
    return await getBills(token, TGC, locSession, getCampus(qqId));
  } catch {
    // If getBills failed, the token might be invalid despite not being expired
    // Clear the token and try once more with a fresh login
    db.clearAccessToken(qqId);

    const credentials = db.getCredentials(qqId);
    if (!credentials) {
      throw new Error('No credentials found for user');
    }

    const result = await login(credentials.cardId, credentials.password);
    if (result === null) {
      throw new Error('Login failed');
    }
    storeToken(qqId, result.access_token, result.TGC, result.locSession, result.expires_in);

    // Retry with fresh token
    return await getBills(result.access_token, result.TGC, result.locSession, getCampus(qqId));
  }
};

const napcat = new NCWebsocket(
  {
    baseUrl: config.napcatWs,
    accessToken: config.napcatToken,
    throwPromise: true,
    reconnection: {
      enable: true,
      attempts: 10,
      delay: 5000
    }
  },
  false
);

// Small generic signallable promise: call `signal()` to resolve the promise.
const createSignallable = <T>() => {
  // start with a noop resolver to avoid definite-assignment / non-null assertions
  let resolver: (value: T) => void = () => undefined as unknown as void;
  const promise = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return {
    promise,
    signal(value: T) {
      resolver(value);
    }
  } as { promise: Promise<T>; signal: (value: T) => void };
};

const socketClose = createSignallable<void>();

napcat.on('socket.open', () => {
  console.log('[NapCat] Connected.');
  startHourlyTimer();
});

napcat.on('socket.close', () => {
  console.log('[NapCat] Disconnected.');
  try {
    socketClose.signal(undefined);
  } catch {
    // ignore if already resolved
  }
});

const parseMessage = (context: AllHandlers['message']) => {
  const message = context.message.find((m) => m.type === 'text');
  if (!message) return { command: null, args: null };
  const text = message.data.text;
  const segments = text
    .split(/\s+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!segments.length) return { command: null, args: null };
  const command = segments[0];
  if (!config.commandNames.includes(command)) return { command: null, args: null };
  return { command, args: segments.slice(1) };
};

// Combined timer for data collection and notifications
let hourlyInterval: NodeJS.Timeout | null = null;

/**
 * Type for collected student billing data
 */
type CollectedData = {
  qqId: string;
  name: string | null | undefined;
  electric: number;
  water: number;
  ac: number;
  room: string;
  success: boolean;
  error?: Error;
};

/**
 * Collect billing data for a single student
 */
const collectStudentData = async (student: {
  qq_id: string;
  name?: string | null;
  student_number?: string;
}): Promise<CollectedData> => {
  try {
    // Get credentials
    const credentials = db.getCredentials(student.qq_id);
    if (!credentials) {
      console.log(`[Scheduler] No credentials for QQ ${student.qq_id}, skipping`);
      return {
        qqId: student.qq_id,
        name: student.name,
        electric: 0,
        water: 0,
        ac: 0,
        room: '',
        success: false,
        error: new Error('No credentials found')
      };
    }

    // Get bills with automatic token management
    const { electric, ac, water, room } = await getBillsWithTokenRefresh(student.qq_id);

    // Record billing history
    db.addBillingHistory(student.qq_id, electric, water, ac, room);
    console.log(`[Scheduler] Collected data for ${student.name || student.qq_id} (${room})`);
    db.updateLastLogin(student.qq_id);

    return {
      qqId: student.qq_id,
      name: student.name,
      electric,
      water,
      ac,
      room,
      success: true
    };
  } catch (error) {
    console.error(`[Scheduler] Failed to collect data for QQ ${student.qq_id}:`, error);
    return {
      qqId: student.qq_id,
      name: student.name,
      electric: 0,
      water: 0,
      ac: 0,
      room: '',
      success: false,
      error: error instanceof Error ? error : new Error(String(error))
    };
  }
};

/**
 * Process students in parallel batches
 */
const collectData = async (
  students: { qq_id: string; name?: string | null; student_number?: string }[],
  batchSize: number
): Promise<CollectedData[]> => {
  const results: CollectedData[] = [];

  for (let i = 0; i < students.length; i += batchSize) {
    const batch = students.slice(i, i + batchSize);
    console.log(
      `[Scheduler] Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(students.length / batchSize)} (${batch.length} students)`
    );

    const batchResults = await Promise.all(batch.map((student) => collectStudentData(student)));
    results.push(...batchResults);

    // Small delay between batches to avoid overwhelming the server
    if (i + batchSize < students.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return results;
};

/**
 * Send notifications for a student based on collected data
 */
const sendNotificationForStudent = async (
  collectedData: CollectedData,
  currentHour: number
): Promise<void> => {
  if (!collectedData.success) {
    console.log(
      `[Scheduler] Skipping notifications for ${collectedData.name || collectedData.qqId} due to data collection failure`
    );
    return;
  }

  const { qqId, name, electric, water, ac, room } = collectedData;
  const notifications = scheduler.getNotificationsAtHourForUser(qqId, currentHour);

  for (const notification of notifications) {
    try {
      // Check if threshold is set and if any balance is below it
      let shouldSendNotification = true;
      if (notification.threshold !== null && notification.threshold !== undefined) {
        // Only send if any balance drops below the threshold
        const threshold = notification.threshold;
        shouldSendNotification =
          (electric >= -10 && electric < threshold) ||
          (water >= -10 && water < threshold) ||
          (ac >= -10 && ac < threshold);

        if (!shouldSendNotification) {
          continue;
        }
      }

      console.log(`[Scheduler] Sending notification to ${name || qqId} (${room})`);

      // Get 24h change
      const change24h = db.getBilling24HourChange(qqId);

      // Get history for chart
      const history = db.getBillingHistory(qqId, 7);

      // Generate summary
      let messageText = `🏠 ${room}\n\n`;
      messageText += generateBillingSummary({ electric, water, ac }, change24h || undefined);

      // Build message segments
      const messageSegments: SendMessageSegment[] = [{ type: 'text', data: { text: messageText } }];

      // Add chart images
      if (history.length >= 2) {
        const chartData = history.reverse().map((h) => ({
          timestamp: h.recorded_at,
          electric: h.electric,
          water: h.water,
          ac: h.ac
        }));

        const charts = await generateBillingCharts(chartData, room);
        for (const chart of charts) {
          const base64Image = `base64://${chart.buffer.toString('base64')}`;
          messageSegments.push({ type: 'image', data: { file: base64Image } });
        }
      }

      // Send message
      if (notification.chat_type && notification.chat_id) {
        if (notification.chat_type === 'private') {
          await napcat.send_private_msg({
            user_id: parseInt(notification.chat_id),
            message: messageSegments
          });
        } else {
          await napcat.send_group_msg({
            group_id: parseInt(notification.chat_id),
            message: messageSegments
          });
        }
        console.log(
          `[Scheduler] Sent notification to ${notification.chat_type} ${notification.chat_id}`
        );
      }
    } catch (error) {
      console.error(
        `[Scheduler] Failed to send notification for QQ ${qqId} to ${notification.chat_type} ${notification.chat_id}:`,
        error
      );
    }
  }
};

const runHourlyTasks = async () => {
  try {
    const currentHour = new Date().getHours();
    console.log(`[Scheduler] Running for hour: ${currentHour}`);

    // Get all students with their notification settings
    const students = db.getAllStudents();
    console.log(`[Scheduler] Checking ${students.length} students`);

    if (students.length === 0) {
      console.log('[Scheduler] No students to process');
      return;
    }

    // Phase 1: Collect data in parallel batches
    console.log(
      `[Scheduler] Phase 1: Collecting data (batch size: ${DATA_COLLECTION_BATCH_SIZE})...`
    );
    const collectedData = await collectData(students, DATA_COLLECTION_BATCH_SIZE);
    const successCount = collectedData.filter((d) => d.success).length;
    const failureCount = collectedData.length - successCount;
    console.log(
      `[Scheduler] Data collection complete: ${successCount} succeeded, ${failureCount} failed`
    );

    // Phase 2: Send notifications serially
    console.log('[Scheduler] Phase 2: Sending notifications...');
    for (const data of collectedData) {
      await sendNotificationForStudent(data, currentHour);
    }

    console.log('[Scheduler] Hourly tasks completed');
  } catch (error) {
    console.error('[Scheduler] Error during hourly tasks:', error);
  }
};

const startHourlyTimer = () => {
  // Calculate delay until next top of the hour
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const milliseconds = now.getMilliseconds();

  // Time until next hour (in milliseconds)
  const delayUntilNextHour = (60 - minutes - 1) * 60 * 1000 + (60 - seconds) * 1000 - milliseconds;

  console.log(
    `[Scheduler] Will start in ${Math.round(delayUntilNextHour / 1000 / 60)} minutes (at next hour)`
  );

  // Schedule first run at the top of the next hour
  setTimeout(() => {
    runHourlyTasks();

    // Then run every hour on the hour
    hourlyInterval = setInterval(runHourlyTasks, 60 * 60 * 1000);
    console.log('[Scheduler] Timer started (runs every hour on the hour)');
  }, delayUntilNextHour);
};

const stopHourlyTimer = () => {
  if (hourlyInterval) {
    clearInterval(hourlyInterval);
    hourlyInterval = null;
    console.log('[Scheduler] Timer stopped');
  }
};

// Shared command handlers
const handleNotifyCommand = async (
  command: string,
  params: string[],
  qqId: string,
  chatType: 'private' | 'group',
  chatId: string,
  sendFn: (message: string) => Promise<void>
) => {
  if (params.length < 1 || params.length > 2) {
    await sendFn(
      `查询定时通知：${command} notify list\n` +
        `设置定时通知：${command} notify <小时 (0-23)> [阈值]`
    );
    return;
  }

  if (params[0] === 'list') {
    const notifications = scheduler.getNotificationsForUser(qqId);
    if (notifications.length === 0) {
      await sendFn('您还未设置定时通知。');
      return;
    }

    let message = '目前设置的定时通知：\n';
    for (const notification of notifications) {
      message += `- ${notification.hour.toString().padStart(2, '0')}:00 ${
        notification.chat_type === 'private'
          ? '私聊'
          : await napcat
              .get_group_info({
                group_id: parseInt(notification.chat_id)
              })
              .then((info) => info.group_name)
      }`;
      if (notification.threshold !== null && notification.threshold !== undefined) {
        message += `[${notification.threshold} 元]`;
      }
      message += '\n';
    }
    await sendFn(message);
    return;
  }

  const hour = parseInt(params[0]);
  if (isNaN(hour) || hour < 0 || hour > 23) {
    await sendFn('小时必须是 0 到 23 之间的数字。');
    return;
  }

  let threshold: number | undefined;
  if (params.length === 2) {
    threshold = parseFloat(params[1]);
    if (isNaN(threshold) || threshold < 0) {
      await sendFn('阈值必须是非负数字。');
      return;
    }
  }

  // Check if user has credentials
  const credentials = db.getCredentials(qqId);
  if (!credentials) {
    await sendFn(
      `您还未绑定账号。请私聊发送：${command} bind <卡号> <卡片密码> <校区 (GZIC 或 DXC)>`
    );
    return;
  }

  // Set notification
  scheduler.setNotification(chatType, chatId, qqId, hour, threshold);

  let message = `已设置每日 ${hour} 时在此${chatType === 'private' ? '私聊' : '群聊'}`;
  if (threshold !== undefined) {
    message += `当任一余额低于 ${threshold} 元时`;
  }
  message += '发送账单报告。';

  await sendFn(message);
  console.log(
    `[Notify] Set notification for ${chatType} ${chatId}, QQ ${qqId}, hour ${hour}, threshold ${threshold ?? 'none'}`
  );
};

const handleUnnotifyCommand = async (
  qqId: string,
  chatType: 'private' | 'group',
  chatId: string,
  sendFn: (message: string) => Promise<void>
) => {
  const deleted = scheduler.deleteNotification(chatType, chatId, qqId);
  if (deleted) {
    await sendFn('已取消定时通知。');
  } else {
    await sendFn('您还未设置定时通知。');
  }
};

const handleHelp = async (
  command: string,
  sendFn: (message: string | SendMessageSegment[]) => Promise<void>
) => {
  const message =
    `[${APP_NAME}] 可用命令：\n\n` +
    '1. 绑定账号（仅限私聊）：\n' +
    `${command} bind <卡号> <卡片密码> <校区 (GZIC 或 DXC)>\n` +
    `   例：${command} bind 123456 123456 GZIC\n\n` +
    '2. 解绑账号：\n' +
    `${command} unbind\n\n` +
    '3. 查询当前账单：\n' +
    `${command} query [起始时间] [结束时间]\n` +
    '   或\n' +
    `${command} bills [起始时间] [结束时间]\n` +
    '   时间格式支持：\n' +
    '   - 相对时间：7h（7 小时前），3d（3 天前），2w（2 周前）\n' +
    '   - 绝对时间：1030（10 月 30 日 0:00），10302330（10 月 30 日 23:30）\n' +
    '   - 带分隔符：10-30|23:30，10/30|23:30，10/30/23:30\n' +
    `   例：${command} query 7d（显示最近 7 天；默认）\n` +
    `   例：${command} query 1025 1030（显示 10 月 25 日至 30 日）\n\n` +
    '4. 查询定时通知：\n' +
    `${command} notify list\n\n` +
    '5. 设置定时通知：\n' +
    `${command} notify <小时 (0-23)> [阈值]\n` +
    `   例：${command} notify 20 10\n` +
    '   每天晚上 8 点当任一余额低于 10 元时发送账单报告。\n\n' +
    '6. 取消定时通知：\n' +
    `${command} unnotify\n\n` +
    '如有疑问，请联系管理员。\n' +
    `当前 commit：${commitHash}\n` +
    `GitHub 仓库：${GITHUB_LINK}`;
  await sendFn([{ type: 'node', data: { content: [{ type: 'text', data: { text: message } }] } }]);
};

napcat.on('message', async (context: AllHandlers['message']) => {
  const isPrivateChat = context.message_type === 'private';
  const send = async (message: string | SendMessageSegment[]) => {
    await (isPrivateChat
      ? napcat.send_private_msg({
          user_id: context.sender.user_id,
          message:
            typeof message === 'string' ? [{ type: 'text', data: { text: message } }] : message
        })
      : napcat.send_group_msg({
          group_id: context.group_id,
          message:
            typeof message === 'string' ? [{ type: 'text', data: { text: message } }] : message
        }));
  };

  try {
    const { command, args } = parseMessage(context);
    if (!command) return;
    if (!args || args.length === 0) {
      await handleHelp(command, send);
      return;
    }
    const [subcommand, ...params] = args;
    const qqId = context.sender.user_id.toString();
    const chatId = (isPrivateChat ? context.sender.user_id : context.group_id).toString();

    if (subcommand === 'bind' && isPrivateChat) {
      if (params.length !== 3) {
        await send(`用法：${command} ${subcommand} <卡号> <卡片密码> <校区(GZIC 或 DXC)>`);
        return;
      }
      const [cardId, password, campus] = params;
      if (CAMPUSES.includes(campus.toUpperCase() as Campus) === false) {
        await send('校区必须是 GZIC 或 DXC。');
        return;
      }
      console.log(`[Bind] QQ: ${qqId}, Card ID: ${cardId}`);
      const result = await login(cardId, password);
      if (result === null) {
        await send('登录失败，请检查卡号和密码是否正确。');
        return;
      }
      db.addStudent(
        qqId,
        cardId,
        campus.toUpperCase() as Campus,
        password,
        result.name,
        result.sno
      );
      // Store the access token from login
      db.updateTokens(qqId, result.access_token, result.TGC, result.locSession, result.expires_in);
      console.log(`[DB] Stored credentials and token for ${result.name} (${result.sno})`);

      await send(`成功绑定到 ${result.name}（学号：${result.sno}）。`);
    } else if (subcommand === 'unbind') {
      // Clear token before deleting (though CASCADE will handle this)
      db.clearAccessToken(qqId);
      const deleted = db.deleteStudent(qqId);
      if (deleted) {
        await send('已解除绑定。');
      } else {
        await send('您还未绑定账号。');
      }
    } else if (subcommand === 'query' || subcommand === 'bills') {
      const credentials = db.getCredentials(qqId);
      if (!credentials) {
        await send(
          `您还未绑定账号。请私聊发送：${command} bind <卡号> <卡片密码> <校区(GZIC 或 DXC)>`
        );
        return;
      }

      // Parse time range parameters
      let startTime: Date | null = null;
      let endTime: Date | null = null;

      try {
        if (params.length >= 1) {
          startTime = parseTimeParameter(params[0]);
        }
        if (params.length >= 2) {
          endTime = parseTimeParameter(params[1]);
        }

        // Validation
        if (startTime && endTime && startTime >= endTime) {
          await send('错误：起始时间必须早于结束时间。');
          return;
        }
      } catch (error) {
        await send(`时间参数格式错误：${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      // Get bills with automatic token management
      const { electric, ac, water, room } = await getBillsWithTokenRefresh(qqId);
      db.updateLastLogin(qqId);

      // Get 24h change
      const change24h = db.getBilling24HourChange(qqId);

      // Get history for chart with custom time range
      let history;
      if (startTime || endTime) {
        history = db.getBillingHistoryByTimeRange(qqId, startTime, endTime);
      } else {
        // Default: last 7 days
        history = db.getBillingHistory(qqId, 7);
      }

      // Generate summary
      let messageText = `🏠 ${room}\n\n`;
      messageText += generateBillingSummary({ electric, water, ac }, change24h || undefined);

      // Build message segments
      const messageSegments: SendMessageSegment[] = [{ type: 'text', data: { text: messageText } }];

      // Add chart images if we have enough data
      if (history.length >= 2) {
        const chartData = history
          .reverse()
          .map(
            (h: {
              id: number;
              qq_id: string;
              electric: number;
              water: number;
              ac: number;
              room: string | null;
              recorded_at: string;
            }) => ({
              timestamp: h.recorded_at,
              electric: h.electric,
              water: h.water,
              ac: h.ac
            })
          );

        const charts = await generateBillingCharts(chartData, room);
        for (const chart of charts) {
          const base64Image = `base64://${chart.buffer.toString('base64')}`;
          messageSegments.push({ type: 'image', data: { file: base64Image } });
        }
      } else {
        messageSegments[0].data.text += '\n💡 需要至少 2 条历史记录才能显示趋势图';
      }

      await send(messageSegments);
    } else if (subcommand === 'notify') {
      await handleNotifyCommand(command, params, qqId, context.message_type, chatId, send);
    } else if (subcommand === 'unnotify') {
      await handleUnnotifyCommand(qqId, context.message_type, chatId, send);
    }
  } catch (error) {
    console.error('Error handling message:', error);
    await send('操作失败，请稍后重试。').catch();
  }
});

await napcat.connect();

let shutdownInitiated = false;
process.on('SIGINT', async () => {
  if (shutdownInitiated) {
    console.log('\nForce exiting...');
    process.exit(1);
  }
  shutdownInitiated = true;
  console.log('\nGracefully shutting down...');

  stopHourlyTimer();

  napcat.disconnect();

  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 5000));
  await Promise.race([socketClose.promise, timeout]);

  db.close();
  console.log('[SQLite] Database closed.');

  console.log('Process exited.');
  process.exit(0);
});
