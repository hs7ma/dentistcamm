const { supabaseAdmin, isAvailable } = require('./supabase');

const UsersDB = {
  _formatUser(row) {
    if (!row) return null;
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      name: row.name,
      userType: row.user_type,
      role: row.role,
      department: row.department,
      stage: row.stage,
      section: row.section,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  },

  _toDbFormat(userData) {
    const dbData = {};
    if (userData.username !== undefined) dbData.username = userData.username;
    if (userData.passwordHash !== undefined) dbData.password_hash = userData.passwordHash;
    if (userData.name !== undefined) dbData.name = userData.name;
    if (userData.userType !== undefined) dbData.user_type = userData.userType;
    if (userData.role !== undefined) dbData.role = userData.role;
    if (userData.department !== undefined) dbData.department = userData.department;
    if (userData.stage !== undefined) dbData.stage = userData.stage;
    if (userData.section !== undefined) dbData.section = userData.section;
    if (userData.isActive !== undefined) dbData.is_active = userData.isActive;
    return dbData;
  },

  async getAll() {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .neq('user_type', 'admin')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data || []).map((row) => this._formatUser(row));
  },

  async getById(id) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return this._formatUser(data);
  },

  async getByUsername(username) {
    if (!isAvailable()) return null;
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('*')
      .eq('username', username)
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    return this._formatUser(data);
  },

  async create(userData) {
    if (!isAvailable()) return null;
    const dbData = this._toDbFormat(userData);
    const { data, error } = await supabaseAdmin
      .from('users')
      .insert(dbData)
      .select()
      .single();
    if (error) throw error;
    return this._formatUser(data);
  },

  async update(id, updates) {
    if (!isAvailable()) return null;
    const dbData = this._toDbFormat(updates);
    dbData.updated_at = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from('users')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return this._formatUser(data);
  },

  async delete(id) {
    if (!isAvailable()) return null;
    const { error } = await supabaseAdmin
      .from('users')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  },

  isAvailable() {
    return isAvailable();
  },
};

module.exports = UsersDB;