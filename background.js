// 김대필 (ContextWrite) Background Service Worker

// 1. 민감 정보 및 금융 도메인 블랙리스트
const BLACKLIST_DOMAINS = [
  'shinhan.com', 'kbstar.com', 'wooribank.com', 'hanafn.com', 
  'ibk.co.kr', 'kakaobank.com', 'toss.im', 'pay.naver.com', 'pay.kakao.com'
];

const BLACKLIST_KEYWORDS = ['password', 'card', 'cvv', 'pin', 'ssn', '주민등록번호', '비밀번호', '결제'];

// 2. 맥락 분석용 모드 정의 및 매칭 키워드
const MODES = {
  resume: {
    name: '이력서/자소서 모드',
    urls: [
      'wanted.co.kr', 'saramin.co.kr', 'jobkorea.co.kr', 'programmers.co.kr', 
      'linkareer.com', 'jumpit.co.kr', 'remember.co.kr', 'incruit.com', 
      'careerly.co.kr', 'superookie.com', 'blindhire.co.kr', 'jobis.co', 
      'rallit.com', 'surfit.io', 'resume', 'recruit', 'apply', 'portfolio', 'career', 'job'
    ],
    keywords: ['이력서', '자소서', '자기소개서', '지원서', '채용', 'recruit', 'job', 'resume', 'career', 'apply', '포트폴리오'],
    coreKeywords: ['자기소개서', '자소서', '이력서', '지원서', 'resume', 'cover letter']
  },
  email: {
    name: '비즈니스 이메일 모드',
    urls: [
      'mail.naver.com', 'mail.google.com', 'outlook.office.com', 'gmail.com',
      'mail', 'outlook', 'gmail', 'messenger'
    ],
    keywords: ['이메일', '메일', '답장', '업무', 'mail', 'outlook', 'gmail', 'send', '수신', '발신', '참조'],
    coreKeywords: ['이메일', '메일', 'email', 'gmail', 'outlook', '받는사람', '보낸사람']
  },
  sns: {
    name: '블로그/SNS 모드',
    urls: [
      'blog.naver.com', 'velog.io', 'tistory.com', 'instagram.com', 'facebook.com', 'threads.net',
      'blog', 'instagram', 'facebook', 'velog', 'tistory', 'sns', 'post'
    ],
    keywords: ['블로그', '피드', '글쓰기', '포스팅', 'blog', 'instagram', 'facebook', 'velog', 'tistory', '댓글', 'sns'],
    coreKeywords: ['블로그', '포스팅', '댓글', 'blog', 'instagram', '인스타', 'tistory', 'velog', '피드']
  }
};

// 3. 브라우저 액션 아이콘 클릭 시 사이드바 토글 메시지 전송
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'toggle-sidebar' })
      .catch((err) => {
        console.log('김대필 (ContextWrite): 이 페이지에서는 사이드바를 실행할 수 없거나 페이지 새로고침이 필요합니다.');
      });
  }
});

// 4. 메시지 리스너 연동
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  try {
    if (message.action === 'analyze-context') {
      handleAnalyzeContext(message.data || {}, sendResponse);
      return true; // 비동기 응답 처리
    } else if (message.action === 'humanize') {
      handleHumanize(message.data || {}, sendResponse);
      return true; // 비동기 응답 처리
    } else if (message.action === 'request-sidebar-sync') {
      // iframe에서 발생한 클릭 텍스트를 동일한 탭의 탑 프레임으로 릴레이 전달
      if (sender.tab && sender.tab.id) {
        chrome.tabs.sendMessage(sender.tab.id, {
          action: 'sync-sidebar-from-iframe',
          text: message.text
        });
      }
      sendResponse({ success: true });
      return false;
    } else if (message.action === 'open-options') {
      chrome.runtime.openOptionsPage();
      sendResponse({ success: true });
      return false;
    } else if (message.action === 'open-popup-window') {
      chrome.windows.create({
        url: chrome.runtime.getURL('popup.html'),
        type: 'popup',
        width: 400,
        height: 750
      }, (win) => {
        sendResponse({ success: true, windowId: win.id });
      });
      return true;
    }
  } catch (err) {
    console.error('background.js 메시지 처리 중 예외 발생:', err);
    sendResponse({ success: false, error: err.message });
  }
  return false;
});

/**
 * 맥락 분석 처리 함수
 */
function handleAnalyzeContext(data, sendResponse) {
  const { url, title, placeholder, label } = data;

  // 4.1 블랙리스트 검사
  const hostname = getHostname(url);
  const isBlacklistedDomain = BLACKLIST_DOMAINS.some(domain => hostname.includes(domain));
  const isBlacklistedKeyword = BLACKLIST_KEYWORDS.some(kw => 
    (placeholder && placeholder.toLowerCase().includes(kw)) || 
    (label && label.toLowerCase().includes(kw))
  );

  if (isBlacklistedDomain || isBlacklistedKeyword) {
    sendResponse({ isBlacklisted: true });
    return;
  }

  // 4.2 모드 매칭 및 신뢰도(Confidence Score) 계산
  let bestMode = 'resume'; // 기본 모드
  let maxConfidence = 0;
  const confidences = {};

  for (const [key, config] of Object.entries(MODES)) {
    let score = 0;
    
    // 1. URL 매칭 검사 (+60점)
    const lowerUrl = (url || '').toLowerCase();
    if (config.urls.some(u => lowerUrl.includes(u))) {
      score += 60;
    }

    // 2. 핵심 키워드(Core Keyword) 감지 시 보너스 부여 (+40점)
    const checkTarget = `${title || ''} ${placeholder || ''} ${label || ''}`.toLowerCase();
    if (config.coreKeywords.some(core => checkTarget.includes(core))) {
      score += 40;
    }

    // 3. 일반 키워드 매칭 개수 반영 (+15점씩 최대 30점)
    let keywordHits = 0;
    config.keywords.forEach(kw => {
      if (title && title.toLowerCase().includes(kw)) keywordHits++;
      if (placeholder && placeholder.toLowerCase().includes(kw)) keywordHits++;
      if (label && label.toLowerCase().includes(kw)) keywordHits++;
    });

    score += Math.min(keywordHits * 15, 30);
    
    // 총점 100점 제한
    score = Math.min(score, 100);
    confidences[key] = score;

    if (score > maxConfidence) {
      maxConfidence = score;
      bestMode = key;
    }
  }

  sendResponse({
    isBlacklisted: false,
    mode: bestMode,
    modeName: MODES[bestMode].name,
    confidence: maxConfidence,
    confidences: confidences
  });
}

/**
 * Humanize 자연화 처리 함수
 */
async function handleHumanize(data, sendResponse) {
  const { text, level, mode, profile, charLimit, customInstruction } = data;

  if (!text || text.trim() === '') {
    sendResponse({ success: false, error: '텍스트가 비어 있습니다.' });
    return;
  }

  // 5.2 크롬 스토리지에서 AI 연동 키 및 모델 로드
  let provider = 'simulation';
  let apiModel = '';
  let apiKey = '';
  let customPolicy = '';

  try {
    const settings = await new Promise((resolve) => {
      chrome.storage.local.get(['aiProvider', 'aiModel', 'apiKey', 'factProtectionPolicy'], resolve);
    });
    provider = settings.aiProvider || 'simulation';
    apiModel = settings.aiModel || '';
    apiKey = settings.apiKey || '';
    customPolicy = settings.factProtectionPolicy || '';
  } catch (err) {
    console.error('스토리지 연동 정보 로드 실패:', err);
  }

  // 5.1 사실 관계 보호 가드레일 선언 (AI가 인식했다고 가정하는 프롬프트 규격 예시)
  const defaultPolicy = `
  [사실 관계 보호 가드레일 활성화 ({{Fact_Protection_Lock}})]
  - 입력 텍스트 내의 날짜, 연도, 회사명, 프로젝트명, 구체적인 수치(%, 점수, 금액 등)는 절대로 왜곡하거나 생략하지 않고 원본 그대로 보존해야 합니다.
  `;

  const Fact_Protection_Lock = customPolicy || defaultPolicy;

  const tone = profile?.tone || '부드럽고 설득력 있는 말투';
  const experience = profile?.experience || '없음';
  const episode = profile?.episode || '';

  let resultText = '';
  let apiCallSuccess = false;

  // 실제 외부 API 호출 시도
  if (provider !== 'simulation' && apiKey) {
    try {
      const promptLevelStr = level === 'light' ? '가벼운 맞춤법 및 띄어쓰기 교정' : level === 'medium' ? '자연스러운 문장 구조 변경 및 자소서/이메일 스타일 변환' : '완벽한 재작성 및 개인의 톤앤매너 융합';
      
      let customInstructionRule = '';
      if (customInstruction && customInstruction.trim() !== '') {
        customInstructionRule = `\n8. 특별 추가 요청사항: 이 문장을 다듬을 때는 반드시 다음의 구체적 지시사항을 최우선으로 반영하여 문맥을 다듬어주세요: "${customInstruction}"`;
      }

      // 페르소나 설명 정의
      let personaDesc = `당신은 명망 높은 국어국문학과 교수이자 대한민국 최고의 작문 교정 전문가입니다. 한글 맞춤법, 띄어쓰기, 표준어 규정 등 국립국어원의 표준 언어 규범과 문법을 철저히 준수하면서, 격조 높은 어휘와 완벽하게 정확한 표현으로 사용자의 본문 텍스트를 자연화(Humanize) 및 교정해 주십시오.`;
      
      const selectedPersona = data.persona || 'professor';
      if (selectedPersona === 'recruiter') {
        personaDesc = `당신은 글로벌 IT 대기업의 시니어 테크 리크루터(인사담당자)이자 자소서 교정 전문가입니다. 이력서와 자소서 문맥에 최적화하여, 수치적 성과와 직무적 전문성이 한눈에 부각되도록 객관적이며 설득력 있는 비즈니스 문체로 사용자의 본문 텍스트를 자연화(Humanize) 및 교정해 주십시오.`;
      } else if (selectedPersona === 'copywriter') {
        personaDesc = `당신은 소비자의 시선을 끌고 행동을 유도하는 15년 차 베테랑 카피라이터이자 비즈니스 이메일 작문 전문가입니다. 이메일 및 광고 문맥에 맞추어, 읽는 사람이 몰입하게 하고 정중함과 세련미가 동시에 드러나는 뛰어난 설득력의 비즈니스 카피 톤으로 사용자의 본문 텍스트를 자연화(Humanize) 및 교정해 주십시오.`;
      } else if (selectedPersona === 'influencer') {
        personaDesc = `당신은 친근하고 세련된 언어를 사용하는 파워 블로거이자 SNS 인플루언서입니다. 블로그 포스팅과 SNS 피드 문맥에 걸맞게 가독성이 뛰어나며 이웃의 편안한 소통을 이끌어내는 친근하고 부드러운 말투로 사용자의 본문 텍스트를 자연화(Humanize) 및 교정해 주십시오. 상황에 맞춰 적절하고 귀여운 유니코드 이모지(Emoji)도 문장 중간중간에 자연스럽게 삽입해 주십시오.`;
      }

      const systemMsg = `${personaDesc} 결과물은 부연 설명 없이 최종 완성형 한국어 본문으로만 출력해야 합니다.
${Fact_Protection_Lock}
[요청 규칙]
1. 출력 언어: 반드시 100% 한글(한국어)로만 답변을 작성하십시오. 영어로 응답해서는 절대로 안 됩니다.
2. 작성 모드: ${mode === 'resume' ? '자기소개서/이력서' : mode === 'email' ? '비즈니스 이메일' : '블로그/SNS'}에 최적화하여 어색한 외래어 번역투나 결함이 있는 비문을 철저히 배제하고 명료하며 정확한 문체로 정돈해 주세요.
3. 자연화 강도: ${promptLevelStr} 수준으로 반영하되, 문법적 결함이나 맞춤법 오류는 강도와 무관하게 항상 완벽히 교정해야 합니다.
4. 말투/톤: 지정된 규범과 톤에 어울리는 올바르고 품위 있는 ${tone} 분위기를 명확히 투영하십시오.
5. 사용자 백그라운드 경험: ${experience}
6. 반영하고 싶은 에피소드: ${episode}
7. 어떠한 사족이나 설명 없이, 지정된 페르소나 지침에 완벽히 교정된 최종 완성형 한국어 텍스트만 답변해주세요.${customInstructionRule}`;

      let responseText = '';

      if (provider === 'openai') {
        const modelName = apiModel || 'gpt-4o-mini';
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: text }
            ],
            temperature: 0.7
          })
        });
        const json = await response.json();
        if (json.choices && json.choices[0]) {
          responseText = json.choices[0].message.content.trim();
          apiCallSuccess = true;
        } else {
          throw new Error(json.error?.message || 'OpenAI API 응답 실패');
        }
      } else if (provider === 'gemini') {
        const modelName = apiModel || 'gemini-2.0-flash';
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `${systemMsg}\n\n사용자 본문:\n${text}`
              }]
            }]
          })
        });
        const json = await response.json();
        if (json.candidates && json.candidates[0].content.parts[0]) {
          responseText = json.candidates[0].content.parts[0].text.trim();
          apiCallSuccess = true;
        } else {
          throw new Error(json.error?.message || 'Gemini API 응답 실패');
        }
      } else if (provider === 'nvidia') {
        const modelName = apiModel || 'meta/llama-3.3-70b-instruct';
        const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: modelName,
            messages: [
              { role: 'system', content: systemMsg },
              { role: 'user', content: text }
            ],
            temperature: 0.7,
            max_tokens: 1024
          })
        });
        const json = await response.json();
        if (json.choices && json.choices[0]) {
          responseText = json.choices[0].message.content.trim();
          apiCallSuccess = true;
        } else {
          throw new Error(json.error?.message || 'NVIDIA API 응답 실패');
        }
      }

      if (apiCallSuccess && responseText) {
        resultText = responseText;
      }
    } catch (apiErr) {
      console.error(`[AI API 호출 에러 - 폴백 시뮬레이터 가동]:`, apiErr);
    }
  }

  // API 호출 실패 시 또는 시뮬레이션 모드일 때 폴백 교정 실행
  if (!apiCallSuccess) {
    if (level === 'light') {
      // Light (가벼운 교정: 맞춤법, 띄어쓰기 및 종결어미 가볍게 정돈)
      resultText = text
        .replace(/\s+/g, ' ') // 다중 공백 제거
        .replace(/([^.\s])\s*\.\s*/g, '$1. ') // 마침표 뒤 띄어쓰기 교정
        .replace(/였습니다/g, '였습니다.')
        .replace(/하였으며/g, '했고,')
        .replace(/하였습니다\./g, '했습니다.')
        .replace(/되겠으며,/g, '되고,')
        .replace(/을\/를 진행하였습니다\./g, '을 진행했습니다.')
        .replace(/\s+([.,])/g, '$1') // 문장부호 앞 공백 제거
        .trim();
    } else if (level === 'medium') {
      // Medium (자연스러운 문장: 흐름을 매끄럽게 다듬고 자소서 문체화)
      let processedText = text
        .replace(/\s+/g, ' ')
        .replace(/([^.\s])\s*\.\s*/g, '$1. ')
        .replace(/했다\./g, '했습니다.')
        .replace(/있다\./g, '있습니다.')
        .replace(/습관화 할 수 있었습니다/g, '자연스럽게 몸에 익힐 수 있었습니다.');

      // 불필요하게 긴 문장이나 문장 연결 개선
      processedText = processedText.replace(/성장하다 보니 제 자신도 자연스럽게/g, '성장하며 자연스럽게');

      if (mode === 'resume') {
        resultText = `저는 ${processedText.replace(/제가\s|저는\s/g, '')}`;
      } else if (mode === 'email') {
        resultText = `안녕하세요.\n\n전달해주신 내용을 바탕으로 검토해 본 결과, ${processedText.replace(/제가\s|저는\s/g, '')}\n\n추가적인 요청이나 피드백이 있으시다면 편하게 말씀해 주시기 바랍니다.`;
      } else {
        resultText = processedText;
      }
    } else if (level === 'strong') {
      // Strong (완벽한 재작성 및 개인 에피소드 유기적 결합)
      let decoratedText = text
        .replace(/\s+/g, ' ')
        .replace(/([^.\s])\s*\.\s*/g, '$1. ')
        .replace(/습관화 할 수 있었습니다/g, '자연스럽게 저의 강력한 장점으로 자리 잡았습니다.');

      // 팩트 보존 및 흐름 변환
      let customNarrative = '';
      if (episode && episode.trim() !== '') {
        customNarrative = `특히 저의 구체적인 에피소드인 "${episode}" 과정에서도 이러한 역량이 잘 드러납니다. `;
      }

      let backgroundContext = '';
      if (experience && experience.trim() !== '' && experience !== '없음') {
        backgroundContext = `또한, ${experience}로서 쌓아온 저의 경험과 전문성은 이러한 태도를 더욱 탄탄하게 뒷받침해 줍니다. `;
      }

      resultText = `저는 화목하고 대화가 끊이지 않는 따뜻한 가정 환경 속에서 조부모님 및 부모님과 함께 성장하며, 매사에 밝고 긍정적인 성격을 형성할 수 있었습니다.\n\n${decoratedText.replace(/저는\s|제가\s/g, '')}\n\n${customNarrative}${backgroundContext}이러한 성향을 바탕으로 향후 조직 내에서도 긍정적인 시너지와 원활한 협업을 이끌어내도록 노력하겠습니다.`;
    }
  }

  // 글자수 제한(charLimit)에 따른 자르기 처리
  if (charLimit && charLimit > 0 && resultText.length > charLimit) {
    let tempText = resultText.substring(0, charLimit);
    const lastPeriodIndex = tempText.lastIndexOf('.');
    if (lastPeriodIndex > 0) {
      resultText = tempText.substring(0, lastPeriodIndex + 1);
    } else {
      resultText = tempText;
    }
  }

  // 5.3 AI 탐지 예측 점수 및 ATS 매칭 점수 시뮬레이션
  // Level이 높을수록 AI 탐지 확률(AI Detection Score)이 낮아집니다.
  let aiDetectionScore = 95; // 기본값
  if (level === 'light') aiDetectionScore = 75;
  if (level === 'medium') aiDetectionScore = 40;
  if (level === 'strong') aiDetectionScore = 15;

  // 매칭 점수는 임의 계산 (맥락 분석 신뢰도 및 프로필 정보 충실도 반영)
  let atsScore = 50;
  if (profile?.experience && profile?.experience !== '없음') atsScore += 20;
  if (profile?.episode) atsScore += 20;
  atsScore = Math.min(atsScore + Math.floor(Math.random() * 10), 100);

  // 최종 응답 반환
  sendResponse({
    success: true,
    originalText: text,
    humanizedText: resultText,
    aiDetectionScore: aiDetectionScore,
    atsScore: atsScore
  });
}

/**
 * URL에서 호스트네임을 추출하는 보조 함수
 */
function getHostname(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch (e) {
    return url.toLowerCase();
  }
}
