export function isSelfIntroduction(text: string): boolean {
  return /自我介绍|介绍(?:一下)?(?:你自己|自己)|自己紹介|self[ -]?introduc|introduc\w*\s+(?:yourself|myself)|briefly\s+introduc|tell\s+me\s+about\s+yourself/i.test(text);
}

export function pdfSearchQuery(question: string): string {
  return isSelfIntroduction(question)
    ? 'Self introduction 自我介绍 自己紹介. Introduce yourself: my name, education, background, research and work experience.'
    : question;
}

export function introductionRelevance(content: string): number {
  return /自我介绍|自己紹介|self[ -]?introduction|introduce\s+(?:yourself|myself)/i.test(content) ? 0.25 : 0;
}
