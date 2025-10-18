import { NCWebsocket } from 'node-napcat-ts';
import type { AllHandlers, SendMessageSegment } from 'node-napcat-ts';
import config from '../config.json' with { type: 'json' };
import { obtainToken as login } from './utils/session.js';
import { getBills } from './utils/billing.js';
import { db, scheduler } from './utils/database.js';
import { generateBillingChart, generateBillingSummary } from './utils/charts.js';

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
  if (!config.commandNames.includes(command)) return { command, args: null };
  return { command, args: segments.slice(1) };
};

// Combined timer for data collection and notifications
let hourlyInterval: NodeJS.Timeout | null = null;

const runHourlyTasks = async () => {
  try {
    const currentHour = new Date().getHours();
    console.log(`[Hourly Tasks] Running for hour: ${currentHour}`);

    // Get all students with their notification settings
    const students = db.getAllStudentsWithNotifications();
    console.log(`[Hourly Tasks] Checking ${students.length} students`);

    for (const student of students) {
      try {
        // 1. Collect Data
        // Get credentials
        const credentials = db.getCredentials(student.qq_id);
        if (!credentials) {
          console.log(`[Hourly Tasks] No credentials for QQ ${student.qq_id}, skipping`);
          continue;
        }

        // Login and get bills
        const result = await login(credentials.cardId, credentials.password);
        const { electric, ac, water, room } = await getBills(result.access_token);

        // Record billing history
        db.addBillingHistory(student.qq_id, electric, water, ac, room);
        console.log(`[Hourly Tasks] Collected data for ${student.name || student.qq_id} (${room})`);
        db.updateLastLogin(student.qq_id);

        // 2. Send Notification (if due)
        if (student.notification_hour !== null && student.notification_hour === currentHour) {
          console.log(`[Hourly Tasks] Sending notification to ${student.name || student.qq_id}`);

          // Get 24h change
          const change24h = db.getBilling24HourChange(student.qq_id);

          // Get history for chart
          const history = db.getBillingHistory(student.qq_id, 7);

          // Generate summary
          let messageText = `🏠 ${room}\n\n`;
          messageText +=
            generateBillingSummary({ electric, water, ac }, change24h || undefined) + '\n';

          // Build message segments
          const messageSegments: SendMessageSegment[] = [
            { type: 'text', data: { text: messageText } }
          ];

          // Add chart image
          if (history.length >= 2) {
            const chartData = history.reverse().map((h) => ({
              timestamp: h.recorded_at,
              electric: Math.max(h.electric, 0),
              water: Math.max(h.water, 0),
              ac: Math.max(h.ac, 0)
            }));

            const chartBuffer = await generateBillingChart(chartData);
            if (chartBuffer) {
              const base64Image = `base64://${chartBuffer.toString('base64')}`;
              messageSegments.push({ type: 'image', data: { file: base64Image } });
            }
          }

          // Send message (assuming private chat for now, needs adjustment if group)
          // We need to get chat_id and chat_type from notifications table
          const notificationDetails = scheduler.getNotificationForUser(student.qq_id);
          if (notificationDetails) {
            if (notificationDetails.chat_type === 'private') {
              await napcat.send_private_msg({
                user_id: parseInt(notificationDetails.chat_id),
                message: messageSegments
              });
            } else {
              await napcat.send_group_msg({
                group_id: parseInt(notificationDetails.chat_id),
                message: messageSegments
              });
            }
            console.log(
              `[Hourly Tasks] Sent notification to ${notificationDetails.chat_type} ${notificationDetails.chat_id}`
            );
          }
        }
      } catch (error) {
        console.error(`[Hourly Tasks] Failed to process QQ ${student.qq_id}:`, error);
      }
    }
  } catch (error) {
    console.error('[Hourly Tasks] Error during hourly tasks:', error);
  }
};

const startHourlyTimer = () => {
  // Calculate delay until next top of the hour
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  const milliseconds = now.getMilliseconds();

  // Time until next hour (in milliseconds)
  const delayUntilNextHour =
    (60 - minutes - 1) * 60 * 1000 + (60 - seconds) * 1000 - milliseconds;

  console.log(
    `[Hourly Tasks] Will start in ${Math.round(
      delayUntilNextHour / 1000 / 60
    )} minutes (at next hour)`
  );

  // Schedule first run at the top of the next hour
  setTimeout(() => {
    runHourlyTasks();

    // Then run every hour on the hour
    hourlyInterval = setInterval(runHourlyTasks, 60 * 60 * 1000);
    console.log('[Hourly Tasks] Timer started (runs every hour on the hour)');
  }, delayUntilNextHour);
};

const stopHourlyTimer = () => {
  if (hourlyInterval) {
    clearInterval(hourlyInterval);
    hourlyInterval = null;
    console.log('[Hourly Tasks] Timer stopped');
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
  if (params.length !== 1) {
    await sendFn(`用法：${command} notify <小时(0-23)>`);
    return;
  }

  const hour = parseInt(params[0]);
  if (isNaN(hour) || hour < 0 || hour > 23) {
    await sendFn('小时必须是 0 到 23 之间的数字。');
    return;
  }

  // Check if user has credentials
  const credentials = db.getCredentials(qqId);
  if (!credentials) {
    await sendFn(`您还未绑定账号。请先使用：${command} bind <卡号> <卡片密码>`);
    return;
  }

  // Set notification
  scheduler.setNotification(chatType, chatId, qqId, hour);
  await sendFn(
    `已设置每日 ${hour} 时在此${chatType === 'private' ? '私聊' : '群聊'}发送账单报告。`
  );
  console.log(`[Notify] Set notification for ${chatType} ${chatId}, QQ ${qqId}, hour ${hour}`);
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
    if (!command || !args) return;
    const [subcommand, ...params] = args;
    const qqId = context.sender.user_id.toString();
    const chatId = (isPrivateChat ? context.sender.user_id : context.group_id).toString();

    if (subcommand === 'bind' && isPrivateChat) {
      if (params.length !== 2) {
        await send(`用法：${command} ${subcommand} <卡号> <卡片密码>`);
        return;
      }
      const [cardId, password] = params;
      console.log(`[Bind] QQ: ${qqId}, Card ID: ${cardId}`);
      const result = await login(cardId, password);
      db.addStudent(qqId, cardId, password, result.name, result.sno);
      console.log(`[DB] Stored credentials for ${result.name} (${result.sno})`);

      await send(`成功绑定到 ${result.name}（学号：${result.sno}）。`);
    } else if (subcommand === 'unbind') {
      const deleted = db.deleteStudent(qqId);
      if (deleted) {
        await send('已解除绑定。');
      } else {
        await send('您还未绑定账号。');
      }
    } else if (subcommand === 'query' || subcommand === 'bills') {
      const credentials = db.getCredentials(qqId);
      if (!credentials) {
        await send(`您还未绑定账号。请使用：${command} bind <卡号> <卡片密码>`);
        return;
      }

      // Login with stored credentials
      const result = await login(credentials.cardId, credentials.password);
      db.updateLastLogin(qqId);

      const { electric, ac, water, room } = await getBills(result.access_token);

      // Get 24h change
      const change24h = db.getBilling24HourChange(qqId);

      // Get history for chart (last 7 days)
      const history = db.getBillingHistory(qqId, 7);

      // Generate summary
      let messageText = `🏠 ${room}\n\n`;
      messageText += generateBillingSummary({ electric, water, ac }, change24h || undefined) + '\n';

      // Build message segments
      const messageSegments: SendMessageSegment[] = [{ type: 'text', data: { text: messageText } }];

      // Add chart image if we have enough data
      if (history.length >= 2) {
        const chartData = history.reverse().map((h) => ({
          timestamp: h.recorded_at,
          electric: Math.max(h.electric, 0),
          water: Math.max(h.water, 0),
          ac: Math.max(h.ac, 0)
        }));

        const chartBuffer = await generateBillingChart(chartData);
        if (chartBuffer) {
          const base64Image = `base64://${chartBuffer.toString('base64')}`;
          messageSegments.push({ type: 'image', data: { file: base64Image } });
        }
      } else {
        messageSegments[0].data.text += '\n\n💡 需要至少 2 条历史记录才能显示趋势图';
      }

      await send(messageSegments);
    } else if (subcommand === 'notify') {
      await handleNotifyCommand(command, params, qqId, context.message_type, chatId, send);
    } else if (subcommand === 'unnotify') {
      await handleUnnotifyCommand(qqId, context.message_type, chatId, send);
    }
  } catch (error) {
    console.error('Error handling message:', error);
    await send('操作失败，请稍后重试。');
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
