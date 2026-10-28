import groq, { GROQ_MODEL, GROQ_REASONING_OPTIONS } from '../groq';

export interface ExtractedQuestion {
  question: string;
  context: string;
  confidence: number;
}

export async function extractQuestionFromTranscript(transcript: string): Promise<ExtractedQuestion | null> {
  try {
    
    const prompt = `
Analyze the following interview transcript and extract the most recent or important question that needs to be answered.

Rules:
1. Focus on questions from the interviewer that require a response
2. Ignore casual conversation or confirmations
3. If multiple questions exist, prioritize the most recent unanswered one
4. Return only ONE primary question
5. Provide confidence score (0-1) based on clarity

Transcript:
"""
${transcript}
"""

Return a JSON response with:
{
  "question": "The extracted question",
  "context": "Brief context around the question",
  "confidence": 0.95
}

If no clear question is found, return:
{
  "question": "",
  "context": "",
  "confidence": 0
}
`;

    const result = await groq.chat.completions.create({
      ...GROQ_REASONING_OPTIONS,
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_completion_tokens: 2048,
    });
    const response = result.choices[0]?.message?.content || '{}';
    
    // Parse JSON response
    const cleanResponse = response.replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
    const extracted = JSON.parse(cleanResponse);
    
    if (typeof extracted.confidence === 'number' && extracted.confidence > 0.3 && typeof extracted.question === 'string' && extracted.question.trim()) {
      return {
        question: extracted.question,
        context: extracted.context,
        confidence: extracted.confidence
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting question:', error);
    return null;
  }
}
