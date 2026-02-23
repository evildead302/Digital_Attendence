import Dexie from 'dexie';

class DiaryDatabase extends Dexie {
  constructor(userId) {
    super(`DiaryDB_${userId}`);
    
    this.version(1).stores({
      ledger: 'date, user_id, sync_status, check_in, check_out',
      syncMeta: 'key',
      userSettings: 'key'
    });
    
    this.ledger = this.table('ledger');
    this.syncMeta = this.table('syncMeta');
    this.userSettings = this.table('userSettings');
  }
  
  async getDateRange(startDate, endDate) {
    return await this.ledger
      .where('date')
      .between(startDate, endDate, true, true)
      .toArray();
  }
  
  async getPendingSync() {
    return await this.ledger
      .where('sync_status')
      .equals('pending')
      .toArray();
  }
  
  async upsertEntry(entry) {
    const existing = await this.ledger.get(entry.date);
    if (existing) {
      return await this.ledger.update(entry.date, entry);
    } else {
      return await this.ledger.add(entry);
    }
  }
  
  async bulkUpsert(entries) {
    return await this.ledger.bulkPut(entries);
  }
}

let dbInstance = null;

export const initDatabase = (userId) => {
  if (!userId) throw new Error('User ID required');
  dbInstance = new DiaryDatabase(userId);
  return dbInstance;
};

export const getDatabase = () => {
  if (!dbInstance) throw new Error('Database not initialized');
  return dbInstance;
};

export const closeDatabase = () => {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
};
