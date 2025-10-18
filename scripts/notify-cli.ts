#!/usr/bin/env node
/**
 * Notification Management CLI
 * Usage: tsx scripts/notify-cli.ts <command> [args]
 */

import { scheduler, db } from '../src/utils/database.js';

const commands = {
  list: () => {
    const notifications = scheduler.getEnabledNotifications();
    console.log(`\nTotal notifications: ${notifications.length}\n`);
    console.log('ID\tType\tChat ID\t\tQQ ID\t\tHour');
    console.log('─'.repeat(100));
    notifications.forEach((n) => {
      console.log(
        `${n.id}\t${n.chat_type}\t${n.chat_id}\t${n.qq_id}\t${n.hour}:00`
      );
    });
    console.log();
  },

  count: () => {
    const count = scheduler.getNotificationCount();
    console.log(`\nTotal enabled notifications: ${count}\n`);
  },

  get: (chatType: string, chatId: string, qqId: string) => {
    if (!chatType || !chatId || !qqId) {
      console.error('Usage: get <chat_type> <chat_id> <qq_id>');
      return;
    }
    if (chatType !== 'private' && chatType !== 'group') {
      console.error('chat_type must be "private" or "group"');
      return;
    }
    const notification = scheduler.getNotification(chatType as 'private' | 'group', chatId, qqId);
    if (notification) {
      console.log('\nNotification:');
      console.log(JSON.stringify(notification, null, 2));
      console.log();
    } else {
      console.log(`\nNo notification found.\n`);
    }
  },

  add: (chatType: string, chatId: string, qqId: string, hour: string) => {
    if (!chatType || !chatId || !qqId || !hour) {
      console.error('Usage: add <chat_type> <chat_id> <qq_id> <hour>');
      return;
    }
    if (chatType !== 'private' && chatType !== 'group') {
      console.error('chat_type must be "private" or "group"');
      return;
    }
    const hourNum = parseInt(hour);
    if (isNaN(hourNum) || hourNum < 0 || hourNum > 23) {
      console.error('hour must be between 0 and 23');
      return;
    }
    const notification = scheduler.setNotification(
      chatType as 'private' | 'group',
      chatId,
      qqId,
      hourNum
    );
    console.log('\nNotification added/updated:');
    console.log(JSON.stringify(notification, null, 2));
    console.log();
  },

  disable: (chatType: string, chatId: string, qqId: string) => {
    if (!chatType || !chatId || !qqId) {
      console.error('Usage: disable <chat_type> <chat_id> <qq_id>');
      return;
    }
    if (chatType !== 'private' && chatType !== 'group') {
      console.error('chat_type must be "private" or "group"');
      return;
    }
    const disabled = scheduler.disableNotification(chatType as 'private' | 'group', chatId, qqId);
    if (disabled) {
      console.log('\nNotification disabled.\n');
    } else {
      console.log('\nNo notification found.\n');
    }
  },

  delete: (chatType: string, chatId: string, qqId: string) => {
    if (!chatType || !chatId || !qqId) {
      console.error('Usage: delete <chat_type> <chat_id> <qq_id>');
      return;
    }
    if (chatType !== 'private' && chatType !== 'group') {
      console.error('chat_type must be "private" or "group"');
      return;
    }
    const deleted = scheduler.deleteNotification(chatType as 'private' | 'group', chatId, qqId);
    if (deleted) {
      console.log('\nNotification deleted.\n');
    } else {
      console.log('\nNo notification found.\n');
    }
  },

  backup: (path?: string) => {
    const backupPath = path || `data-backup-${Date.now()}.db`;
    db.backup(backupPath);
    console.log(`\nDatabase backed up to: ${backupPath}\n`);
  },

  help: () => {
    console.log(`
Notification Management CLI

Commands:
  list                                    List all enabled notifications
  count                                   Show total notification count
  get <chat_type> <chat_id> <qq_id>      Get notification details
  add <chat_type> <chat_id> <qq_id>      Add/update notification
      <hour>
  disable <chat_type> <chat_id> <qq_id>  Disable notification
  delete <chat_type> <chat_id> <qq_id>   Delete notification
  due                                     Show notifications due now
  backup [path]                          Backup database
  help                                    Show this help message

Chat Types: private, group

Examples:
  tsx scripts/notify-cli.ts list
  tsx scripts/notify-cli.ts add private 123456789 123456789 8
  tsx scripts/notify-cli.ts add group 987654321 123456789 20
  tsx scripts/notify-cli.ts get private 123456789 123456789
  tsx scripts/notify-cli.ts delete private 123456789 123456789
  tsx scripts/notify-cli.ts due
`);
  }
};

const [, , command, ...args] = process.argv;

if (!command || command === 'help' || !(command in commands)) {
  commands.help();
} else {
  try {
    const cmd = commands[command as keyof typeof commands] as (...args: string[]) => void;
    cmd(...args);
  } catch (error) {
    console.error('Error:', error);
  } finally {
    db.close();
  }
}
