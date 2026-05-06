const { supabaseAdmin, isAvailable } = require('./supabase');

const EventsDB = {
  async logEvent(category, eventType, title, details = {}) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('system_events')
      .insert({
        event_category: category,
        event_type: eventType,
        title,
        severity: details.severity || 'info',
        description: details.description,
        metadata: details.metadata,
        source_type: details.sourceType,
        source_id: details.sourceId,
      })
      .select()
      .single();
    if (error) {
      console.error('[EventsDB] Failed to log event:', error);
      return null;
    }
    return data;
  },

  async logAudit(userId, action, tableName, recordId, oldValues, newValues, description) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('audit_log')
      .insert({
        user_id: userId,
        action,
        table_name: tableName,
        record_id: recordId,
        old_values: oldValues,
        new_values: newValues,
        description,
      })
      .select()
      .single();
    if (error) {
      console.error('[EventsDB] Failed to log audit:', error);
      return null;
    }
    return data;
  },
};

module.exports = EventsDB;