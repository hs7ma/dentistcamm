const { supabaseAdmin, isAvailable } = require('./supabase');

const CentralPumpDB = {
  async getState() {
    if (!isAvailable()) return this._defaultState();
    const { data, error } = await supabaseAdmin
      .from('central_pump_state')
      .select('*')
      .eq('id', 1)
      .single();
    if (error && error.code === 'PGRST116') {
      const { data: newData } = await supabaseAdmin
        .from('central_pump_state')
        .insert({ id: 1 })
        .select()
        .single();
      return this._formatState(newData);
    }
    if (error) throw error;
    return this._formatState(data);
  },

  _defaultState() {
    return {
      active: false,
      requestingUnits: [],
      controlledBy: null,
      lastStateChange: new Date().toISOString(),
    };
  },

  _formatState(row) {
    if (!row) return this._defaultState();
    return {
      active: row.active,
      requestingUnits: row.requesting_units || [],
      controlledBy: row.controlled_by,
      lastStateChange: row.last_state_change,
    };
  },

  async addRequest(unitId) {
    if (!isAvailable()) return null;
    const state = await this.getState();
    const requestingUnits = [...new Set([...state.requestingUnits, unitId])];
    const shouldBeActive = requestingUnits.length > 0;
    const { data, error } = await supabaseAdmin
      .from('central_pump_state')
      .update({
        active: shouldBeActive,
        requesting_units: requestingUnits,
        controlled_by: shouldBeActive ? requestingUnits[0] : null,
      })
      .eq('id', 1)
      .select()
      .single();
    if (error) throw error;
    return this._formatState(data);
  },

  async removeRequest(unitId) {
    if (!isAvailable()) return null;
    const state = await this.getState();
    const requestingUnits = state.requestingUnits.filter((id) => id !== unitId);
    const shouldBeActive = requestingUnits.length > 0;
    const { data, error } = await supabaseAdmin
      .from('central_pump_state')
      .update({
        active: shouldBeActive,
        requesting_units: requestingUnits,
        controlled_by: shouldBeActive ? requestingUnits[0] : null,
      })
      .eq('id', 1)
      .select()
      .single();
    if (error) throw error;
    return this._formatState(data);
  },

  async shouldRun() {
    const state = await this.getState();
    return state.active;
  },

  async updatePumpRequested(unitId, requested) {
    if (!isAvailable()) return null;
    const { error } = await supabaseAdmin
      .from('unit_state')
      .upsert({ unit_id: unitId, pump_requested: !!requested }, { onConflict: 'unit_id' });
    if (error) throw error;
  },

  async setPumpRequest(unitId, requested) {
    if (!isAvailable()) return null;
    if (!unitId) throw new Error('setPumpRequest: unitId is required');
    const { data, error } = await supabaseAdmin.rpc('pump_set_request', {
      p_unit_id: unitId,
      p_requested: !!requested,
    });
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    try {
      await supabaseAdmin
        .from('unit_state')
        .upsert({ unit_id: unitId, pump_requested: !!requested }, { onConflict: 'unit_id' });
    } catch (e) {
      console.warn(`[CentralPumpDB] unit_state sync warn for ${unitId}:`, e.message);
    }
    return {
      active: !!row.active,
      requestingUnits: row.requesting_units ?? [],
      controlledBy: row.controlled_by ?? null,
pumpSeq: typeof row.pump_seq === 'string' ? Number(row.pump_seq) : (row.pump_seq ?? 0),
      lastStateChange: row.last_state_change,
    };
  },

  async getStateAtomic() {
  if (!isAvailable()) return { active: false, requestingUnits: [], controlledBy: null, pumpSeq: 0 };
  const { data, error } = await supabaseAdmin.rpc('pump_get_state');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { active: false, requestingUnits: [], controlledBy: null, pumpSeq: 0 };
  return {
    active: !!row.active,
    requestingUnits: row.requesting_units ?? [],
    controlledBy: row.controlled_by ?? null,
      pumpSeq: typeof row.pump_seq === 'string' ? Number(row.pump_seq) : (row.pump_seq || 0),
      lastStateChange: row.last_state_change,
    };
  },

  async deriveStateFromUnits(timeoutSeconds = 15) {
    if (!isAvailable()) return { active: false, requestingUnits: [] };
    const cutoff = new Date(Date.now() - timeoutSeconds * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from('unit_state')
      .select('unit_id, pump_requested, sensor_updated_at')
      .eq('pump_requested', true)
      .gte('sensor_updated_at', cutoff);
    if (error) throw error;
    const requestingUnits = (data || []).map((row) => row.unit_id);
    return {
      active: requestingUnits.length > 0,
      requestingUnits,
      controlledBy: requestingUnits[0] ?? null,
    };
  },
};

module.exports = CentralPumpDB;