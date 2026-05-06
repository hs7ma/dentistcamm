const { supabaseAdmin, isAvailable } = require('./supabase');
const UsersDB = require('./users.db');
const { ClimateDB, ClimateSettingsDB, RelayDB } = require('./climate.db');
const { IrrigationDB, UnitStateDB, InventoryDB } = require('./irrigation.db');
const CentralPumpDB = require('./pump.db');
const EventsDB = require('./events.db');

module.exports = {
  supabase: require('./supabase').supabase,
  supabaseAdmin: require('./supabase').supabaseAdmin,
  isAvailable,
  testConnection: require('./supabase').testConnection,
  UsersDB,
  ClimateDB,
  ClimateSettingsDB,
  RelayDB,
  IrrigationDB,
  UnitStateDB,
  InventoryDB,
  CentralPumpDB,
  EventsDB,
};