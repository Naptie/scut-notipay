import type Database from 'better-sqlite3';

export interface Notification {
  id?: number;
  chat_type: 'private' | 'group';
  chat_id: string;
  qq_id: string;
  hour: number;
  threshold?: number | null;
  created_at?: string;
  updated_at?: string;
}

class NotificationScheduler {
  private db: Database.Database;

  constructor(database: Database.Database) {
    this.db = database;
  }

  /**
   * Add or update a notification schedule
   */
  setNotification(
    chatType: 'private' | 'group',
    chatId: string,
    qqId: string,
    hour: number,
    threshold?: number
  ): Notification {
    if (hour < 0 || hour > 23) {
      throw new Error('Hour must be between 0 and 23');
    }

    if (threshold !== undefined && threshold < 0) {
      throw new Error('Threshold must be a positive number');
    }

    const stmt = this.db.prepare(`
      INSERT INTO notifications (chat_type, chat_id, qq_id, hour, threshold)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(chat_type, chat_id, qq_id) DO UPDATE SET
        hour = excluded.hour,
        threshold = excluded.threshold,
        updated_at = datetime('now', 'localtime')
    `);

    stmt.run(chatType, chatId, qqId, hour, threshold ?? null);

    const notification = this.getNotification(chatType, chatId, qqId);
    if (!notification) {
      throw new Error('Failed to set notification');
    }
    return notification;
  }

  /**
   * Get notification for a specific chat and user
   */
  getNotification(
    chatType: 'private' | 'group',
    chatId: string,
    qqId: string
  ): Notification | null {
    const stmt = this.db.prepare(`
      SELECT * FROM notifications
      WHERE chat_type = ? AND chat_id = ? AND qq_id = ?
    `);

    return stmt.get(chatType, chatId, qqId) as Notification | null;
  }

  /**
   * Get all notifications for a specific chat
   */
  getChatNotifications(chatType: 'private' | 'group', chatId: string): Notification[] {
    const stmt = this.db.prepare(`
      SELECT * FROM notifications
      WHERE chat_type = ? AND chat_id = ?
    `);

    return stmt.all(chatType, chatId) as Notification[];
  }

  /**
   * Get notification for a specific user by QQ ID
   */
  getNotificationForUser(qqId: string): Notification | null {
    const stmt = this.db.prepare(`
      SELECT * FROM notifications
      WHERE qq_id = ?
      LIMIT 1
    `);

    return stmt.get(qqId) as Notification | null;
  }

  /**
   * Delete a notification
   */
  deleteNotification(chatType: 'private' | 'group', chatId: string, qqId: string): boolean {
    const stmt = this.db.prepare(`
      DELETE FROM notifications
      WHERE chat_type = ? AND chat_id = ? AND qq_id = ?
    `);

    const result = stmt.run(chatType, chatId, qqId);
    return result.changes > 0;
  }

  /**
   * Update last sent timestamp
   */
  updateLastSent(id: number): void {
    const stmt = this.db.prepare(`
      UPDATE notifications
      SET last_sent = datetime('now', 'localtime')
      WHERE id = ?
    `);

    stmt.run(id);
  }

  /**
   * Get notifications that should be sent now
   */
  getAllNotifications(): Notification[] {
    const stmt = this.db.prepare('SELECT * FROM notifications');
    return stmt.all() as Notification[];
  }

  /**
   * Get notification count
   */
  getNotificationCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM notifications');
    const result = stmt.get() as { count: number };
    return result.count;
  }
}

// Export class for testing
export { NotificationScheduler };
