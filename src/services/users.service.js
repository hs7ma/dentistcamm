const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { UsersDB } = require('../db');
const { isAvailable } = require('../db/supabase');

const USERS_FILE = path.join(__dirname, '../../users.json');

function generateUsername(name, userType) {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let prefix = '';
  for (let i = 0; i < 4; i++) {
    prefix += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  const typeCode = userType === 'student' ? 'st' : 'em';
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}_${typeCode}_${randomNum}`;
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}

function generateUserId() {
  return 'user_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
}

let usersCache = [];

function loadUsersFromFile() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const data = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(data).users || [];
    }
  } catch (error) {
    console.error('Error loading users from file:', error.message);
  }
  return [];
}

function saveUsersToFile(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving users to file:', error.message);
    return false;
  }
}

function initUsersCache() {
  usersCache = loadUsersFromFile();
}

const UsersService = {
  init() {
    initUsersCache();
  },

  getCache() {
    return usersCache;
  },

  async getAll() {
    let allUsers = [];
    if (isAvailable()) {
      try {
        allUsers = await UsersDB.getAll();
        usersCache = allUsers;
      } catch (err) {
        console.error('[Users] Supabase error:', err.message);
        allUsers = usersCache;
      }
    } else {
      allUsers = usersCache;
    }
    return allUsers.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      userType: u.userType,
      department: u.department,
      stage: u.stage,
      section: u.section,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
  },

  async getById(userId) {
    let user = null;
    if (isAvailable()) {
      try {
        user = await UsersDB.getById(userId);
      } catch (err) {
        console.error('[Users] Supabase getById error:', err.message);
      }
    }
    if (!user) {
      user = usersCache.find((u) => u.id === userId);
    }
    return user;
  },

  async login(username, password) {
    const config = require('../config');
    if (username === config.admin.username) {
      if (bcrypt.compareSync(password, config.admin.passwordHash)) {
        const jwt = require('jsonwebtoken');
        const token = jwt.sign(
          { id: 'admin', username: config.admin.username, role: 'admin', name: '\u0645\u062f\u064a\u0631 \u0627\u0644\u0646\u0638\u0627\u0645' },
          config.jwt.secret,
          { expiresIn: config.jwt.expiresIn }
        );
        return {
          ok: true,
          token,
          user: { id: 'admin', username: config.admin.username, name: '\u0645\u062f\u064a\u0631 \u0627\u0644\u0646\u0638\u0627\u0645', role: 'admin' },
        };
      }
      return { ok: false, error: '\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629' };
    }

    let user = null;
    if (isAvailable()) {
      try {
        user = await UsersDB.getByUsername(username);
      } catch (err) {
        console.error('[Login] Supabase error:', err.message);
      }
    }
    if (!user) {
      user = usersCache.find((u) => u.username === username);
    }
    if (!user) {
      return { ok: false, error: '\u0627\u0633\u0645 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f' };
    }
    if (!bcrypt.compareSync(password, user.passwordHash)) {
      return { ok: false, error: '\u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631 \u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629' };
    }

    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      { id: user.id, username: user.username, role: 'user', name: user.name, userType: user.userType },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );
    return {
      ok: true,
      token,
      user: { id: user.id, username: user.username, name: user.name, role: 'user', userType: user.userType },
    };
  },

  async create(userData) {
    const plainPassword = generatePassword();
    const passwordHash = bcrypt.hashSync(plainPassword, 10);
    const newUserData = {
      id: generateUserId(),
      username: generateUsername(userData.name, userData.userType),
      passwordHash,
      name: userData.name.trim(),
      userType: userData.userType,
      role: 'user',
      department: userData.department?.trim() || null,
      stage: userData.userType === 'student' ? userData.stage?.trim() : null,
      section: userData.userType === 'student' ? userData.section?.trim() : null,
      isActive: true,
    };

    let savedUser = null;
    if (isAvailable()) {
      try {
        savedUser = await UsersDB.create(newUserData);
      } catch (err) {
        console.error('[Users] Supabase create error:', err.message);
      }
    }

    const userForCache = {
      ...newUserData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    usersCache.push(userForCache);
    saveUsersToFile(usersCache);

    const finalUser = savedUser || userForCache;
    return {
      ok: true,
      user: {
        id: finalUser.id,
        username: finalUser.username,
        password: plainPassword,
        name: finalUser.name,
        userType: finalUser.userType,
        department: finalUser.department,
        stage: finalUser.stage,
        section: finalUser.section,
        createdAt: finalUser.createdAt,
      },
      message: '\u062a\u0645 \u0625\u0646\u0634\u0627\u0621 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0646\u062c\u0627\u062d',
    };
  },

  async update(userId, updates) {
    let user = null;
    if (isAvailable()) {
      try {
        user = await UsersDB.getById(userId);
      } catch (err) {
        console.error('[Users] Supabase getById error:', err.message);
      }
    }
    if (!user) {
      const idx = usersCache.findIndex((u) => u.id === userId);
      if (idx !== -1) user = { ...usersCache[idx] };
    }
    if (!user) return { ok: false, error: '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f' };

    let newPassword = null;
    const updateData = {};
    if (updates.name?.trim()) updateData.name = updates.name.trim();
    if (updates.userType && ['student', 'staff'].includes(updates.userType)) {
      updateData.userType = updates.userType;
      if (updates.userType === 'staff') {
        updateData.stage = null;
        updateData.section = null;
      }
    }
    if (updates.department?.trim()) updateData.department = updates.department.trim();
    const finalUserType = updateData.userType ?? user.userType;
    if (finalUserType === 'student') {
      if (updates.stage?.trim()) updateData.stage = updates.stage.trim();
      if (updates.section?.trim()) updateData.section = updates.section.trim();
    }
    if (updates.resetPassword) {
      newPassword = generatePassword();
      updateData.passwordHash = bcrypt.hashSync(newPassword, 10);
    }

    const updatedUser = { ...user, ...updateData, updatedAt: new Date().toISOString() };

    if (isAvailable()) {
      try {
        await UsersDB.update(userId, updateData);
      } catch (err) {
        console.error('[Users] Supabase update error:', err.message);
      }
    }

    const cacheIndex = usersCache.findIndex((u) => u.id === userId);
    if (cacheIndex !== -1) {
      usersCache[cacheIndex] = updatedUser;
    } else {
      usersCache.push(updatedUser);
    }
    saveUsersToFile(usersCache);

    const response = {
      ok: true,
      user: {
        id: updatedUser.id,
        username: updatedUser.username,
        name: updatedUser.name,
        userType: updatedUser.userType,
        department: updatedUser.department,
        stage: updatedUser.stage,
        section: updatedUser.section,
        updatedAt: updatedUser.updatedAt,
      },
      message: '\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0628\u064a\u0627\u0646\u0627\u062a \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0646\u062c\u0627\u062d',
    };
    if (newPassword) {
      response.newPassword = newPassword;
      response.message = '\u062a\u0645 \u062a\u062d\u062f\u064a\u062b \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0648\u0625\u0639\u0627\u062f\u0629 \u062a\u0639\u064a\u064a\u0646 \u0643\u0644\u0645\u0629 \u0627\u0644\u0645\u0631\u0648\u0631';
    }
    return response;
  },

  async delete(userId) {
    const userIndex = usersCache.findIndex((u) => u.id === userId);
    let deletedUser = null;
    if (userIndex !== -1) {
      deletedUser = usersCache[userIndex];
    } else if (isAvailable()) {
      try {
        deletedUser = await UsersDB.getById(userId);
      } catch (err) {
        console.error('[Users] Supabase getById error:', err.message);
      }
    }

    if (!deletedUser) return { ok: false, error: '\u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f' };

    if (isAvailable()) {
      try {
        await UsersDB.delete(userId);
      } catch (err) {
        console.error('[Users] Supabase delete error:', err.message);
      }
    }

    if (userIndex !== -1) {
      usersCache.splice(userIndex, 1);
    }
    saveUsersToFile(usersCache);

    return { ok: true, message: `\u062a\u0645 \u062d\u0630\u0641 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 "${deletedUser.name}" \u0628\u0646\u062c\u0627\u062d` };
  },
};

module.exports = UsersService;