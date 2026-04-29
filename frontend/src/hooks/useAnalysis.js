import { useCallback, useState } from 'react';

const PROMPT = [
  "أنت مساعد طبيب أسنان. حلّل هذه الصورة السنية بإيجاز:",
  "",
  "**الملاحظات:** (نخر، التهاب لثة، جير، تآكل، تلوّن — مع الموقع)",
  "**التوصية:** (إجراء مقترح لكل مشكلة)",
  "**الأولوية:** طبيعي / يحتاج متابعة / يحتاج علاج / يحتاج تدخل عاجل",
  "",
  "كن موجزاً. هذا تحليل مساعد وليس تشخيصاً نهائياً.",
].join("\n");

export function useAnalysis(settings) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const analyze = useCallback(async (imageDataUrl) => {
    if (!imageDataUrl) {
      setError('لا توجد صورة للتحليل');
      return;
    }

    const { mode, serverUrl, openaiApiKey } = settings;

    if (mode === 'local' && !openaiApiKey) {
      setError('لم يتم ضبط مفتاح OpenAI في الإعدادات');
      return;
    }

    setLoading(true);
    setError(null);
    setReport(null);

    const body = JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 600,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: imageDataUrl, detail: 'low' } },
          ],
        },
      ],
    });

    try {
      let url, headers;

      if (mode === 'cloud') {
        url = `${serverUrl}/api/analyze`;
        headers = { 'Content-Type': 'application/json' };
      } else {
        url = 'https://api.openai.com/v1/chat/completions';
        headers = {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`,
        };
      }

      const res = await fetch(url, { method: 'POST', headers, body });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        const msg = errJson.error?.message || `HTTP ${res.status}`;
        if (res.status === 401) {
          throw new Error('مفتاح OpenAI غير صالح — تحقق من الإعدادات أو استخدم الوضع السحابي');
        }
        if (res.status === 429) {
          throw new Error('تجاوزت الحد المسموح أو لا يوجد رصيد في OpenAI');
        }
        if (res.status === 400 && msg.includes('image')) {
          throw new Error('الصورة غير صالحة — التقط صورة أخرى');
        }
        if (mode === 'cloud' && res.status === 500) {
          throw new Error(errJson.error?.message || 'خطأ في السيرفر — تحقق من إعدادات OpenAI');
        }
        throw new Error(msg);
      }

      const data = await res.json();
      const analysis = data.choices?.[0]?.message?.content || '';
      setReport({
        analysis,
        timestamp: new Date().toISOString(),
        model: data.model || 'gpt-4o-mini',
      });
    } catch (err) {
      if (err.message === 'Failed to fetch') {
        setError(mode === 'cloud'
          ? 'تعذر الاتصال بالسيرفر — تحقق من عنوان السيرفر'
          : 'تعذر الاتصال بـ OpenAI — تأكد من اتصال الإنترنت');
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, [settings]);

  const clear = useCallback(() => {
    setReport(null);
    setError(null);
  }, []);

  return { report, loading, error, analyze, clear };
}