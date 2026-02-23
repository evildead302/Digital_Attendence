import { getDatabase } from './db';
import { differenceInDays, parseISO, format } from 'date-fns';

const API_BASE = '/api';

class SyncEngine {
  constructor(userId, token) {
    this.userId = userId;
    this.token = token;
    this.db = getDatabase();
  }
  
  async syncIn(targetDate = new Date()) {
    const startDate = format(new Date(targetDate).setDate(targetDate.getDate() - 90), 'yyyy-MM-dd');
    const endDate = format(new Date(targetDate).setDate(targetDate.getDate() + 7), 'yyyy-MM-dd');
    
    try {
      const response = await fetch(
        `${API_BASE}/ledger?start=${startDate}&end=${endDate}&userId=${this.userId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );
      
      if (!response.ok) throw new Error('Sync failed');
      
      const { entries } = await response.json();
      
      if (entries?.length) {
        await this.db.bulkUpsert(entries.map(entry => ({
          ...entry,
          sync_status: 'synced'
        })));
      }
      
      await this.db.syncMeta.put({ 
        key: 'last_sync', 
        value: new Date().toISOString() 
      });
      
      return { success: true, count: entries?.length || 0 };
    } catch (error) {
      console.error('Sync in failed:', error);
      throw error;
    }
  }
  
  async syncOut() {
    try {
      const pendingEntries = await this.db.getPendingSync();
      
      if (pendingEntries.length === 0) {
        return { success: true, synced: 0 };
      }
      
      const response = await fetch(`${API_BASE}/ledger/sync`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ entries: pendingEntries })
      });
      
      if (!response.ok) throw new Error('Sync out failed');
      
      const { synced } = await response.json();
      
      // Mark as synced
      for (const entry of pendingEntries) {
        await this.db.ledger.update(entry.date, {
          sync_status: 'synced'
        });
      }
      
      await this.db.syncMeta.put({ 
        key: 'last_sync', 
        value: new Date().toISOString() 
      });
      
      return { success: true, synced: pendingEntries.length };
    } catch (error) {
      console.error('Sync out failed:', error);
      throw error;
    }
  }
  
  async searchArchive(startDate, endDate) {
    try {
      const response = await fetch(
        `${API_BASE}/ledger/archive?start=${startDate}&end=${endDate}&userId=${this.userId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.token}`
          }
        }
      );
      
      if (!response.ok) throw new Error('Archive search failed');
      
      const { entries } = await response.json();
      return entries || [];
    } catch (error) {
      console.error('Archive search failed:', error);
      throw error;
    }
  }
}

export const createSyncEngine = (userId, token) => {
  return new SyncEngine(userId, token);
};