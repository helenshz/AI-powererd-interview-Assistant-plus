type Language = 'en' | 'ja' | 'zh-CN' | 'de';

function headingLanguage(line: string): Language | undefined {
  const heading = line.trim().replace(/^[#*\s\d.()、-]+|[\s:*#：]+$/g, '').toLowerCase();
  if (['english', '英文', '英语', '英語'].includes(heading)) return 'en';
  if (['日本語', '日语', '日文', 'japanese'].includes(heading)) return 'ja';
  if (['中文', '中国語', 'chinese'].includes(heading)) return 'zh-CN';
  if (['deutsch', 'german', '德语'].includes(heading)) return 'de';
}

function scriptLanguage(text: string): Language | undefined {
  const latin = (text.match(/[A-Za-zÀ-ž]/g) || []).length;
  const kana = (text.match(/[\u3040-\u30ff]/g) || []).length;
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  if (kana > 0 && kana + han > latin) return 'ja';
  if (han > latin && kana === 0) return 'zh-CN';
  if (latin > 0 && latin / (latin + kana + han) >= 0.75) {
    const german = (text.match(/\b(?:ich|meine|mein|und|der|die|das|für|mit|bei|habe|möchte|weil)\b/gi) || []).length;
    const english = (text.match(/\b(?:i|my|and|the|for|with|have|want|because|this|is)\b/gi) || []).length;
    return german > english ? 'de' : 'en';
  }
}

// Read-time selection works with existing multilingual chunks; no re-upload is required.
export function preferOriginalPassage(content: string, language?: string): { content: string; matched: boolean } {
  if (!['en', 'ja', 'zh-CN', 'de'].includes(language || '')) return { content, matched: false };
  const sections: { language?: Language; text: string }[] = [];
  let explicit: Language | undefined;
  for (const line of content.split(/\r?\n/)) {
    const heading = headingLanguage(line);
    if (heading) { explicit = heading; continue; }
    if (!line.trim()) continue;
    const inferred = scriptLanguage(line);
    // A chunk may start or end halfway through a labelled section.
    const selected = inferred && explicit && inferred !== explicit ? inferred : explicit || inferred;
    const previous = sections[sections.length - 1];
    if (previous && previous.language === selected) previous.text += `\n${line}`;
    else sections.push({ language: selected, text: line });
  }
  const minimumLength = language === 'ja' || language === 'zh-CN' ? 10 : 30;
  const matching = sections.filter(section => section.language === language && section.text.trim().length >= minimumLength);
  return matching.length
    ? { content: matching.map(section => section.text).join('\n\n'), matched: true }
    : { content, matched: false };
}
