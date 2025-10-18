#!/usr/bin/env node
/**
 * Database Management CLI
 * Usage: tsx src/db-cli.ts <command> [args]
 */

import { Campus, db } from '../src/utils/database.js';

const commands = {
  list: () => {
    const students = db.getAllStudents();
    console.log(`\nTotal students: ${students.length}\n`);
    console.log('ID\tQQ ID\t\tCard ID\t\tName\t\tStudent #\tLast Login');
    console.log('─'.repeat(100));
    students.forEach((s) => {
      console.log(
        `${s.id}\t${s.qq_id}\t${s.card_id}\t${s.name || 'N/A'}\t${s.student_number || 'N/A'}\t${s.last_login || 'Never'}`
      );
    });
    console.log();
  },

  count: () => {
    const count = db.getStudentCount();
    console.log(`\nTotal students: ${count}\n`);
  },

  get: (qqId: string) => {
    if (!qqId) {
      console.error('Usage: get <qq_id>');
      return;
    }
    const student = db.getStudent(qqId);
    if (student) {
      console.log('\nStudent Information:');
      console.log(JSON.stringify(student, null, 2));
      console.log();
    } else {
      console.log(`\nNo student found with QQ ID: ${qqId}\n`);
    }
  },

  credentials: (qqId: string) => {
    if (!qqId) {
      console.error('Usage: credentials <qq_id>');
      return;
    }
    const credentials = db.getCredentials(qqId);
    if (credentials) {
      console.log('\nCredentials:');
      console.log(`Card ID: ${credentials.cardId}`);
      console.log(`Password: ${credentials.password}`);
      console.log();
    } else {
      console.log(`\nNo credentials found for QQ ID: ${qqId}\n`);
    }
  },

  add: (qqId: string, cardId: string, campus: Campus, password: string, name?: string, sno?: string) => {
    if (!qqId || !cardId || !password) {
      console.error('Usage: add <qq_id> <card_id> <password> [name] [student_number]');
      return;
    }
    const student = db.addStudent(qqId, cardId, campus, password, name, sno);
    console.log('\nStudent added/updated:');
    console.log(JSON.stringify(student, null, 2));
    console.log();
  },

  delete: (qqId: string) => {
    if (!qqId) {
      console.error('Usage: delete <qq_id>');
      return;
    }
    const deleted = db.deleteStudent(qqId);
    if (deleted) {
      console.log(`\nStudent with QQ ID ${qqId} has been deleted.\n`);
    } else {
      console.log(`\nNo student found with QQ ID: ${qqId}\n`);
    }
  },

  backup: (path?: string) => {
    const backupPath = path || `students-backup-${Date.now()}.db`;
    db.backup(backupPath);
    console.log(`\nDatabase backed up to: ${backupPath}\n`);
  },

  help: () => {
    console.log(`
Database Management CLI

Commands:
  list                                    List all students
  count                                   Show total student count
  get <qq_id>                            Get student information
  credentials <qq_id>                    Get decrypted credentials
  add <qq_id> <card_id> <password>       Add/update student
      [name] [student_number]
  delete <qq_id>                         Delete student
  backup [path]                          Backup database
  help                                    Show this help message

Examples:
  tsx src/db-cli.ts list
  tsx src/db-cli.ts get 123456789
  tsx src/db-cli.ts add 123456789 CARD001 pass123 "Zhang San" 2021001
  tsx src/db-cli.ts delete 123456789
  tsx src/db-cli.ts backup ./backups/students.db
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
