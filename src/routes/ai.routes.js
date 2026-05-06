const express = require('express');
const multer = require('multer');
const aiService = require('../services/ai.service');
const { supabaseAdmin } = require('../db/supabase');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

router.use(express.json({ limit: '1mb' }));

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '') || req.headers['x-eco-token'] || req.query?.token;
  if (!token) {
    return res.status(401).json({ ok: false, error: 'يرجى تسجيل الدخول أولاً' });
  }

  try {
    const jwt = require('jsonwebtoken');
    const config = require('../config');
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ ok: false, error: 'يرجى تسجيل الدخول أولاً' });
  }
}

router.get('/chats', requireAuth, async (req, res) => {
  try {
    const chats = await aiService.getAllChats();
    res.json({ ok: true, chats });
  } catch (error) {
    console.error('[AI] Get chats error:', error);
    res.status(500).json({ ok: false, error: 'فشل في جلب المحادثات' });
  }
});

router.get('/chat/:chatId', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;
    const chat = await aiService.getChat(chatId);
    if (!chat) {
      return res.status(404).json({ ok: false, error: 'المحادثة غير موجودة' });
    }
    const messages = await aiService.getChatMessages(chatId);
    res.json({ ok: true, messages });
  } catch (error) {
    console.error('[AI] Get chat error:', error);
    res.status(500).json({ ok: false, error: 'فشل في جلب المحادثة' });
  }
});

router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { message, chatId: incomingChatId, fileId } = req.body;

    if (!message && !fileId) {
      return res.status(400).json({ ok: false, error: 'الرسالة مطلوبة' });
    }

    let chatId = incomingChatId;

    if (chatId) {
      const chat = await aiService.getChat(chatId);
      if (!chat) {
        return res.status(404).json({ ok: false, error: 'المحادثة غير موجودة' });
      }
    } else {
      const newChat = await aiService.createChat();
      chatId = newChat.id;
    }

    let userContent = message || 'الرجاء تحليل هذه الصورة.';
    if (fileId) {
      userContent = JSON.stringify({
        type: 'image',
        fileId,
        text: message || 'الرجاء تحليل هذه الصورة.',
      });
    }

    await aiService.saveMessage(chatId, 'user', userContent);

    const dbMessages = await aiService.getChatMessages(chatId);

    const formattedMessages = dbMessages.map(m => ({
      role: m.role,
      content: m.content,
    }));

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    const { fullText } = await aiService.streamChat(formattedMessages, chatId, fileId);

    await aiService.saveMessage(chatId, 'assistant', fullText);

    res.write(`0:${JSON.stringify(fullText)}\n`);
    res.write(`2:${JSON.stringify([{ chatId }])}\n`);
    res.end();
  } catch (error) {
    console.error('[AI] Chat error:', error);
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: 'فشل في معالجة الرسالة' });
    } else {
      res.end();
    }
  }
});

router.post('/upload', requireAuth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'لم يتم رفع أي ملف' });
    }

    const fileName = `public/${Date.now()}_${req.file.originalname || 'image.jpg'}`;
    const result = await aiService.uploadImage(req.file.buffer, fileName);

    const publicUrl = aiService.getImagePublicUrl(result.path);

    res.json({ ok: true, fileId: result.path, url: publicUrl });
  } catch (error) {
    console.error('[AI] Upload error:', error);
    res.status(500).json({ ok: false, error: 'فشل في رفع الصورة' });
  }
});

router.delete('/chat/:chatId', requireAuth, async (req, res) => {
  try {
    const { chatId } = req.params;

    await supabaseAdmin.from('messages').delete().eq('chat_id', chatId);
    await supabaseAdmin.from('chats').delete().eq('id', chatId);

    res.json({ ok: true });
  } catch (error) {
    console.error('[AI] Delete chat error:', error);
    res.status(500).json({ ok: false, error: 'فشل في حذف المحادثة' });
  }
});

router.get('/greenhouse', requireAuth, async (req, res) => {
  try {
    const data = await aiService.getGreenhouseData();
    res.json({ ok: true, data });
  } catch (error) {
    console.error('[AI] Greenhouse data error:', error);
    res.status(500).json({ ok: false, error: 'فشل في جلب بيانات الدفيئة' });
  }
});

module.exports = router;