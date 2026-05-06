const { supabaseAdmin, isAvailable } = require('./supabase');

const MAX_READINGS_PER_DEVICE = 10;

const ClimateDB = {
  async saveReading(deviceId, temperature, humidity) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('climate_readings')
      .insert({
        device_id: deviceId,
        temperature,
        humidity,
        recorded_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (error) throw error;
    this.cleanupOldReadings(deviceId).catch((err) => {
      console.error('[ClimateDB] Cleanup error:', err.message);
    });
    return data;
  },

  async cleanupOldReadings(deviceId) {
    if (!isAvailable()) return;
    const { data: oldReadings } = await supabaseAdmin
      .from('climate_readings')
      .select('id')
      .eq('device_id', deviceId)
      .order('recorded_at', { ascending: false })
      .range(MAX_READINGS_PER_DEVICE, MAX_READINGS_PER_DEVICE + 100);
    if (oldReadings && oldReadings.length > 0) {
      const idsToDelete = oldReadings.map((r) => r.id);
      await supabaseAdmin
        .from('climate_readings')
        .delete()
        .in('id', idsToDelete);
    }
  },

  async getLatestReading(deviceId) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('climate_readings')
      .select('*')
      .eq('device_id', deviceId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return data;
  },

  async getReadings(deviceId, hours = 24) {
    if (!isAvailable()) return null;
    const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from('climate_readings')
      .select('*')
      .eq('device_id', deviceId)
      .gte('recorded_at', since)
      .order('recorded_at', { ascending: true });
    if (error) throw error;
    return data;
  },
};

const RelayDB = {
  async logEvent(deviceId, relayId, eventType, details = {}) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('relay_events')
      .insert({
        device_id: deviceId,
        relay_id: relayId,
        event_type: eventType,
        ...details,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async getEvents(deviceId, relayId = null, limit = 50) {
    if (!isAvailable()) return null;
    let query = supabaseAdmin
      .from('relay_events')
      .select('*')
      .eq('device_id', deviceId);
    if (relayId) {
      query = query.eq('relay_id', relayId);
    }
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },
};

const ClimateSettingsDB = {
  async getSettings() {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('climate_settings')
      .select('*')
      .eq('setting_key', 'default')
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    return {
      enabled: data.enabled,
      targetTemperature: parseFloat(data.target_temperature),
      targetHumidity: parseFloat(data.target_humidity),
      temperatureTolerance: parseFloat(data.temperature_tolerance),
      humidityTolerance: parseFloat(data.humidity_tolerance),
    };
  },

  async saveSettings(settings) {
    if (!isAvailable()) return null;
    const { enabled, targetTemperature, targetHumidity, temperatureTolerance, humidityTolerance } = settings;
    const { data, error } = await supabaseAdmin
      .from('climate_settings')
      .upsert({
        setting_key: 'default',
        enabled,
        target_temperature: targetTemperature,
        target_humidity: targetHumidity,
        temperature_tolerance: temperatureTolerance,
        humidity_tolerance: humidityTolerance,
      }, { onConflict: 'setting_key' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  async saveRelayState(relayState) {
    if (!isAvailable()) return null;
    const { error } = await supabaseAdmin
      .from('climate_settings')
      .upsert({
        setting_key: 'relay_state',
        enabled: false,
        target_temperature: 0,
        target_humidity: 0,
        temperature_tolerance: 0,
        humidity_tolerance: 0,
        extra_json: JSON.stringify(relayState),
      }, { onConflict: 'setting_key' });
    if (error) throw error;
  },

  async getRelayState() {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('climate_settings')
      .select('extra_json')
      .eq('setting_key', 'relay_state')
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    if (!data || !data.extra_json) return null;
    return typeof data.extra_json === 'string'
      ? JSON.parse(data.extra_json)
      : data.extra_json;
  },

  async saveThresholds(thresholds) {
    if (!isAvailable()) return null;
    const { error } = await supabaseAdmin
      .from('climate_settings')
      .upsert({
        setting_key: 'thresholds',
        enabled: false,
        target_temperature: 0,
        target_humidity: 0,
        temperature_tolerance: 0,
        humidity_tolerance: 0,
        extra_json: JSON.stringify(thresholds),
      }, { onConflict: 'setting_key' });
    if (error) throw error;
  },

  async getThresholds() {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('climate_settings')
      .select('extra_json')
      .eq('setting_key', 'thresholds')
      .single();
    if (error) {
      if (error.code === 'PGRST116') return null;
      throw error;
    }
    if (!data || !data.extra_json) return null;
    return typeof data.extra_json === 'string'
      ? JSON.parse(data.extra_json)
      : data.extra_json;
  },
};

module.exports = { ClimateDB, ClimateSettingsDB, RelayDB };