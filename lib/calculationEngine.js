import { differenceInMinutes, parseISO, format, addDays, differenceInDays } from 'date-fns';
import { getDatabase } from './db';

class CalculationEngine {
  constructor(userId) {
    this.userId = userId;
    this.db = getDatabase();
  }
  
  calculateRow(entry) {
    const {
      check_in,
      check_out,
      base_hours = 8,
      ot_cap = 2,
      cpl_grant = 0,
      is_off_day = false,
      al_used = 0,
      sl_used = 0,
      cl_used = 0,
      cpl_used = 0
    } = entry;
    
    // Reset calculated fields
    let final_ot_hours = 0;
    let cpl_earned = 0;
    
    // Check if any leave is used
    const hasLeave = al_used > 0 || sl_used > 0 || cl_used > 0;
    
    if (!hasLeave && !is_off_day && check_in && check_out) {
      // Calculate worked hours
      const checkInTime = parseISO(`${entry.date}T${check_in}`);
      const checkOutTime = parseISO(`${entry.date}T${check_out}`);
      const workedMinutes = differenceInMinutes(checkOutTime, checkInTime);
      const workedHours = workedMinutes / 60;
      
      // Calculate OT
      const rawOT = Math.max(0, workedHours - base_hours);
      final_ot_hours = Math.min(rawOT, ot_cap);
      
      // Calculate CPL earned
      cpl_earned = cpl_grant > 0 ? cpl_grant : 0;
    }
    
    return {
      ...entry,
      final_ot_hours,
      cpl_earned,
      sync_status: 'pending'
    };
  }
  
  async recalculateDate(date) {
    const entry = await this.db.ledger.get(date);
    if (!entry) return null;
    
    const recalculated = this.calculateRow(entry);
    await this.db.ledger.update(date, recalculated);
    return recalculated;
  }
  
  async recalculateDateRange(startDate, endDate) {
    const entries = await this.db.getDateRange(startDate, endDate);
    const updates = [];
    
    for (const entry of entries) {
      const recalculated = this.calculateRow(entry);
      updates.push(this.db.ledger.update(entry.date, recalculated));
    }
    
    await Promise.all(updates);
    return updates.length;
  }
  
  async calculateBalances() {
    const today = format(new Date(), 'yyyy-MM-dd');
    const oneYearAgo = format(addDays(new Date(), -365), 'yyyy-MM-dd');
    const sixMonthsAgo = format(addDays(new Date(), -180), 'yyyy-MM-dd');
    
    const entries = await this.db.getDateRange(oneYearAgo, today);
    
    let alBalance = 0;
    let slBalance = 0;
    let clBalance = 0;
    let cplBalance = 
