const { supabaseAdmin, isAvailable } = require('./supabase');

const MAX_READINGS_PER_DEVICE = 10;

const IrrigationDB = {
  async saveReading(unitId, readings) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('irrigation_readings')
      .insert({
        unit_id: unitId,
        soil_moisture: readings.soilMoisture,
        water_flow: readings.waterFlow,
        total_water_consumed: readings.totalWaterConsumed,
        irrigation_active: readings.irrigationActive,
        current_mode: readings.currentMode,
        recorded_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    this.cleanupOldReadings(unitId).catch((err) => {
      console.error('[IrrigationDB] Cleanup error:', err.message);
    });
    return data;
  },

  async cleanupOldReadings(unitId) {
    if (!isAvailable()) return;
    const { data: oldReadings } = await supabaseAdmin
      .from('irrigation_readings')
      .select('id')
      .eq('unit_id', unitId)
      .order('recorded_at', { ascending: false })
      .range(MAX_READINGS_PER_DEVICE, MAX_READINGS_PER_DEVICE + 100);
    if (oldReadings && oldReadings.length > 0) {
      const idsToDelete = oldReadings.map((r) => r.id);
      await supabaseAdmin
        .from('irrigation_readings')
        .delete()
        .in('id', idsToDelete);
    }
  },

  async startSession(unitId, mode, targetValue, moistureBefore) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('irrigation_sessions')
      .insert({
        unit_id: unitId,
        irrigation_mode: mode,
        target_value: targetValue,
        moisture_before: moistureBefore,
        status: 'running',
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async endSession(sessionId, actualValue, waterConsumed, moistureAfter, status = 'completed') {
    if (!isAvailable()) return null;
    const endedAt = new Date();
    const { data: session } = await supabaseAdmin
      .from('irrigation_sessions')
      .select('started_at')
      .eq('id', sessionId)
      .single();
    const startedAt = session ? new Date(session.started_at) : endedAt;
    const durationSeconds = Math.round((endedAt - startedAt) / 1000);
    const { data, error } = await supabaseAdmin
      .from('irrigation_sessions')
      .update({
        actual_value: actualValue,
        water_consumed: waterConsumed,
        moisture_after: moistureAfter,
        status,
        ended_at: endedAt.toISOString(),
        duration_seconds: durationSeconds,
      })
      .eq('id', sessionId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async updateWaterCounters(unitId, totalWaterConsumed, flowRate) {
    if (!isAvailable()) return null;
    const updateData = { total_water_consumed: totalWaterConsumed };
    if (typeof flowRate === 'number') {
      updateData.water_flow = flowRate;
    }
    const { data, error } = await supabaseAdmin
      .from('unit_state')
      .update(updateData)
      .eq('unit_id', unitId)
      .select()
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async getTodayStats(unitId) {
    if (!isAvailable()) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { data, error } = await supabaseAdmin
      .from('irrigation_sessions')
      .select('*')
      .eq('unit_id', unitId)
      .gte('started_at', today.toISOString())
      .eq('status', 'completed');
    if (error) throw error;
    return {
      sessionCount: data?.length || 0,
      totalWater: data?.reduce((sum, s) => sum + (s.water_consumed || 0), 0) || 0,
    };
  },
};

const UnitStateDB = {
  _formatUnitState(row) {
    if (!row) return null;
    return {
      unitId: row.unit_id,
      sensorData: {
        soilMoisture: row.soil_moisture,
        waterFlow: row.water_flow,
        totalWaterConsumed: row.total_water_consumed,
        irrigationActive: row.irrigation_active,
        currentMode: row.current_mode,
        connected: row.connected,
        pumpRequested: row.pump_requested,
        updatedAt: row.sensor_updated_at,
      },
      control: {
        irrigationMode: row.irrigation_mode,
        quantitativeValue: row.quantitative_value,
        quantitativeSchedule: row.quantitative_schedule,
        quantitativeInterval: row.quantitative_interval,
        quantitativeDailyHour: row.quantitative_daily_hour,
        quantitativeDailyMinute: row.quantitative_daily_minute,
        temporalValue: row.temporal_value,
        temporalSchedule: row.temporal_schedule,
        temporalInterval: row.temporal_interval,
        temporalDailyHour: row.temporal_daily_hour,
        temporalDailyMinute: row.temporal_daily_minute,
        moistureThreshold: row.moisture_threshold,
        moistureCheckInterval: row.moisture_check_interval,
        moistureIrrigationType: row.moisture_irrigation_type,
        moistureIrrigationValue: row.moisture_irrigation_value,
        manualPump: row.manual_pump,
        manualValveOpen: row.manual_valve_open,
        manualValveClose: row.manual_valve_close,
        manualIrrigationToggle: row.manual_irrigation_toggle,
        enableTimeWindow: row.enable_time_window,
        allowedStartHour: row.allowed_start_hour,
        allowedEndHour: row.allowed_end_hour,
        enableDailyLimit: row.enable_daily_limit,
        maxSessionsPerDay: row.max_sessions_per_day,
        enableMinInterval: row.enable_min_interval,
        minIntervalMinutes: row.min_interval_minutes,
        enableDailyConsumption: row.enable_daily_consumption,
        maxLitersPerDay: row.max_liters_per_day,
        enableMoistureSkip: row.enable_moisture_skip,
        skipIfMoistureAbove: row.skip_if_moisture_above,
        enableLeakDetection: row.enable_leak_detection,
        enableBlockageDetection: row.enable_blockage_detection,
        expectedFlowRate: row.expected_flow_rate,
        resetTotalWater: row.reset_total_water,
      },
    };
  },

  async getOrCreate(unitId) {
    if (!isAvailable()) return null;
    let { data, error } = await supabaseAdmin
      .from('unit_state')
      .select('*')
      .eq('unit_id', unitId)
      .single();
    if (error && error.code === 'PGRST116') {
      const { data: newData, error: insertError } = await supabaseAdmin
        .from('unit_state')
        .insert({ unit_id: unitId })
        .select()
        .single();
      if (insertError) throw insertError;
      data = newData;
    } else if (error) {
      throw error;
    }
    return this._formatUnitState(data);
  },

  async updateSensorData(unitId, sensorData) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('unit_state')
      .upsert({
        unit_id: unitId,
        soil_moisture: sensorData.soilMoisture,
        water_flow: sensorData.waterFlow,
        total_water_consumed: sensorData.totalWaterConsumed,
        irrigation_active: sensorData.irrigationActive,
        current_mode: sensorData.currentMode,
        connected: true,
        sensor_updated_at: new Date().toISOString(),
      }, { onConflict: 'unit_id' })
      .select()
      .single();
    if (error) throw error;
    return this._formatUnitState(data);
  },

  async updateControl(unitId, control) {
    if (!isAvailable()) return null;
    const updateData = { unit_id: unitId };
    const mapping = {
      irrigationMode: 'irrigation_mode',
      quantitativeValue: 'quantitative_value',
      quantitativeSchedule: 'quantitative_schedule',
      quantitativeInterval: 'quantitative_interval',
      quantitativeDailyHour: 'quantitative_daily_hour',
      quantitativeDailyMinute: 'quantitative_daily_minute',
      temporalValue: 'temporal_value',
      temporalSchedule: 'temporal_schedule',
      temporalInterval: 'temporal_interval',
      temporalDailyHour: 'temporal_daily_hour',
      temporalDailyMinute: 'temporal_daily_minute',
      moistureThreshold: 'moisture_threshold',
      moistureCheckInterval: 'moisture_check_interval',
      moistureIrrigationType: 'moisture_irrigation_type',
      moistureIrrigationValue: 'moisture_irrigation_value',
      manualPump: 'manual_pump',
      manualValveOpen: 'manual_valve_open',
      manualValveClose: 'manual_valve_close',
      manualIrrigationToggle: 'manual_irrigation_toggle',
      enableTimeWindow: 'enable_time_window',
      allowedStartHour: 'allowed_start_hour',
      allowedEndHour: 'allowed_end_hour',
      enableDailyLimit: 'enable_daily_limit',
      maxSessionsPerDay: 'max_sessions_per_day',
      enableMinInterval: 'enable_min_interval',
      minIntervalMinutes: 'min_interval_minutes',
      enableDailyConsumption: 'enable_daily_consumption',
      maxLitersPerDay: 'max_liters_per_day',
      enableMoistureSkip: 'enable_moisture_skip',
      skipIfMoistureAbove: 'skip_if_moisture_above',
      enableLeakDetection: 'enable_leak_detection',
      enableBlockageDetection: 'enable_blockage_detection',
      expectedFlowRate: 'expected_flow_rate',
      resetTotalWater: 'reset_total_water',
    };
    for (const [jsKey, dbKey] of Object.entries(mapping)) {
      if (control[jsKey] !== undefined) {
        updateData[dbKey] = control[jsKey];
      }
    }
    const { data, error } = await supabaseAdmin
      .from('unit_state')
      .upsert(updateData, { onConflict: 'unit_id' })
      .select()
      .single();
    if (error) throw error;
    return this._formatUnitState(data);
  },

  async getAll() {
    if (!isAvailable()) return [];
    const { data, error } = await supabaseAdmin
      .from('unit_state')
      .select('*')
      .order('unit_id');
    if (error) throw error;
    return (data || []).map((row) => this._formatUnitState(row));
  },

  async checkConnection(unitId, timeoutMs = 15000) {
    if (!isAvailable()) return false;
    const { data } = await supabaseAdmin
      .from('unit_state')
      .select('sensor_updated_at')
      .eq('unit_id', unitId)
      .single();
    if (!data || !data.sensor_updated_at) return false;
    const lastUpdate = new Date(data.sensor_updated_at).getTime();
    return (Date.now() - lastUpdate) < timeoutMs;
  },

  async resetWaterCounter(unitId) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('unit_state')
      .update({
        total_water_consumed: 0,
        reset_total_water: false,
      })
      .eq('unit_id', unitId)
      .select()
      .single();
    if (error) throw error;
    return this._formatUnitState(data);
  },
};

const InventoryDB = {
  async getGreenhouseLayout() {
    if (!isAvailable()) return null;
    const { data: beds, error: bedsError } = await supabaseAdmin
      .from('greenhouse_beds')
      .select('*')
      .order('bed_number', { ascending: true });
    if (bedsError) throw bedsError;
    for (const bed of beds || []) {
      const { data: plants } = await supabaseAdmin
        .from('bed_plants')
        .select('*, plants_catalog(*)')
        .eq('bed_id', bed.id);
      bed.plants = plants?.map((p) => ({
        id: p.plant_id || p.id,
        name: p.plant_name || p.plants_catalog?.name,
        category: p.plants_catalog?.category,
        variety: p.variety,
        notes: p.notes,
      })) || [];
    }
    return { beds };
  },

  async getInventory() {
    if (!isAvailable()) return null;
    const { data: plants, error: plantsError } = await supabaseAdmin
      .from('plants_catalog')
      .select('*')
      .eq('is_active', true);
    if (plantsError) throw plantsError;
    const { data: fertilizers, error: fertError } = await supabaseAdmin
      .from('fertilizers_stock')
      .select('*')
      .eq('is_active', true);
    if (fertError) throw fertError;
    return { plants, fertilizers };
  },
};

module.exports = { IrrigationDB, UnitStateDB, InventoryDB };