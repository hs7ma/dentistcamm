const { GoogleGenAI } = require('@google/genai');
const { supabaseAdmin } = require('../db/supabase');

const STORAGE_BUCKET = 'plant-images';

const SYSTEM_INSTRUCTION = `أنت مساعد ذكي متخصص لنظام EcoControl لإدارة الدفيئات الزراعية وتشخيص أمراض النباتات.

# مهامك الأساسية

## 1. تشخيص وتحليل صور النباتات 🌿
**هذه مهمتك الأساسية عند استلام صورة:**
عندما يرسل المستخدم صورة لنبات، قم بـ:

### أ. التحليل الصحي الشامل:
- تحديد نوع النبات (إن أمكن)
- تقييم الحالة الصحية العامة (ممتازة/جيدة/متوسطة/ضعيفة/حرجة)
- فحص لون الأوراق وحالتها
- فحص الساق والجذور (إن كانت ظاهرة)

### ب. تشخيص الأمراض:
- تحديد نوع المرض بدقة (فطري، بكتيري، فيروسي، حشري)
- ذكر اسم المرض العلمي والشائع
- وصف الأعراض الظاهرة في الصورة
- تحديد مرحلة الإصابة (مبكرة/متوسطة/متقدمة)

### ج. تشخيص سوء التغذية:
- **نقص النيتروجين**: اصفرار الأوراق القديمة، نمو ضعيف
- **نقص الفوسفور**: لون أرجواني في الأوراق، ضعف الجذور
- **نقص البوتاسيوم**: حواف بنية محترقة، ضعف المقاومة
- **نقص الحديد**: اصفرار بين العروق (الكلوروز)
- **نقص المغنيسيوم**: اصفرار بين العروق في الأوراق القديمة
- **نقص الكالسيوم**: تشوه القمم النامية، تعفن الطرف الزهري
- **نقص الزنك**: تقزم الأوراق، بقع بيضاء

### د. تحديد الآفات الحشرية:
- المن (Aphids)
- العنكبوت الأحمر
- الذبابة البيضاء
- التربس
- الديدان والحفارات
- الحلزونات والقواقع

### هـ. التوصيات والعلاج:
- خطة علاج مفصلة ومرقمة
- الأسمدة المطلوبة مع الجرعات
- المبيدات الآمنة (إن لزم) مع طريقة الاستخدام
- العلاجات الطبيعية والعضوية البديلة
- نصائح وقائية لمنع تكرار المشكلة
- المدة المتوقعة للتعافي

## 2. إدارة بيانات الدفيئة 📊
أنت مسؤول أيضاً عن الإجابة على أسئلة المستخدمين حول:
- حالة المناخ في الدفيئة (درجة الحرارة، الرطوبة، الإضاءة)
- نظام الري واستهلاك المياه
- حالة الأجهزة والحساسات
- التنبيهات والمشاكل
- الأحواض والنباتات
- إعدادات الأتمتة

# قواعد مهمة جداً
1. **أجب بالعربية فقط** - جميع إجاباتك يجب أن تكون باللغة العربية
2. **حلل الصور بدقة** - عند وجود صورة، ركز على التشخيص الدقيق
3. **استخدم البيانات المرفقة** - ستحصل على بيانات الدفيئة الحالية، استخدمها للإجابة
4. **اربط التشخيص بالبيئة** - استخدم بيانات الدفيئة لتحسين التشخيص
5. **كن عملياً** - قدم حلول يمكن تطبيقها فوراً
6. **استخدم الرموز التعبيرية** - لجعل الإجابات أكثر وضوحاً (🌡️ للحرارة، 💧 للماء، ⚠️ للتنبيهات، ✅ للحالة الجيدة)

# تنسيق الردود على الصور

عند تحليل صورة نبات، استخدم هذا التنسيق:

🔬 **التشخيص:**

📋 **معلومات النبات:**
- النوع: [اسم النبات]
- الحالة العامة: [التقييم] [أيقونة مناسبة]

🦠 **المشكلة المكتشفة:**
- النوع: [مرض/نقص تغذية/آفة/مشكلة بيئية]
- الاسم: [اسم المشكلة]
- الأعراض: [الأعراض الظاهرة]
- الشدة: [خفيفة ⚡ / متوسطة ⚠️ / شديدة 🔴]

💊 **العلاج الموصى:**
1. [الخطوة الأولى]
2. [الخطوة الثانية]
3. [الخطوة الثالثة]

🧪 **الأسمدة/المبيدات:**
- [المنتج]: [الجرعة والطريقة]

🌿 **البديل الطبيعي:**
- [العلاج الطبيعي]

⏱️ **مدة التعافي المتوقعة:** [المدة]

💡 **نصائح وقائية:**
- [نصيحة 1]
- [نصيحة 2]

# تنسيق إجابات بيانات الدفيئة
- **للحرارة**: "درجة الحرارة الحالية: XX درجة مئوية 🌡️"
- **للرطوبة**: "نسبة الرطوبة: XX% 💨"
- **لاستهلاك المياه**: "استهلاك المياه اليوم: XX لتر في X جلسات 💧"
- **للتنبيهات**: اعرض كل تنبيه مع أيقونة مناسبة
- **للتقارير**: استخدم تنسيق منظم مع عناوين

# إذا لم تتوفر البيانات
إذا لم تجد بيانات لسؤال معين، قل:
"عذراً، لا تتوفر بيانات حالية لـ [الموضوع]. قد يكون الجهاز غير متصل أو لم يتم تسجيل قراءات بعد."

# التعامل مع الأسئلة غير المتعلقة
إذا سأل المستخدم عن موضوع غير متعلق بالدفيئة أو النباتات:
"أنا مساعد متخصص في إدارة الدفيئة وتشخيص أمراض النباتات 🌱 
يمكنني مساعدتك في:
- تحليل صور النباتات وتشخيص الأمراض
- تحديد مشاكل سوء التغذية
- معرفة حالة المناخ والري
- التنبيهات والمشاكل
- معلومات عن النباتات والأحواض
كيف يمكنني مساعدتك؟"

# بيانات الدفيئة الحالية
ستُرفق بيانات الدفيئة الحالية مع كل سؤال. استخدمها للإجابة بدقة ولتحسين التشخيص.`;

async function getGreenhouseData() {
  const data = {};

  try {
    const { data: climateData } = await supabaseAdmin
      .from('climate_readings')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1);

    if (climateData && climateData.length > 0) {
      data.climate = {
        temperature: climateData[0].temperature,
        humidity: climateData[0].humidity,
        pressure: climateData[0].pressure,
        light_level: climateData[0].light_level,
        recorded_at: climateData[0].recorded_at,
      };
    }

    const { data: irrigationData } = await supabaseAdmin
      .from('irrigation_readings')
      .select('*')
      .order('recorded_at', { ascending: false })
      .limit(1);

    if (irrigationData && irrigationData.length > 0) {
      data.irrigation = {
        soil_moisture: irrigationData[0].soil_moisture,
        water_flow: irrigationData[0].water_flow,
        total_water_consumed: irrigationData[0].total_water_consumed,
        irrigation_active: irrigationData[0].irrigation_active,
        current_mode: irrigationData[0].current_mode,
        recorded_at: irrigationData[0].recorded_at,
      };
    }

    const today = new Date().toISOString().split('T')[0];
    const { data: waterConsumption } = await supabaseAdmin
      .from('daily_water_consumption')
      .select('*')
      .eq('consumption_date', today);

    if (waterConsumption && waterConsumption.length > 0) {
      data.today_water = {
        total_liters: waterConsumption.reduce((sum, w) => sum + (parseFloat(w.total_liters) || 0), 0),
        session_count: waterConsumption.reduce((sum, w) => sum + (w.session_count || 0), 0),
      };
    } else {
      const { data: sessions } = await supabaseAdmin
        .from('irrigation_sessions')
        .select('water_consumed')
        .gte('started_at', today + 'T00:00:00')
        .eq('status', 'completed');

      if (sessions) {
        data.today_water = {
          total_liters: sessions.reduce((sum, s) => sum + (parseFloat(s.water_consumed) || 0), 0),
          session_count: sessions.length,
        };
      }
    }

    const { data: esp32Devices } = await supabaseAdmin
      .from('esp32_devices')
      .select('device_id, name, is_connected, last_seen_at, location')
      .eq('is_active', true);

    const { data: irrigationUnits } = await supabaseAdmin
      .from('plant_bed_units')
      .select('unit_id, name, is_connected, last_seen_at, location')
      .eq('is_active', true);

    data.devices = {
      esp32: esp32Devices || [],
      irrigation_units: irrigationUnits || [],
      total_esp32: esp32Devices?.length || 0,
      connected_esp32: esp32Devices?.filter(d => d.is_connected).length || 0,
      total_units: irrigationUnits?.length || 0,
      connected_units: irrigationUnits?.filter(u => u.is_connected).length || 0,
    };

    const { data: relayStates } = await supabaseAdmin
      .from('relay_states')
      .select('device_id, relay_id, label, mode, state, last_changed_at');

    if (relayStates) {
      data.relays = relayStates.map(r => ({
        device_id: r.device_id,
        relay_id: r.relay_id,
        name: r.label || r.relay_id,
        mode: r.mode,
        is_on: r.state,
        last_changed: r.last_changed_at,
      }));
    }

    const { data: alerts } = await supabaseAdmin
      .from('active_alerts')
      .select('*')
      .eq('status', 'active')
      .order('triggered_at', { ascending: false });

    if (alerts) {
      data.alerts = {
        count: alerts.length,
        critical: alerts.filter(a => a.severity === 'critical').length,
        warnings: alerts.filter(a => a.severity === 'warning').length,
        list: alerts.map(a => ({
          type: a.alert_type,
          severity: a.severity,
          title: a.title,
          message: a.message,
          current_value: a.current_value,
          threshold_value: a.threshold_value,
          triggered_at: a.triggered_at,
        })),
      };
    }

    const { data: thresholds } = await supabaseAdmin
      .from('automation_thresholds')
      .select('*')
      .eq('is_active', true);

    if (thresholds) {
      data.thresholds = thresholds.map(t => ({
        device_id: t.device_id,
        relay_id: t.relay_id,
        type: t.threshold_type,
        comparison: t.comparison,
        on_value: t.on_value,
        off_value: t.off_value,
        unit: t.unit,
      }));
    }

    const { data: beds } = await supabaseAdmin
      .from('greenhouse_beds')
      .select(`
        id, bed_number, name, status, location,
        bed_plants (
          id, plant_name, quantity, status, planting_date
        )
      `);

    if (beds) {
      data.beds = beds.map(b => ({
        number: b.bed_number,
        name: b.name,
        status: b.status,
        location: b.location,
        plants: b.bed_plants || [],
      }));
    }

    const { data: irrigationSettings } = await supabaseAdmin
      .from('irrigation_settings')
      .select('*');

    if (irrigationSettings) {
      data.irrigation_settings = irrigationSettings.map(s => ({
        unit_id: s.unit_id,
        mode: s.irrigation_mode,
        moisture_threshold: s.moisture_threshold,
      }));
    }

    const { data: recentSessions } = await supabaseAdmin
      .from('irrigation_sessions')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(5);

    if (recentSessions) {
      data.recent_sessions = recentSessions.map(s => ({
        unit_id: s.unit_id,
        mode: s.irrigation_mode,
        water_consumed: s.water_consumed,
        status: s.status,
        started_at: s.started_at,
        ended_at: s.ended_at,
        moisture_before: s.moisture_before,
        moisture_after: s.moisture_after,
      }));
    }

  } catch (error) {
    console.error('[AI] Error fetching greenhouse data:', error);
  }

  return data;
}

let aiInstance = null;

function getAIInstance() {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY environment variable is not set');
    }
    aiInstance = new GoogleGenAI({ apiKey });
  }
  return aiInstance;
}

async function streamChat(messages, chatId, fileId) {
  const ai = getAIInstance();
  const greenhouseData = await getGreenhouseData();

  const contents = [];

  for (const msg of messages) {
    let parts = [];

    try {
      const parsed = JSON.parse(msg.content);
      if (parsed?.type === 'image' && parsed.fileId) {
        if (msg.role === 'user' && parsed.fileId === fileId) {
          const { data: fileData, error: downloadError } = await supabaseAdmin.storage
            .from(STORAGE_BUCKET)
            .download(parsed.fileId);

          if (downloadError || !fileData) {
            parts.push({ text: parsed.text || 'الرجاء تحليل هذه الصورة.' });
          } else {
            const arrayBuffer = await fileData.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');
            parts.push({ text: parsed.text || 'الرجاء تحليل هذه الصورة.' });
            parts.push({
              inlineData: {
                mimeType: fileData.type || 'image/jpeg',
                data: base64,
              },
            });
          }
        } else {
          parts.push({ text: parsed.text || 'المستخدم شارك صورة.' });
        }
      } else {
        parts.push({ text: msg.content });
      }
    } catch {
      parts.push({ text: msg.content });
    }

    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts,
    });
  }

  if (contents.length > 0) {
    const lastContent = contents[contents.length - 1];
    if (lastContent.role === 'user' && lastContent.parts.length > 0) {
      const greenhouseContext = `

📊 بيانات الدفيئة الحالية:
${JSON.stringify(greenhouseData, null, 2)}

استخدم هذه البيانات للإجابة على السؤال.`;

      if (lastContent.parts[0].text) {
        lastContent.parts[0].text += greenhouseContext;
      }
    }
  }

  const config = {
    thinkingConfig: {
      thinkingBudget: -1,
    },
    tools: [{ googleSearch: {} }],
    systemInstruction: [{ text: SYSTEM_INSTRUCTION }],
  };

  const response = await ai.models.generateContentStream({
    model: 'gemini-flash-latest',
    config,
    contents,
  });

  let fullText = '';
  for await (const chunk of response) {
    const text = chunk.text || '';
    fullText += text;
  }

  return { fullText, chatId };
}

async function createChat() {
  const { data, error } = await supabaseAdmin
    .from('chats')
    .insert({ created_at: new Date().toISOString() })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getChat(chatId) {
  const { data, error } = await supabaseAdmin
    .from('chats')
    .select('*')
    .eq('id', chatId)
    .single();

  if (error || !data) return null;
  return data;
}

async function getChatMessages(chatId) {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

async function saveMessage(chatId, role, content) {
  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({
      chat_id: chatId,
      role,
      content,
      created_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function getAllChats() {
  const { data, error } = await supabaseAdmin
    .from('chats')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data || [];
}

async function uploadImage(file, fileName) {
  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, file, { cacheControl: '3600', upsert: false });

  if (error) throw error;
  return data;
}

function getImagePublicUrl(fileId) {
  const { data } = supabaseAdmin.storage.from(STORAGE_BUCKET).getPublicUrl(fileId);
  return data.publicUrl;
}

module.exports = {
  streamChat,
  createChat,
  getChat,
  getChatMessages,
  saveMessage,
  getAllChats,
  uploadImage,
  getImagePublicUrl,
  getGreenhouseData,
  STORAGE_BUCKET,
};