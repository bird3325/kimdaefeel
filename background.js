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
  const target = profile?.target || '';
  const job = profile?.job || '';
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
6. ${mode === 'resume' ? '지원회사' : mode === 'email' ? '수신자 정보' : '채널 주제'}: ${target}
7. ${mode === 'resume' ? '업직종' : mode === 'email' ? '관계/직급' : '타깃 독자층 및 관심사'}: ${job}
8. 반영하고 싶은 에피소드: ${episode}
9. 어떠한 사족이나 설명 없이, 지정된 페르소나 지침에 완벽히 교정된 최종 완성형 한국어 텍스트만 답변해주세요.${customInstructionRule}`;

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
    const tone = profile?.tone || '';
    const experience = profile?.experience || '';
    const target = profile?.target || '';
    const job = profile?.job || '';
    const episode = profile?.episode || '';
    
    // 기계적 번역투 및 어색한 종결어미 교정
    let polished = text
      .replace(/~에 있어서/g, '~에서')
      .replace(/~로 인하여/g, '~ 때문에')
      .replace(/~에 대한 조사/g, '~를 조사')
      .replace(/을\/를 진행하였습니다/g, '을 진행했습니다')
      .replace(/을 수행하였습니다/g, '을 수행했습니다')
      .replace(/습관화 할 수 있었습니다/g, '자연스럽게 저의 습관으로 정착시켰습니다')
      .replace(/다름이 아니라/g, '')
      .trim();

    // 문장의 끝을 부드럽게 윤문 (말투/톤 설정 반영)
    if (tone.includes('존댓말') || tone.includes('정중') || tone.includes('격식') || tone.includes('존칭')) {
      polished = polished
        .replace(/했다\./g, '했습니다.')
        .replace(/있다\./g, '있습니다.')
        .replace(/한다\./g, '합니다.')
        .replace(/된다\./g, '됩니다.');
    }

    if (level === 'light') {
      // Light: 맞춤법, 띄어쓰기 및 종결어미 위주의 가벼운 보정
      resultText = polished;
    } else if (level === 'medium') {
      // Medium: 문장 흐름을 매끄럽게 가독성 위주로 다듬음
      if (mode === 'resume') {
        let intro = '';
        if (target || job) {
          intro = `${target ? target + ' ' : ''}${job ? job + ' 직무 ' : '분야 '}합류를 위해 `;
        }
        if (experience && experience !== '없음') {
          intro += `${experience}로서 노력해 왔습니다. `;
        }
        resultText = `${intro}${polished}`;
      } else if (mode === 'email') {
        let emailIntro = `안녕하세요, ${target ? target + ' ' : ''}${job ? job + ' 님' : '담당자님'}.\n\n`;
        resultText = `${emailIntro}${polished}\n\n추가 검토 사항이 있으시면 회신 바랍니다.`;
      } else {
        resultText = polished;
      }
    } else if (level === 'strong') {
      // Strong: 완벽한 재작성 및 프로필, 에피소드, 요청사항의 유기적 결합
      if (mode === 'resume') {
        let intro = `그동안 `;
        if (experience && experience !== '없음') {
          intro += `${experience}로서 실무 전문성을 차분히 다져왔습니다. `;
        }
        if (target || job) {
          intro += `특히 이번에 ${target ? target + '의 ' : ''}${job ? job + ' 업직종에 ' : '해당 분야에 '}지원하며 저만의 역량을 새롭게 발휘하고자 합니다. `;
        }

        let body = `작성된 내용처럼, "${polished.replace(/\.$/, '')}"이라는 핵심 지향점은 실제 저의 업무 철학이기도 합니다.`;
        if (episode) {
          body += ` 실례로, ${episode}를 완수하는 과정에서도 이러한 가치와 주도적 실행력이 성공 요인으로 크게 기여했습니다.`;
        }

        let conclusion = `앞으로도 축적된 역량을 바탕으로 원활한 협업을 이끌어내겠습니다.`;
        if (customInstruction) {
          conclusion += ` 특히 "${customInstruction}" 지시사항을 마음에 새기고 성과를 만들어 가겠습니다.`;
        }

        resultText = `${intro}\n\n${body}\n\n${conclusion}`;
      } else if (mode === 'email') {
        let greeting = `안녕하세요, ${target ? target + ' ' : ''}${job ? job + ' 님' : '담당자님'}.\n`;
        if (experience && experience !== '없음') {
          greeting += `${experience} 담당자입니다.\n\n`;
        } else {
          greeting += '보내주신 내용 잘 검토하였습니다.\n\n';
        }

        let body = `기재해주신 사안과 관련하여, "${polished.replace(/\.$/, '')}"라는 방향성을 기본으로 삼고자 합니다.`;
        if (episode) {
          body += ` 요청 주신 '${episode}' 세부 계획에 맞추어 업무 일정을 긴밀하게 조율 중에 있습니다.`;
        }

        let footer = `\n\n추가로 의견 주신 "${customInstruction || '내용'}"에 대해서도 면밀히 반영하여 차질 없이 진행하겠습니다.\n감사합니다.`;

        resultText = `${greeting}${body}${footer}`;
      } else if (mode === 'sns') {
        let intro = `✨ [${target || '알림'}] ${job ? '#' + job.replace(/\s+/g, '') : ''} 소식을 나눕니다!\n\n`;
        let body = `📝 ${polished}\n\n`;
        if (episode) {
          body += `개인적으로 '${episode}' 때의 특별한 순간이 다시금 기억에 남는 대목이네요. `;
        }
        if (experience) {
          body += `아무래도 제가 ${experience}로서 느꼈던 보람이 잘 녹아있는 글입니다. `;
        }
        
        let hashtags = `\n\n#김대필 #자연화변환 #${mode}`;
        if (customInstruction) {
          hashtags += ` #${customInstruction.replace(/\s+/g, '')}`;
        }
        
        resultText = `${intro}${body}${hashtags}`;
      }
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

  // 5.4 조합 정합성 검사 (Warnings 감지)
  const warnings = [];
  const lowerText = text.toLowerCase();
  
  if (mode === 'resume') {
    const emailKeywords = ['안녕하세요', '메일', '회신', '첨부파일', '배상', '드림', '실장', '대리', '과장', '부장', '차장', '과장님', '대리님', '주임님'];
    if (emailKeywords.some(kw => lowerText.includes(kw))) {
      warnings.push('이력서/자소서 모드이지만 메일 성격의 호칭이나 단어(안녕하세요, 메일, 회신, 드림 등)가 감지되었습니다. 작성 컨텍스트 모드를 "비즈니스 이메일 모드"로 전환하는 것을 권장합니다.');
    }
    if (!profile?.target || profile.target.trim() === '') {
      warnings.push('지원회사 정보가 비어 있습니다. 프로필에 지원회사를 추가하면 회사 맞춤형으로 자연스럽게 녹아듭니다.');
    }
    if (!profile?.job || profile.job.trim() === '') {
      warnings.push('업직종 정보가 비어 있습니다. 프로필에 업직종을 추가하면 직무 전문성에 부합하는 정밀 어휘를 사용합니다.');
    }
  } else if (mode === 'email') {
    const resumeKeywords = ['지원동기', '성장과정', '입사 후 포부', '성격의 장단점', '자기소개서', '자소서', '학창시절', '경력기술서'];
    if (resumeKeywords.some(kw => lowerText.includes(kw))) {
      warnings.push('이메일 모드이지만 자기소개서용 단어(지원동기, 성장과정, 자소서 등)가 감지되었습니다. 작성 컨텍스트 모드를 "이력서/자소서 모드"로 전환하는 것을 권장합니다.');
    }
    if (!profile?.target || profile.target.trim() === '') {
      warnings.push('이메일 수신자 정보가 비어 있습니다. 프로필에 수신자 정보를 기재하는 것을 추천합니다.');
    }
  }

  // 사실관계 모순 및 불정합 진단 추가 호출
  const contradictionWarnings = detectFactualContradictions(text, profile, mode);
  warnings.push(...contradictionWarnings);

  // 최종 응답 반환
  sendResponse({
    success: true,
    originalText: text,
    humanizedText: resultText,
    aiDetectionScore: aiDetectionScore,
    atsScore: atsScore,
    warnings: warnings,
    modelUsed: apiCallSuccess ? (apiModel || (provider === 'openai' ? 'gpt-4o-mini' : provider === 'gemini' ? 'gemini-2.0-flash' : 'meta/llama-3.3-70b-instruct')) : '로컬 시뮬레이터 (Local Simulator)'
  });
}

/**
 * 프로필 학습 데이터와 초안 본문 간의 구체적 사실관계 모순 탐지기
 */
function detectFactualContradictions(text, profile, mode) {
  const contradictions = [];
  const lowerText = text.toLowerCase();
  const experience = (profile?.experience || '').toLowerCase();
  const target = (profile?.target || '').toLowerCase();
  const job = (profile?.job || '').toLowerCase();
  const episode = (profile?.episode || '').toLowerCase();

  // 1. 고아 / 보육원 vs 부모님 / 화목한 가정 모순 검사
  const isOrphanProfile = experience.includes('고아') || experience.includes('보육원') || experience.includes('무연고') ||
                          episode.includes('고아') || episode.includes('보육원') || episode.includes('무연고');
  const hasParentText = lowerText.includes('부모') || lowerText.includes('아버지') || lowerText.includes('어머니') || 
                        lowerText.includes('엄마') || lowerText.includes('아빠') || lowerText.includes('가정 환경') || 
                        lowerText.includes('가정환경') || lowerText.includes('화목한 가정') || lowerText.includes('조부모') ||
                        lowerText.includes('부친') || lowerText.includes('모친');
                        
  if (isOrphanProfile && hasParentText) {
    contradictions.push('프로필(경력/에피소드)에는 "고아/보육원" 관련 정보가 기재되어 있으나, 초안 본문에는 "부모님/가정환경"에 대한 언급이 검출되어 문맥상 정합하지 않습니다.');
  }

  const isOrphanText = lowerText.includes('고아') || lowerText.includes('보육원') || lowerText.includes('무연고');
  const hasParentProfile = experience.includes('부모') || experience.includes('아버지') || experience.includes('어머니') || 
                           experience.includes('가족') || episode.includes('부모') || episode.includes('아버지') || 
                           episode.includes('어머니') || episode.includes('가족') || experience.includes('부친') ||
                           experience.includes('모친') || episode.includes('부친') || episode.includes('모친');
                           
  if (isOrphanText && hasParentProfile) {
    contradictions.push('초안 본문에는 "고아/보육원" 관련 내용이 명시되어 있으나, 프로필 학습에는 "부모님/가족" 관련 정보가 기재되어 있어 문맥상 정합하지 않습니다.');
  }

  // 2. 지원회사명 불일치 검사
  if (target && target.trim() !== '') {
    const targetKeywords = target.replace(/주식회사|corp|inc/gi, '').trim();
    if (targetKeywords.length >= 2) {
      const companies = ['naver', '네이버', 'kakao', '카카오', 'line', '라인', 'coupang', '쿠팡', 'toss', '토스', 'samsung', '삼성', 'hyundai', '현대', 'lg', '엘지', 'sk', '에스케이'];
      companies.forEach(com => {
        if (target.includes(com) && !lowerText.includes(com)) {
          companies.forEach(otherCom => {
            if (com !== otherCom && lowerText.includes(otherCom)) {
              contradictions.push(`프로필의 지원회사("${target}")와 초안 본문에 기재된 회사명("${otherCom}")이 다릅니다.`);
            }
          });
        }
      });
    }
  }

  // 3. 신입 vs 경력 직책 모순 검사
  const isFreshProfile = experience.includes('신입') || experience.includes('무경력') || experience.includes('대학생') || experience.includes('졸업예정');
  const hasSeniorText = lowerText.includes('과장으로서') || lowerText.includes('차장으로서') || lowerText.includes('부장으로서') || 
                        lowerText.includes('팀장으로서') || lowerText.includes('관리자로서') || lowerText.includes('pm으로서') || 
                        lowerText.includes('경력 5년') || lowerText.includes('경력 7년') || lowerText.includes('경력 10년') ||
                        lowerText.includes('실무 책임자');
  if (isFreshProfile && hasSeniorText) {
    contradictions.push('프로필에는 "신입/대학생"으로 등록되어 있으나, 초안 본문에는 "팀장/과장/수년차 경력" 등 실무 책임자 직책 관련 묘사가 감지되어 상호 모순됩니다.');
  }

  return contradictions;
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
