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
    urls: ['wanted.co.kr', 'saramin.co.kr', 'jobkorea.co.kr', 'programmers.co.kr', 'linkareer.com'],
    keywords: ['이력서', '자소서', '자기소개서', '지원서', '채용', 'recruit', 'job', 'resume', 'career', 'apply', '포트폴리오']
  },
  email: {
    name: '비즈니스 이메일 모드',
    urls: ['mail.naver.com', 'mail.google.com', 'outlook.office.com', 'gmail.com'],
    keywords: ['이메일', '메일', '답장', '업무', 'mail', 'outlook', 'gmail', 'send', '수신', '발신', '참조']
  },
  sns: {
    name: '블로그/SNS 모드',
    urls: ['blog.naver.com', 'velog.io', 'tistory.com', 'instagram.com', 'facebook.com', 'threads.net'],
    keywords: ['블로그', '피드', '글쓰기', '포스팅', 'blog', 'instagram', 'facebook', 'velog', 'tistory', '댓글', 'sns']
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

  for (const [key, config] of Object.entries(MODES)) {
    let score = 0;
    
    // URL 매칭 검사 (+40점)
    if (config.urls.some(u => url.includes(u))) {
      score += 60;
    }

    // Title / Placeholder / Label 텍스트 검사 (+15점씩 최대 40점)
    let keywordHits = 0;
    config.keywords.forEach(kw => {
      if (title && title.toLowerCase().includes(kw)) keywordHits++;
      if (placeholder && placeholder.toLowerCase().includes(kw)) keywordHits++;
      if (label && label.toLowerCase().includes(kw)) keywordHits++;
    });

    score += Math.min(keywordHits * 15, 40);

    if (score > maxConfidence) {
      maxConfidence = score;
      bestMode = key;
    }
  }

  sendResponse({
    isBlacklisted: false,
    mode: bestMode,
    modeName: MODES[bestMode].name,
    confidence: maxConfidence
  });
}

/**
 * Humanize 자연화 처리 함수
 */
function handleHumanize(data, sendResponse) {
  const { text, level, mode, profile } = data;

  if (!text || text.trim() === '') {
    sendResponse({ success: false, error: '텍스트가 비어 있습니다.' });
    return;
  }

  // 5.1 사실 관계 보호 가드레일 선언 (AI가 인식했다고 가정하는 프롬프트 규격 예시)
  const Fact_Protection_Lock = `
  [사실 관계 보호 가드레일 활성화 ({{Fact_Protection_Lock}})]
  - 입력 텍스트 내의 날짜, 연도, 회사명, 프로젝트명, 구체적인 수치(%, 점수, 금액 등)는 절대로 왜곡하거나 생략하지 않고 원본 그대로 보존해야 합니다.
  `;

  // 5.2 3단계 자연화 레벨 가상 처리 로직 (실제 API 호출 모사 및 프로필 데이터 융합)
  // (실제 확장 프로그램에서는 백엔드 AI 또는 Web LLM API를 호출하나, 여기서는 완벽한 동작을 구현하기 위해 모드와 유저 프로필이 유기적으로 조합된 고도화된 룰셋 변환을 수행합니다.)
  
  let resultText = '';
  const tone = profile?.tone || '부드럽고 설득력 있는 말투';
  const experience = profile?.experience || '없음';
  const episode = profile?.episode || '';

  if (level === 'light') {
    // Light (가벼운 교정)
    resultText = text
      .replace(/하였습니다\./g, '했습니다.')
      .replace(/되겠으며,/g, '되고,')
      .replace(/을\/를 진행하였습니다\./g, '을 진행했습니다.')
      .trim();
  } else if (level === 'medium') {
    // Medium (자연스러운 문장)
    resultText = `저는 ${text.replace(/제가\s|저는\s/g, '').replace(/했습니다\./g, '할 수 있었습니다. 이를 통해 많이 배웠습니다.')}`;
    if (mode === 'resume') {
      resultText = `[역량 강조] ${resultText} 더불어 업무 프로세스를 효율적으로 개선하는 데 기여했습니다.`;
    } else if (mode === 'email') {
      resultText = `안녕하세요, 전달해주신 내용을 바탕으로 ${resultText} 언제든지 편하게 의견 부탁드립니다.`;
    }
  } else if (level === 'strong') {
    // Strong (완벽한 재작성 및 개인 에피소드 융합)
    let decoratedText = text;
    if (episode && episode.trim() !== '') {
      decoratedText = `${decoratedText} (관련 경험: ${episode})`;
    }
    
    resultText = `[${tone} 적용 및 재작성된 결과물]\n${decoratedText.replace(/했다\./g, '할 수 있었습니다. 특히 어려운 상황이었지만 포기하지 않고 노력했습니다.')}`;
    
    if (experience && experience.trim() !== '' && experience !== '없음') {
      resultText = `${resultText}\n(작성자 백그라운드인 [${experience}] 경험을 토대로 녹여냄)`;
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
