import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { encryptionService } from './encryption.js';
import config from '../../config.json' with { type: 'json' };
import { NotificationScheduler } from './scheduler.js';
import type { CAMPUSES } from './constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path - stored in project root
const DB_PATH = path.join(__dirname, '..', '..', 'data.db');

// Master password for encrypting card passwords
// In production, this should be stored in environment variables or secure key management
const MASTER_PASSWORD = config.encryptionKey;

export interface Student {
  id?: number;
  qq_id: string;
  card_id: string;
  encrypted_password: string;
  salt: string;
  name?: string;
  student_number?: string;
  fetch_interval?: string;
  created_at?: string;
  updated_at?: string;
  last_login?: string;
}

export type Campus = (typeof CAMPUSES)[number];

export interface StudentPublic {
  id: number;
  qq_id: string;
  card_id: string;
  campus: Campus;
  name?: string;
  student_number?: string;
  fetch_interval: string;
  created_at: string;
  updated_at: string;
  last_login?: string;
}

class StudentDatabase {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL'); // Better concurrency
    this.initializeDatabase();
  }

  /**
   * Initialize the database schema
   */
  private initializeDatabase(): void {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        qq_id TEXT NOT NULL UNIQUE,
        card_id TEXT NOT NULL,
        campus TEXT NOT NULL CHECK(campus IN ('GZIC', 'DXC')),
        encrypted_password TEXT NOT NULL,
        salt TEXT NOT NULL,
        name TEXT,
        student_number TEXT,
        fetch_interval TEXT DEFAULT '1d',
        access_token TEXT,
        tgc TEXT,
        loc_session TEXT,
        token_expires_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime')),
        last_login TEXT
      )
    `;

    const createBillingHistoryTableSQL = `
      CREATE TABLE IF NOT EXISTS billing_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        qq_id TEXT NOT NULL,
        electric REAL NOT NULL,
        water REAL NOT NULL,
        ac REAL NOT NULL,
        room TEXT,
        recorded_at TEXT DEFAULT (datetime('now', 'localtime')),
        FOREIGN KEY (qq_id) REFERENCES students(qq_id) ON DELETE CASCADE
      )
    `;

    const createNotificationsTableSQL = `
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_type TEXT NOT NULL,
        chat_id TEXT NOT NULL,
        qq_id TEXT NOT NULL,
        hour INTEGER NOT NULL CHECK(hour >= 0 AND hour <= 23),
        threshold REAL,
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        updated_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(chat_type, chat_id, qq_id)
      )
    `;

    const createIndexSQL = `
      CREATE INDEX IF NOT EXISTS idx_qq_id ON students(qq_id);
      CREATE INDEX IF NOT EXISTS idx_card_id ON students(card_id);
      CREATE INDEX IF NOT EXISTS idx_billing_qq_id ON billing_history(qq_id);
      CREATE INDEX IF NOT EXISTS idx_billing_recorded_at ON billing_history(recorded_at);
      CREATE INDEX IF NOT EXISTS idx_chat ON notifications(chat_type, chat_id);
    `;

    this.db.exec(createTableSQL);
    this.db.exec(createBillingHistoryTableSQL);
    this.db.exec(createNotificationsTableSQL);
    this.db.exec(createIndexSQL);
  }

  /**
   * Generate a random salt (used for database versioning/migration tracking)
   */
  private generateSalt(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Add or update a student's credentials
   */
  addStudent(
    qqId: string,
    cardId: string,
    campus: Campus,
    password: string,
    name?: string,
    studentNumber?: string,
    fetchInterval: string = '1d'
  ): StudentPublic {
    const salt = this.generateSalt();
    // Encrypt the actual card password for secure storage
    const encryptedPassword = encryptionService.encrypt(password, MASTER_PASSWORD);

    const stmt = this.db.prepare(`
      INSERT INTO students (qq_id, card_id, campus, encrypted_password, salt, name, student_number, fetch_interval)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(qq_id) DO UPDATE SET
        card_id = excluded.card_id,
        campus = excluded.campus,
        encrypted_password = excluded.encrypted_password,
        salt = excluded.salt,
        name = COALESCE(excluded.name, name),
        student_number = COALESCE(excluded.student_number, student_number),
        fetch_interval = excluded.fetch_interval,
        updated_at = datetime('now', 'localtime')
    `);

    stmt.run(qqId, cardId, campus, encryptedPassword, salt, name, studentNumber, fetchInterval);

    const student = this.getStudent(qqId);
    if (!student) {
      throw new Error('Failed to add student');
    }
    return student;
  }

  /**
   * Get student by QQ ID (without password)
   */
  getStudent(qqId: string): StudentPublic | null {
    const stmt = this.db.prepare(`
      SELECT id, qq_id, card_id, campus, name, student_number, fetch_interval, created_at, updated_at, last_login
      FROM students
      WHERE qq_id = ?
    `);

    return stmt.get(qqId) as StudentPublic | null;
  }

  /**
   * Get student's campus by QQ ID
   */
  getCampus(qqId: string): Campus | null {
    const stmt = this.db.prepare(`
      SELECT campus
      FROM students
      WHERE qq_id = ?
    `);

    const result = stmt.get(qqId) as { campus: Campus } | undefined;
    return result ? result.campus : null;
  }

  /**
   * Get student credentials (with encrypted password for verification)
   */
  getStudentCredentials(qqId: string): Student | null {
    const stmt = this.db.prepare(`
      SELECT *
      FROM students
      WHERE qq_id = ?
    `);

    return stmt.get(qqId) as Student | null;
  }

  /**
   * Verify student by checking if credentials can be decrypted
   */
  verifyStudent(qqId: string): boolean {
    const credentials = this.getCredentials(qqId);
    return credentials !== null;
  }

  /**
   * Get decrypted credentials for API calls
   */
  getCredentials(qqId: string): { cardId: string; password: string } | null {
    const student = this.getStudentCredentials(qqId);
    if (!student) {
      return null;
    }

    try {
      const decryptedPassword = encryptionService.decrypt(
        student.encrypted_password,
        MASTER_PASSWORD
      );
      return { cardId: student.card_id, password: decryptedPassword };
    } catch (error) {
      console.error('Failed to decrypt password:', error);
      return null;
    }
  }

  /**
   * Get stored tokens if it exists and is not expired
   */
  getTokens(qqId: string): [string, string, string] | null {
    const stmt = this.db.prepare(`
      SELECT access_token, tgc, loc_session, token_expires_at
      FROM students
      WHERE qq_id = ?
    `);
    const result = stmt.get(qqId) as
      | {
          access_token: string | null;
          tgc: string | null;
          loc_session: string | null;
          token_expires_at: string | null;
        }
      | undefined;

    if (
      !result ||
      !result.access_token ||
      !result.tgc ||
      !result.loc_session ||
      !result.token_expires_at
    ) {
      return null;
    }

    // Check if token is expired
    const expiresAt = new Date(result.token_expires_at);
    const now = new Date();

    // Add a 5-minute buffer to refresh before actual expiry
    if (expiresAt.getTime() - now.getTime() < 5 * 60 * 1000) {
      return null; // Token expired or about to expire
    }

    return [result.access_token, result.tgc, result.loc_session];
  }

  /**
   * Update tokens and expiration time for a user
   */
  updateTokens(
    qqId: string,
    accessToken: string,
    TGC: string,
    locSession: string,
    expiresIn: number
  ): void {
    // Calculate expiration time (expiresIn is in seconds)
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    const stmt = this.db.prepare(`
      UPDATE students
      SET access_token = ?,
          tgc = ?,
          loc_session = ?,
          token_expires_at = ?,
          updated_at = datetime('now', 'localtime')
      WHERE qq_id = ?
    `);

    stmt.run(accessToken, TGC, locSession, expiresAt.toISOString(), qqId);
  }

  /**
   * Clear tokens for a user (when token is invalid)
   */
  clearAccessToken(qqId: string): void {
    const stmt = this.db.prepare(`
      UPDATE students
      SET access_token = NULL,
          tgc = NULL,
          loc_session = NULL,
          token_expires_at = NULL,
          updated_at = datetime('now', 'localtime')
      WHERE qq_id = ?
    `);

    stmt.run(qqId);
  }

  /**
   * Update last login timestamp
   */
  updateLastLogin(qqId: string): void {
    const stmt = this.db.prepare(`
      UPDATE students
      SET last_login = datetime('now', 'localtime')
      WHERE qq_id = ?
    `);

    stmt.run(qqId);
  }

  /**
   * Update student information
   */
  updateStudentInfo(qqId: string, name?: string, studentNumber?: string): void {
    const stmt = this.db.prepare(`
      UPDATE students
      SET name = COALESCE(?, name),
          student_number = COALESCE(?, student_number),
          updated_at = datetime('now', 'localtime')
      WHERE qq_id = ?
    `);

    stmt.run(name, studentNumber, qqId);
  }

  /**
   * Update student fetch interval
   */
  updateFetchInterval(qqId: string, fetchInterval: string): void {
    const stmt = this.db.prepare(`
      UPDATE students
      SET fetch_interval = ?,
          updated_at = datetime('now', 'localtime')
      WHERE qq_id = ?
    `);

    stmt.run(fetchInterval, qqId);
  }

  /**
   * Delete a student
   */
  deleteStudent(qqId: string): boolean {
    const stmt = this.db.prepare('DELETE FROM students WHERE qq_id = ?');
    const result = stmt.run(qqId);
    return result.changes > 0;
  }

  /**
   * Get all students (without passwords)
   */
  getAllStudents(): StudentPublic[] {
    const stmt = this.db.prepare(`
      SELECT id, qq_id, card_id, campus, name, student_number, fetch_interval, created_at, updated_at, last_login
      FROM students
      ORDER BY created_at DESC
    `);

    return stmt.all() as StudentPublic[];
  }

  /**
   * Check if student exists
   */
  studentExists(qqId: string): boolean {
    const stmt = this.db.prepare('SELECT 1 FROM students WHERE qq_id = ? LIMIT 1');
    return stmt.get(qqId) !== undefined;
  }

  /**
   * Get student count
   */
  getStudentCount(): number {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM students');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Add billing history record
   */
  addBillingHistory(
    qqId: string,
    electric: number,
    water: number,
    ac: number,
    room?: string
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO billing_history (qq_id, electric, water, ac, room)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(qqId, electric, water, ac, room);
  }

  /**
   * Get billing history for a user (last N days or N records)
   */
  getBillingHistory(
    qqId: string,
    days?: number,
    limit?: number
  ): Array<{
    id: number;
    qq_id: string;
    electric: number;
    water: number;
    ac: number;
    room: string | null;
    recorded_at: string;
  }> {
    let sql = `
      SELECT * FROM billing_history
      WHERE qq_id = ?
    `;

    const params: (string | number)[] = [qqId];

    if (days !== undefined) {
      sql += ` AND datetime(recorded_at) >= datetime('now', 'localtime', '-' || ? || ' days')`;
      params.push(days);
    }

    sql += ' ORDER BY recorded_at DESC';

    if (limit !== undefined) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Array<{
      id: number;
      qq_id: string;
      electric: number;
      water: number;
      ac: number;
      room: string | null;
      recorded_at: string;
    }>;
  }

  /**
   * Get billing history for a user within a specific time range
   */
  getBillingHistoryByTimeRange(
    qqId: string,
    startTime?: Date | null,
    endTime?: Date | null
  ): Array<{
    id: number;
    qq_id: string;
    electric: number;
    water: number;
    ac: number;
    room: string | null;
    recorded_at: string;
  }> {
    let sql = `
      SELECT * FROM billing_history
      WHERE qq_id = ?
    `;

    const params: (string | number)[] = [qqId];

    if (startTime) {
      // Convert Date to local time string format: YYYY-MM-DD HH:MM:SS
      const year = startTime.getFullYear();
      const month = String(startTime.getMonth() + 1).padStart(2, '0');
      const day = String(startTime.getDate()).padStart(2, '0');
      const hours = String(startTime.getHours()).padStart(2, '0');
      const minutes = String(startTime.getMinutes()).padStart(2, '0');
      const seconds = String(startTime.getSeconds()).padStart(2, '0');
      const localTimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

      sql += ` AND recorded_at >= ?`;
      params.push(localTimeStr);
    }

    if (endTime) {
      // Convert Date to local time string format: YYYY-MM-DD HH:MM:SS
      const year = endTime.getFullYear();
      const month = String(endTime.getMonth() + 1).padStart(2, '0');
      const day = String(endTime.getDate()).padStart(2, '0');
      const hours = String(endTime.getHours()).padStart(2, '0');
      const minutes = String(endTime.getMinutes()).padStart(2, '0');
      const seconds = String(endTime.getSeconds()).padStart(2, '0');
      const localTimeStr = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;

      sql += ` AND recorded_at <= ?`;
      params.push(localTimeStr);
    }

    sql += ' ORDER BY recorded_at DESC';

    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as Array<{
      id: number;
      qq_id: string;
      electric: number;
      water: number;
      ac: number;
      room: string | null;
      recorded_at: string;
    }>;
  }

  /**
   * Get latest billing record for a user
   */
  getLatestBilling(qqId: string): {
    id: number;
    qq_id: string;
    electric: number;
    water: number;
    ac: number;
    room: string | null;
    recorded_at: string;
  } | null {
    const stmt = this.db.prepare(`
      SELECT * FROM billing_history
      WHERE qq_id = ?
      ORDER BY recorded_at DESC
      LIMIT 1
    `);
    return stmt.get(qqId) as {
      id: number;
      qq_id: string;
      electric: number;
      water: number;
      ac: number;
      room: string | null;
      recorded_at: string;
    } | null;
  }

  /**
   * Get billing change in last 24 hours
   */
  getBilling24HourChange(qqId: string): {
    electric: number;
    water: number;
    ac: number;
  } | null {
    // Get the most recent record
    const currentRecord = this.getLatestBilling(qqId);
    if (!currentRecord) {
      return null;
    }

    // Get the record from 24 hours ago or earlier
    const prevStmt = this.db.prepare(`
      SELECT * FROM billing_history
      WHERE qq_id = ? AND datetime(recorded_at) <= datetime('now', 'localtime', '-1 day')
      ORDER BY recorded_at DESC
      LIMIT 1
    `);
    let prevRecord = prevStmt.get(qqId) as typeof currentRecord | null;

    // If no record from 24h ago, fall back to the very first record
    if (!prevRecord) {
      const firstStmt = this.db.prepare(`
        SELECT * FROM billing_history
        WHERE qq_id = ?
        ORDER BY recorded_at ASC
        LIMIT 1
      `);
      prevRecord = firstStmt.get(qqId) as typeof currentRecord | null;
    }

    // If there's still no previous record (i.e., only one record exists), change is 0
    const prevElectric = prevRecord ? prevRecord.electric : currentRecord.electric;
    const prevWater = prevRecord ? prevRecord.water : currentRecord.water;
    const prevAc = prevRecord ? prevRecord.ac : currentRecord.ac;

    return {
      electric: currentRecord.electric - prevElectric,
      water: currentRecord.water - prevWater,
      ac: currentRecord.ac - prevAc
    };
  }

  /**
   * Check if we should collect billing data (hourly collection)
   * Returns true if last record is more than 1 hour old or doesn't exist
   */
  shouldCollectBillingData(qqId: string): boolean {
    const latest = this.getLatestBilling(qqId);
    if (!latest) {
      return true; // No data, should collect
    }

    const lastRecordTime = new Date(latest.recorded_at).getTime();
    const now = Date.now();
    const oneHourInMs = 60 * 60 * 1000;

    return now - lastRecordTime >= oneHourInMs;
  }

  /**
   * Delete old billing history records (keep last N days)
   */
  cleanOldBillingHistory(days: number = 30): number {
    const stmt = this.db.prepare(`
      DELETE FROM billing_history
      WHERE datetime(recorded_at) < datetime('now', 'localtime', '-' || ? || ' days')
    `);
    const result = stmt.run(days);
    return result.changes;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Backup database
   */
  backup(backupPath: string): void {
    this.db.backup(backupPath);
  }

  /**
   * Get the underlying database instance
   */
  getDatabase(): Database.Database {
    return this.db;
  }
}

// Export singleton instance
export const db = new StudentDatabase();

// Create and export scheduler instance using the same database
export const scheduler = new NotificationScheduler(db.getDatabase());

// Export class for testing or custom instances
export { StudentDatabase };
