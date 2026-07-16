// 김대필 (ContextWrite) Content Script

let activeInputEl = null;      // 현재 포커스된 입력창 엘리먼트
let debounceTimer = null;      // 맥락 감지용 디바운스 타이머
let latestHumanizedText = '';  // 가장 최근에 변환 완료된 텍스트
let isAutoModeEnabled = true;  // 자동 모드 스위칭 활성화 여부
let currentDetectedMode = 'resume';
let globalConfidences = { resume: 0, email: 0, sns: 0 };

// 1. 미니 플로팅 아이콘 및 사이드바 인스턴스
let floatingBtn = null;
let sidebarRoot = null;
let sidebarContainer = null;

// 초기화
init();

function init() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady);
  } else {
    onDomReady();
  }
}

function onDomReady() {
  // 포커스 감지 이벤트 등록
  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('focusout', handleFocusOut);

  // 윈도우 리사이즈 및 스크롤 시 플로팅 버튼 위치 업데이트
  window.addEventListener('resize', updateFloatingBtnPosition);
  window.addEventListener('scroll', updateFloatingBtnPosition, true);

  // 백그라운드 서비스 워커로부터 메시지 수신 (사이드바 토글 등)
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'toggle-sidebar') {
        if (window === window.top) toggleSidebar();
      } else if (message.action === 'sync-sidebar-from-iframe') {
        if (window === window.top) {
          const shadow = sidebarRoot ? sidebarRoot.shadowRoot : null;
          if (shadow) {
            const origInput = shadow.getElementById('cdp-original-input');
            if (origInput) {
              origInput.value = message.text;
              origInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          openSidebar();
          showNotification('선택한 입력창의 텍스트가 AI 초안에 추가되었습니다.');
        }
      } else if (message.action === 'insert-text') {
        if (message.text) {
          insertTextToActiveElement(message.text);
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: '삽입할 텍스트가 없습니다.' });
        }
        return false;
      }
    });
  }

  // 사이드바 DOM 구조 생성
  createSidebarDOM();
}

/**
 * 1. 입력창 포커스 감지 및 500ms 디바운스
 */
function isRecipientOrSubjectField(el) {
  if (!el) return false;

  // 1. 높이 기준 필터링 (메일 에디터나 자소서 본문창은 최소 60px 이상입니다)
  const rect = el.getBoundingClientRect();
  if (rect.height > 0 && rect.height < 60) {
    return true;
  }

  // 2. 키워드 검사 대상 문자열 취합
  const id = (el.id || '').toLowerCase();
  const className = (el.className || '').toLowerCase();
  const name = (el.getAttribute('name') || '').toLowerCase();
  const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
  const role = (el.getAttribute('role') || '').toLowerCase();
  
  // 부모 노드의 클래스/ID도 확인 (Daum/Naver 메일의 주소 래퍼 클래스 확인용)
  const parentClass = el.parentElement ? (el.parentElement.className || '').toLowerCase() : '';
  const parentId = el.parentElement ? (el.parentElement.id || '').toLowerCase() : '';

  const searchStr = `${id} ${className} ${name} ${placeholder} ${role} ${parentClass} ${parentId}`;
  
  // 네이버 웍스/메일 에디터 등 본문 에디터 영역 식별 시 주소/메타 입력창 제외 필터링에서 구제
  if (searchStr.includes('workseditor') || searchStr.includes('editor') || searchStr.includes('classic')) {
    return false;
  }
  
  const ignoreKeywords = [
    'receiver', 'recipient', 'to', 'cc', 'bcc', 'address', 'addr', 'contact', 
    'member', 'writer', 'subject', 'title', 'tag', 'token',
    '받는', '보내는', '참조', '제목', '한줄', '받는이', '보내는이'
  ];

  return ignoreKeywords.some(kw => searchStr.includes(kw));
}

/**
 * 1. 입력창 포커스 감지 및 500ms 디바운스
 */
function handleFocusIn(e) {
  let el = e.target;

  // 비밀번호 입력창 및 민감 입력창 무시
  if (el.tagName === 'INPUT' && el.type === 'password') {
    hideFloatingButton();
    return;
  }

  // 부모 엘리먼트 중 contenteditable="true"가 있는지 확인하여 에디터 대응성 향상
  const editableParent = el.closest('[contenteditable="true"]');
  if (editableParent) {
    el = editableParent;
  }

  // 받는 사람, 제목창 등 메일 주소/메타 입력 필드 제외
  if (isRecipientOrSubjectField(el)) {
    hideFloatingButton();
    return;
  }

  // textarea 및 웹사이트 상의 다양한 글작성 에디터(Rich Text Editor, contenteditable 영역 등)에서만 감지
  const isTextarea = el.tagName === 'TEXTAREA';
  const isEditable = el.isContentEditable;

  if (isTextarea || isEditable) {
    activeInputEl = el;

    // 500ms 디바운스 적용 후 백그라운드로 맥락 분석 요청
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      detectContextAndSync(el);
    }, 500);
  }
}

function handleFocusOut(e) {
  // 클릭한 대상이 플로팅 버튼이 아닌 경우에만 200ms 딜레이 후 버튼 숨김
  // (플로팅 버튼을 클릭할 시간을 확보하기 위함)
  setTimeout(() => {
    if (floatingBtn && !floatingBtn.matches(':hover')) {
      hideFloatingButton();
    }
  }, 200);
}

/**
 * 페이지 내 입력 필드의 글자수 제한을 감지하는 헬퍼 함수
 */
function detectCharacterLimit(el) {
  if (!el) return null;

  // 1. HTML5 표준 maxlength 속성 확인
  const maxLenAttr = el.getAttribute('maxlength') || el.maxLength;
  if (maxLenAttr && maxLenAttr > 0 && maxLenAttr < 100000) {
    return parseInt(maxLenAttr, 10);
  }

  // 2. 주변 DOM에서 글자수 제한 관련 텍스트 탐색 (예: "0 / 1000", "최대 500자" 등)
  const parent = el.parentElement;
  if (parent) {
    const siblings = parent.querySelectorAll('*');
    for (let sib of siblings) {
      if (sib === el) continue;
      const textContent = sib.innerText || sib.textContent || '';
      
      // 패턴 1: / 1,000자, /1000, / 500
      const slashPattern = /\/\s*([0-9,]+)\s*(자)?/i;
      const slashMatch = textContent.match(slashPattern);
      if (slashMatch) {
        const val = parseInt(slashMatch[1].replace(/,/g, ''), 10);
        if (val > 0 && val < 50000) return val;
      }

      // 패턴 2: 최대 1,000자, 1000자 제한, 500자 이하
      const limitPattern = /([0-9,]+)\s*자\s*(제한|이하|내|최대|미만)/i;
      const limitMatch = textContent.match(limitPattern);
      if (limitMatch) {
        const val = parseInt(limitMatch[1].replace(/,/g, ''), 10);
        if (val > 0 && val < 50000) return val;
      }

      // 패턴 3: 최대 1000자
      const maxPattern = /최대\s*([0-9,]+)\s*자/i;
      const maxMatch = textContent.match(maxPattern);
      if (maxMatch) {
        const val = parseInt(maxMatch[1].replace(/,/g, ''), 10);
        if (val > 0 && val < 50000) return val;
      }
    }
  }

  return null;
}

/**
 * 2. 주변 컨텍스트 수집 및 백그라운드 전송
 */
function detectContextAndSync(el) {
  if (!el) return;

  // 실시간 글자수 제한 자동 감지 및 입력박스 반영
  if (sidebarRoot && sidebarRoot.shadowRoot) {
    const limitInput = sidebarRoot.shadowRoot.getElementById('cdp-char-limit-input');
    if (limitInput) {
      const detectedLimit = detectCharacterLimit(el);
      if (detectedLimit) {
        limitInput.value = detectedLimit;
      }
    }
  }

  let url = window.location.href;
  if (url === 'about:blank' || !url.startsWith('http')) {
    try {
      url = window.top.location.href;
    } catch (e) {}
  }
  let title = document.title;
  if (!title || title === 'about:blank') {
    try {
      title = window.top.document.title;
    } catch (e) {}
  }
  const placeholder = el.placeholder || el.getAttribute('placeholder') || '';

  // 레이블 텍스트 수집 (가까운 label 태그 또는 aria-label 탐색)
  let labelText = '';
  if (el.id) {
    const labelEl = document.querySelector(`label[for="${el.id}"]`);
    if (labelEl) labelText = labelEl.innerText;
  }
  if (!labelText) {
    labelText = el.getAttribute('aria-label') || '';
  }

  // 0. 확장 프로그램 컨텍스트 유효성 검사
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    return;
  }

  // 백그라운드로 분석 요청
  try {
    chrome.runtime.sendMessage({
      action: 'analyze-context',
      data: { url, title, placeholder, label: labelText, id: el.id || '', className: el.className || '' }
    }, (response) => {
      if (chrome.runtime.lastError) {
        return;
      }
      if (!response) return;

      // 블랙리스트 탐지 시 기능 미노출
      if (response.isBlacklisted) {
        hideFloatingButton();
        return;
      }

      if (response.confidences) {
        globalConfidences = response.confidences;
      }

      // 1. 해당 페이지가 메일, 이력서, 자소서, 블로그, SNS 중 하나인지 신뢰도로 최종 판정 (최소 40% 이상 매칭 필수)
      if (response.confidence < 40) {
        hideFloatingButton();
        return;
      }

      // 신뢰도가 70% 이상이고 자동 스위칭이 활성화되어 있을 때만 모드 자동 전환
      if (isAutoModeEnabled && response.confidence >= 70) {
        currentDetectedMode = response.mode;
        updateSidebarModeUI(response.mode, response.confidence);
      } else {
        const activeConfidence = globalConfidences[currentDetectedMode] || 0;
        updateSidebarModeUI(currentDetectedMode, activeConfidence);
      }

      // 미니 플로팅 아이콘 표시
      showFloatingButton(el);
    });
  } catch (err) {
    console.error('컨텍스트 분석 중 오류 발생:', err);
  }
}

/**
 * 3. 미니 플로팅 버튼 생성 및 배치
 */
function showFloatingButton(targetEl) {
  // 현재 문서의 head에 플로팅 버튼용 CSS가 없는 경우 동적 주입 (iframe 대응)
  if (!document.getElementById('cdp-floating-btn-style')) {
    const style = document.createElement('style');
    style.id = 'cdp-floating-btn-style';
    style.textContent = `
      .cdp-floating-btn {
        position: absolute !important;
        z-index: 10000000 !important;
        width: 32px !important;
        height: 32px !important;
        background: linear-gradient(135deg, #1E3EA5, #111B35) !important;
        border: 2px solid #FFFFFF !important;
        border-radius: 50% !important;
        box-shadow: 0 3px 10px rgba(0, 0, 0, 0.15) !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1) !important;
        pointer-events: auto !important;
      }
      .cdp-floating-btn:hover {
        transform: scale(1.15) translateY(-2px) !important;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2) !important;
      }
      .cdp-floating-btn img {
        width: 20px !important;
        height: 20px !important;
        object-fit: contain !important;
        filter: none !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  if (!floatingBtn) {
    floatingBtn = document.createElement('div');
    floatingBtn.className = 'cdp-floating-btn';
    floatingBtn.title = '김대필 (자연화 텍스트 삽입)';

    // 김대필 아이콘 png 이미지 삽입
    floatingBtn.innerHTML = `
      <img src="${chrome.runtime.getURL('icons/top_logo.png')}" width="32" height="32" alt="로고" style="display: block; object-fit: contain;">
    `;

    // 클릭 시 해당 인풋에 입력되어 있는 텍스트를 사이드바의 AI 초안에 추가하고 사이드바 열기
    floatingBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();

      if (activeInputEl) {
        let currentText = '';
        if (activeInputEl.tagName === 'INPUT' || activeInputEl.tagName === 'TEXTAREA') {
          currentText = activeInputEl.value;
        } else if (activeInputEl.isContentEditable) {
          currentText = activeInputEl.innerText;
        }

        // iframe과 top 프레임 간의 통일성을 위해 백그라운드로 릴레이 요청
        chrome.runtime.sendMessage({
          action: 'request-sidebar-sync',
          text: currentText
        });
      }
    });

    document.body.appendChild(floatingBtn);
  }

  floatingBtn.style.display = 'flex';
  updateFloatingBtnPosition();
}

function hideFloatingButton() {
  if (floatingBtn) {
    floatingBtn.style.display = 'none';
  }
}

/**
 * 플로팅 버튼의 절대 위치 계산
 */
function updateFloatingBtnPosition() {
  if (!floatingBtn || floatingBtn.style.display === 'none' || !activeInputEl) return;

  const rect = activeInputEl.getBoundingClientRect();
  const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
  const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

  const buttonSize = 28;
  
  // 기본적으로 우측 상단 안쪽에 배치 (TEXTAREA나 contenteditable 같이 큰 영역에서 가장 잘 보임)
  let top = rect.top + scrollTop + 6;
  
  // 일반 한 줄 인풋(INPUT)의 경우 높이가 작으므로 우측 세로 중앙에 오도록 보정
  if (activeInputEl.tagName === 'INPUT') {
    top = rect.top + scrollTop + (rect.height - buttonSize) / 2;
  }
  
  const left = rect.left + scrollLeft + rect.width - buttonSize - 6;

  floatingBtn.style.top = `${top}px`;
  floatingBtn.style.left = `${left}px`;
}

/**
 * 4. 슬라이드인 사이드바 DOM 생성 (Shadow DOM 사용)
 */
function createSidebarDOM() {
  if (window !== window.top) return; // iframe에서는 사이드바 DOM을 생성하지 않음

  // 이미 생성되어 있다면 중복 방지
  if (document.getElementById('cdp-sidebar-root')) return;

  sidebarRoot = document.createElement('div');
  sidebarRoot.id = 'cdp-sidebar-root';

  // Shadow Host 자체에 대한 포지셔닝 보강
  sidebarRoot.style.position = 'fixed';
  sidebarRoot.style.top = '0';
  sidebarRoot.style.right = '0';
  sidebarRoot.style.height = '0';
  sidebarRoot.style.width = '0';
  sidebarRoot.style.zIndex = '99999999';

  document.body.appendChild(sidebarRoot);

  // Shadow root 열기 (격리된 스타일 보장)
  const shadow = sidebarRoot.attachShadow({ mode: 'open' });

  // CSS 직접 인라인 주입
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&family=Noto+Sans+KR:wght@300;400;500;700&display=swap');

    /* 1. 미니 플로팅 버튼 스타일 */
    .cdp-floating-btn {
      position: absolute;
      z-index: 10000000;
      width: 32px;
      height: 32px;
      background: transparent;
      border: none;
      box-shadow: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      pointer-events: auto;
    }
    .cdp-floating-btn:hover {
      transform: scale(1.15) translateY(-2px);
    }
    .cdp-floating-btn img {
      width: 100%;
      height: 100%;
      object-fit: contain;
    }

    /* 2. 슬라이드인 사이드바 컨테이너 */
    .cdp-sidebar-container {
      position: fixed;
      top: 0;
      right: 0;
      width: 380px;
      min-width: 320px;
      max-width: 90vw;
      height: 100vh;
      background-color: #F8FAFC;
      box-shadow: -8px 0 32px rgba(15, 23, 42, 0.08);
      z-index: 9999999;
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      font-family: 'Outfit', 'Noto Sans KR', sans-serif;
      color: #0F172A;
      box-sizing: border-box;
    }
    .cdp-sidebar-container.cdp-open {
      transform: translateX(0);
    }
    
    /* 리사이즈 핸들 */
    .cdp-resize-handle {
      position: absolute;
      top: 0;
      left: 0;
      width: 8px;
      height: 100%;
      cursor: ew-resize;
      background-color: transparent;
      z-index: 10000005;
      transition: background-color 0.25s;
    }
    .cdp-resize-handle:hover, .cdp-resize-handle.cdp-resizing {
      background: linear-gradient(to bottom, rgba(30, 64, 175, 0.2), rgba(13, 148, 136, 0.2));
      border-left: 1px solid rgba(13, 148, 136, 0.4);
    }

    /* 3. 헤더 (그라데이션 및 폰트 세팅) */
    .cdp-header {
      padding: 14px 16px;
      background: linear-gradient(135deg, #1E40AF 0%, #1e3a8a 50%, #0F172A 100%);
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.1);
      box-sizing: border-box;
      gap: 12px;
    }
    .cdp-header-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 6px;
      text-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
      white-space: nowrap;
      flex-shrink: 0;
    }
    .cdp-header-controls {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .cdp-header-controls span {
      white-space: nowrap;
    }
    #cdp-confidence-badge {
      white-space: nowrap;
      display: inline-block;
    }

    /* 토글 스위치 */
    .cdp-switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 22px;
    }
    .cdp-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .cdp-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(255, 255, 255, 0.3);
      transition: .3s cubic-bezier(0.4, 0, 0.2, 1);
      border-radius: 30px;
      backdrop-filter: blur(4px);
    }
    .cdp-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s cubic-bezier(0.4, 0, 0.2, 1);
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }
    input:checked + .cdp-slider {
      background-color: #0D9488;
    }
    input:checked + .cdp-slider:before {
      transform: translateX(18px);
    }
    .cdp-icon-btn {
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: #FFFFFF;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.25s ease;
      flex-shrink: 0;
    }
    .cdp-icon-btn:hover {
      background: rgba(255, 255, 255, 0.25);
      transform: scale(1.08);
    }

    /* 4. 사이드바 바디 (스크롤 및 부드러운 여백 카드뷰) */
    .cdp-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px 16px;
      display: flex;
      flex-direction: column;
      gap: 16px;
      background-color: #F8FAFC;
    }
    .cdp-section {
      background-color: #FFFFFF;
      border-radius: 12px;
      padding: 16px;
      border: 1px solid rgba(226, 232, 240, 0.8);
      box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.03), 0 2px 4px -2px rgba(15, 23, 42, 0.02);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .cdp-section:hover {
      box-shadow: 0 10px 15px -3px rgba(15, 23, 42, 0.05), 0 4px 6px -4px rgba(15, 23, 42, 0.05);
    }
    .cdp-section-title {
      font-size: 13px;
      font-weight: 700;
      color: #1E293B;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 0;
      margin-bottom: 12px;
      border-left: 3px solid #1E40AF;
      padding-left: 8px;
    }

    /* 5. 셀렉터 (둥근 모서리 및 입체감 제공) */
    .cdp-select {
      width: 100%;
      padding: 10px 14px;
      font-size: 14px;
      font-family: inherit;
      font-weight: 500;
      border-radius: 8px;
      border: 1px solid #E2E8F0;
      background-color: #FFFFFF;
      color: #334155;
      outline: none;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
    }
    .cdp-select:focus {
      border-color: #1E40AF;
      box-shadow: 0 0 0 3px rgba(30, 64, 175, 0.1);
    }

    /* 6. 에디터 영역 */
    .cdp-editor-section {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .cdp-textarea-wrapper {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .cdp-label {
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }
    .cdp-textarea {
      width: 100%;
      height: 100px;
      padding: 10px 12px;
      font-size: 14px;
      font-family: inherit;
      line-height: 1.25;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      resize: none;
      box-sizing: border-box;
      outline: none;
      transition: all 0.2s;
      color: #334155;
      background-color: #FCFDFE;
    }
    .cdp-textarea:focus {
      border-color: #1E40AF;
      background-color: #FFFFFF;
      box-shadow: 0 0 0 3px rgba(30, 64, 175, 0.1);
    }
    .cdp-result-view {
      min-height: 100px;
      padding: 12px;
      font-size: 14px;
      font-family: inherit;
      line-height: 1.25;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      background-color: #FFFFFF;
      white-space: pre-wrap;
      word-break: break-all;
      box-sizing: border-box;
      color: #1E293B;
    }
    .cdp-highlight {
      background-color: rgba(13, 148, 136, 0.25) !important;
      border-bottom: 2px solid #0D9488 !important;
      padding: 1px 3px !important;
      border-radius: 4px !important;
      font-weight: 600 !important;
      color: #0F766E !important;
    }
    .cdp-level-group {
      display: flex;
      gap: 6px;
    }
    .cdp-level-btn {
      flex: 1;
      padding: 8px 0;
      font-size: 12px;
      font-family: inherit;
      font-weight: 600;
      border: 1px solid #E2E8F0;
      background-color: #FFFFFF;
      color: #64748B;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .cdp-level-btn:hover {
      background-color: #F8FAFC;
      border-color: #CBD5E1;
      color: #475569;
    }
    .cdp-level-btn.cdp-active {
      background-color: #1E40AF;
      color: #FFFFFF;
      border-color: #1E40AF;
      box-shadow: 0 4px 10px rgba(30, 64, 175, 0.2);
    }
    .cdp-level-btn.cdp-active-mint {
      background-color: #0D9488;
      color: #FFFFFF;
      border-color: #0D9488;
      box-shadow: 0 4px 10px rgba(13, 148, 136, 0.2);
    }

    /* 7. 분석 대시보드 */
    .cdp-gauge-container {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .cdp-gauge-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .cdp-gauge-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }
    .cdp-gauge-bar-bg {
      width: 100%;
      height: 6px;
      background-color: #F1F5F9;
      border-radius: 10px;
      overflow: hidden;
    }
    .cdp-gauge-bar-fill {
      height: 100%;
      width: 0%;
      border-radius: 10px;
      transition: width 0.8s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.3s;
    }
    .cdp-gauge-green {
      background: linear-gradient(90deg, #10B981, #059669);
      box-shadow: 0 0 8px rgba(16, 185, 129, 0.2);
    }
    .cdp-gauge-red {
      background: linear-gradient(90deg, #F43F5E, #E11D48);
      box-shadow: 0 0 8px rgba(244, 63, 94, 0.2);
    }

    /* 8. 프로필 학습 패널 */
    .cdp-profile-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .cdp-input {
      width: 100%;
      padding: 8px 10px;
      font-size: 13px;
      font-family: inherit;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      box-sizing: border-box;
      outline: none;
      transition: all 0.2s;
      color: #334155;
      background-color: #FCFDFE;
    }
    .cdp-input:focus {
      border-color: #1E40AF;
      background-color: #FFFFFF;
      box-shadow: 0 0 0 3px rgba(30, 64, 175, 0.1);
    }

    /* 9. 푸터 영역 (그림자 및 트랜지션 처리) */
    .cdp-footer {
      padding: 18px 16px;
      border-top: 1px solid rgba(226, 232, 240, 0.8);
      background-color: #FFFFFF;
      display: flex;
      flex-direction: column;
      gap: 8px;
      box-shadow: 0 -4px 20px rgba(15, 23, 42, 0.02);
    }
    .cdp-primary-btn {
      width: 100%;
      padding: 12px 0;
      font-size: 14px;
      font-weight: 700;
      font-family: inherit;
      border: none;
      border-radius: 8px;
      background: linear-gradient(135deg, #0D9488 0%, #0F766E 100%);
      color: #FFFFFF;
      cursor: pointer;
      transition: all 0.25s ease;
      box-shadow: 0 4px 12px rgba(13, 148, 136, 0.2);
      text-align: center;
    }
    .cdp-primary-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(13, 148, 136, 0.35);
    }
    .cdp-secondary-btn {
      width: 100%;
      padding: 10px 0;
      font-size: 13px;
      font-weight: 600;
      font-family: inherit;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      background-color: #FFFFFF;
      color: #475569;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
    }
    .cdp-secondary-btn:hover {
      background-color: #F8FAFC;
      border-color: #CBD5E1;
      color: #1E293B;
    }
    .cdp-btn-row {
      display: flex;
      gap: 8px;
    }
    .cdp-btn-row button {
      flex: 1;
    }
    
    /* 10. 로딩 상태 스타일 */
    .cdp-loading-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 30px 10px;
      gap: 12px;
      color: #0D9488;
    }
    .cdp-spinner {
      width: 28px;
      height: 28px;
      border: 3px solid #E2E8F0;
      border-top-color: #0D9488;
      border-radius: 50%;
      animation: cdp-spin 0.8s linear infinite;
    }
    .cdp-progress-bar-container {
      width: 80%;
      height: 6px;
      background-color: #E2E8F0;
      border-radius: 3px;
      overflow: hidden;
      position: relative;
    }
    .cdp-progress-bar-fill {
      width: 40%;
      height: 100%;
      background: linear-gradient(90deg, #0D9488, #0F766E);
      border-radius: 3px;
      position: absolute;
      left: 0;
      top: 0;
      animation: cdp-progress-anim 1.5s infinite ease-in-out;
    }

    @keyframes cdp-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes cdp-progress-anim {
      0% { left: -40%; }
      50% { left: 40%; width: 60%; }
      100% { left: 100%; }
    }

    /* 최근 변환 내역 아이템 스타일 */
    .cdp-history-item {
      background-color: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 8px;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: all 0.2s;
      margin-bottom: 6px;
    }
    .cdp-history-item:hover {
      background-color: #F1F5F9;
      border-color: #CBD5E1;
    }
    .cdp-history-item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #64748B;
    }
    .cdp-history-badge {
      font-size: 10px;
      font-weight: bold;
      color: #ffffff;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .cdp-history-badge.resume { background: #1E40AF; }
    .cdp-history-badge.email { background: #0D9488; }
    .cdp-history-badge.sns { background: #BE185D; }
    
    .cdp-history-body {
      font-size: 12px;
      color: #334155;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      word-break: break-all;
      line-height: 1.5;
    }
    .cdp-history-actions {
      display: flex;
      justify-content: flex-end;
      gap: 6px;
      margin-top: 2px;
    }
    .cdp-history-btn {
      font-size: 11px;
      font-weight: 600;
      border: 1px solid #E2E8F0;
      border-radius: 4px;
      background-color: #ffffff;
      color: #475569;
      padding: 2px 6px;
      cursor: pointer;
      transition: all 0.2s;
      font-family: inherit;
    }
    .cdp-history-btn:hover {
      background-color: #F8FAFC;
      border-color: #CBD5E1;
      color: #0F172A;
    }
  `;
  shadow.appendChild(styleEl);

  // 사이드바 컨테이너 생성
  sidebarContainer = document.createElement('div');
  sidebarContainer.className = 'cdp-sidebar-container';

  // HTML 구성
  sidebarContainer.innerHTML = `
    <!-- 리사이즈 드래그 핸들 -->
    <div class="cdp-resize-handle" id="cdp-resize-handle"></div>

    <!-- 헤더 -->
    <div class="cdp-header">
      <h3 class="cdp-header-title">
        <img src="${chrome.runtime.getURL('icons/top_logo.png')}" width="20" height="20" alt="로고" style="display: block; object-fit: contain; transform: translateY(2px);">
        김대필
      </h3>
      <div class="cdp-header-controls">
        <span>자동 모드</span>
        <label class="cdp-switch">
          <input type="checkbox" id="cdp-auto-toggle" checked>
          <span class="cdp-slider"></span>
        </label>
        <button class="cdp-icon-btn" id="cdp-newwindow-btn" title="새 창으로 열기">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="8" y="8" width="12" height="12" rx="2" ry="2"></rect>
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
          </svg>
        </button>
        <button class="cdp-icon-btn" id="cdp-settings-btn" title="AI 서비스/API 키 설정">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
        <button class="cdp-icon-btn" id="cdp-close-btn" style="font-size: 16px; font-weight: bold;">&times;</button>
      </div>
    </div>

    <!-- 바디 -->
    <div class="cdp-body">
      <!-- 1. 모드 셀렉터 -->
      <div class="cdp-section">
        <p class="cdp-section-title">작성 컨텍스트 모드</p>
        <select class="cdp-select" id="cdp-mode-select">
          <option value="resume">이력서/자소서 모드</option>
          <option value="email">비즈니스 이메일 모드</option>
          <option value="sns">블로그/SNS 모드</option>
        </select>
      </div>

      <!-- 2. 개인 맞춤형 프로필 학습 -->
      <div class="cdp-section">
        <p class="cdp-section-title">개인 맞춤형 프로필 학습</p>
        <div class="cdp-profile-form">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="cdp-label">AI 페르소나 설정</label>
            <select class="cdp-select" id="cdp-profile-persona" style="padding: 6px 10px; font-size: 13px; box-sizing: border-box; line-height: 1.5;">
              <option value="professor">국어국문학과 교수 (어휘·문법 정밀 교정)</option>
              <option value="recruiter">글로벌 IT 기업 인사담당자 (자소서·성과 강조)</option>
              <option value="copywriter">트렌디한 카피라이터 (설득력 있는 메일·광고)</option>
              <option value="influencer">친근한 파워 인플루언서 (소통 어조 및 이모지)</option>
            </select>
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="cdp-label" id="cdp-label-tone">원하는 말투/톤</label>
            <input type="text" class="cdp-input" id="cdp-profile-tone" placeholder="예: 정중하고 부드러운 격식체">
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="cdp-label" id="cdp-label-exp">경력 및 백그라운드</label>
            <input type="text" class="cdp-input" id="cdp-profile-exp" placeholder="예: 3년차 프론트엔드 개발자">
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="cdp-label" id="cdp-label-target">지원회사</label>
            <input type="text" class="cdp-input" id="cdp-profile-target" placeholder="예: 네이버">
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="cdp-label" id="cdp-label-job">업직종</label>
            <input type="text" class="cdp-input" id="cdp-profile-job" placeholder="예: IT/프론트엔드 개발자">
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="cdp-label" id="cdp-label-episode">핵심 강점/에피소드</label>
            <textarea class="cdp-textarea" id="cdp-profile-episode" placeholder="자주 녹여내고 싶은 나만의 핵심 에피소드나 키워드를 적어주세요." style="height: 60px; font-size:12px;"></textarea>
          </div>
        </div>
      </div>

      <!-- 3. 에디터 영역 (비교 뷰) -->
      <div class="cdp-section cdp-editor-section">
        <p class="cdp-section-title">AI 초안 자연화 (Humanize)</p>
        
        <div class="cdp-textarea-wrapper">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <label class="cdp-label" style="white-space: nowrap; flex-shrink: 0;">Original AI 초안</label>
            <span id="cdp-orig-char-count" style="font-size: 11px; color: #6B7280; white-space: nowrap; flex-shrink: 0; text-align: right; line-height: 1.3;">0자<br>(공백 제외 0자)</span>
          </div>
          <textarea class="cdp-textarea" id="cdp-original-input" placeholder="여기에 어색한 AI 초안을 입력하거나 문장을 작성하세요."></textarea>
        </div>

        <div class="cdp-textarea-wrapper">
          <label class="cdp-label">추가 개선 요청사항 (선택)</label>
          <input type="text" class="cdp-input" id="cdp-custom-instruction" placeholder="예: 좀 더 열정적인 어조로 써줘, 구체적 성과 위주로 다듬어줘 등" style="font-size: 12.5px;">
        </div>

        <div class="cdp-textarea-wrapper">
          <label class="cdp-label">자연화 강도 설정</label>
          <div class="cdp-level-group">
            <button class="cdp-level-btn cdp-active" data-level="light">Light (가벼움)</button>
            <button class="cdp-level-btn" data-level="medium">Medium (보통)</button>
            <button class="cdp-level-btn" data-level="strong">Strong (강함)</button>
          </div>
        </div>

        <div class="cdp-textarea-wrapper">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <label class="cdp-label">목표 글자수 제한 (공백 포함)</label>
            <input type="number" id="cdp-char-limit-input" placeholder="제한 없음 (예: 500)" style="width: 120px; padding: 4px 8px; font-size: 12px; border: 1px solid #E5E7EB; border-radius: 4px; outline: none; box-sizing: border-box;">
          </div>
        </div>

        <div class="cdp-textarea-wrapper">
          <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <label class="cdp-label" style="white-space: nowrap; flex-shrink: 0;">Humanized 결과</label>
            <span id="cdp-result-char-count" style="font-size: 11px; color: #6B7280; white-space: nowrap; flex-shrink: 0; text-align: right; line-height: 1.3;">0자<br>(공백 제외 0자)</span>
          </div>
          <div class="cdp-result-view" id="cdp-humanized-result">변환을 실행하시면 김대필의 정교한 교정을 거쳐 목적에 맞게 다듬어진 설득력 있는 문장이 이곳에 나타납니다.</div>
          <div id="cdp-model-badge-container" style="display: flex; justify-content: flex-end; margin-top: 6px; margin-bottom: 2px;">
            <span id="cdp-model-badge" style="display: inline-flex; align-items: center; gap: 4px; font-size: 10px; color: #64748B; background-color: #F8FAFC; border: 1px solid #E2E8F0; padding: 2px 8px; border-radius: 9999px; font-weight: 600; box-shadow: inset 0 1px 1px rgba(0,0,0,0.02); transition: all 0.2s;">
              <span style="display: inline-block; width: 6px; height: 6px; border-radius: 50%; background-color: #94A3B8;" id="cdp-model-status-dot"></span>
              <span id="cdp-model-name-text">AI 모델: 대기 중</span>
            </span>
          </div>
        </div>
      </div>

      <!-- 4. 분석 대시보드 -->
      <div class="cdp-section">
        <p class="cdp-section-title">AI 탐지 및 매칭 대시보드</p>
        <div class="cdp-gauge-container">
          <!-- AI 탐지 점수 -->
          <div class="cdp-gauge-item">
            <div class="cdp-gauge-header">
              <span>AI 탐지 예측 점수 (낮을수록 안전)</span>
              <span id="cdp-ai-score-val">-</span>
            </div>
            <div class="cdp-gauge-bar-bg">
              <div class="cdp-gauge-bar-fill cdp-gauge-red" id="cdp-ai-score-fill" style="width: 0%;"></div>
            </div>
          </div>
          <!-- ATS 매칭 점수 -->
          <div class="cdp-gauge-item">
            <div class="cdp-gauge-header">
              <span>ATS 매칭 적합도 (높을수록 우수)</span>
              <span id="cdp-ats-score-val">-</span>
            </div>
            <div class="cdp-gauge-bar-bg">
              <div class="cdp-gauge-bar-fill cdp-gauge-green" id="cdp-ats-score-fill" style="width: 0%;"></div>
            </div>
          </div>
        </div>
      </div>

      <!-- 5. 최근 변환 내역 -->
      <div class="cdp-section">
        <p class="cdp-section-title">최근 변환 내역</p>
        <div id="cdp-history-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 200px; overflow-y: auto; padding-right: 4px;">
          <div style="font-size: 12px; color: #64748B; text-align: center; padding: 10px 0;">로딩 중...</div>
        </div>
      </div>
    </div>

    <!-- 푸터 -->
    <div class="cdp-footer">
      <button class="cdp-primary-btn" id="cdp-insert-btn">웹페이지에 즉시 삽입</button>
      <div class="cdp-btn-row">
        <button class="cdp-secondary-btn" id="cdp-docx-btn">DOCX 다운로드</button>
        <button class="cdp-secondary-btn" id="cdp-transform-btn" style="background-color: #1E40AF; color: white; border: none;">자연화 변환</button>
      </div>
    </div>
  `;

  shadow.appendChild(sidebarContainer);

  // 이벤트 핸들러 및 스토리지 연동 바인딩
  bindSidebarEvents(shadow);
}

/**
 * 사이드바 내부 이벤트 및 기능 연결
 */
function bindSidebarEvents(shadow) {
  const closeBtn = shadow.getElementById('cdp-close-btn');
  const autoToggle = shadow.getElementById('cdp-auto-toggle');
  const modeSelect = shadow.getElementById('cdp-mode-select');
  const originalInput = shadow.getElementById('cdp-original-input');
  const levelBtns = shadow.querySelectorAll('.cdp-level-btn');
  const transformBtn = shadow.getElementById('cdp-transform-btn');
  const insertBtn = shadow.getElementById('cdp-insert-btn');
  const docxBtn = shadow.getElementById('cdp-docx-btn');

  // 프로필 관련 입력 필드
  const profileTone = shadow.getElementById('cdp-profile-tone');
  const profileExp = shadow.getElementById('cdp-profile-exp');
  const profileTarget = shadow.getElementById('cdp-profile-target');
  const profileJob = shadow.getElementById('cdp-profile-job');
  const profileEpisode = shadow.getElementById('cdp-profile-episode');

  let selectedLevel = 'light';

  // 글자 수 카운트 실시간 업데이트 함수
  const updateCharCounts = () => {
    const origText = originalInput.value || '';
    const origCharCount = origText.length;
    const origCharNoSpaceCount = origText.replace(/\s/g, '').length;

    const origBadge = shadow.getElementById('cdp-orig-char-count');
    if (origBadge) {
      origBadge.innerHTML = `${origCharCount}자<br>(공백 제외 ${origCharNoSpaceCount}자)`;
    }

    const resultText = latestHumanizedText || '';
    const resultCharCount = resultText.length;
    const resultCharNoSpaceCount = resultText.replace(/\s/g, '').length;

    const resultBadge = shadow.getElementById('cdp-result-char-count');
    if (resultBadge) {
      resultBadge.innerHTML = `${resultCharCount}자<br>(공백 제외 ${resultCharNoSpaceCount}자)`;
    }
  };

  // 1. 닫기 버튼
  closeBtn.addEventListener('click', closeSidebar);

  // 1-1. 설정 버튼 클릭 시 옵션 페이지 열기
  const settingsBtn = shadow.getElementById('cdp-settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ action: 'open-options' });
    });
  }

  // 1-1. 새창 버튼 클릭 시 새 창으로 팝업 열기
  const newwindowBtn = shadow.getElementById('cdp-newwindow-btn');
  if (newwindowBtn) {
    newwindowBtn.addEventListener('click', () => {
      const origText = originalInput ? originalInput.value : '';
      const customInst = shadow.getElementById('cdp-custom-instruction') ? shadow.getElementById('cdp-custom-instruction').value : '';
      const modeVal = modeSelect ? modeSelect.value : 'resume';
      const confidenceBadge = shadow.getElementById('cdp-confidence-badge');
      const confidenceText = confidenceBadge ? confidenceBadge.innerText : '신뢰도: -';
      const targetVal = profileTarget ? profileTarget.value : '';
      const jobVal = profileJob ? profileJob.value : '';
      
      chrome.storage.local.set({
        temp_originalText: origText,
        temp_customInstruction: customInst,
        temp_mode: modeVal,
        temp_confidence: confidenceText,
        temp_globalConfidences: globalConfidences,
        temp_profileTarget: targetVal,
        temp_profileJob: jobVal
      }, () => {
        chrome.runtime.sendMessage({ action: 'open-popup-window' });
        closeSidebar(); // 사이드바는 닫음
      });
    });
  }

  // 1-2. 리사이즈 핸들 드래그 기능 바인딩
  const resizeHandle = shadow.getElementById('cdp-resize-handle');
  if (resizeHandle && sidebarContainer && sidebarRoot) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    const onMouseDown = (e) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = sidebarContainer.offsetWidth;
      resizeHandle.classList.add('cdp-resizing');

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);

      e.preventDefault();
    };

    const onMouseMove = (e) => {
      if (!isResizing) return;
      const widthDelta = startX - e.clientX;
      const newWidth = Math.max(320, Math.min(window.innerWidth * 0.9, startWidth + widthDelta));

      sidebarContainer.style.width = `${newWidth}px`;
      sidebarRoot.style.width = `${newWidth}px`;
    };

    const onMouseUp = () => {
      if (isResizing) {
        isResizing = false;
        resizeHandle.classList.remove('cdp-resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      }
    };

    resizeHandle.addEventListener('mousedown', onMouseDown);
  }

  // 1-3. 입력값 변경 시 글자수 세기
  originalInput.addEventListener('input', updateCharCounts);

  // 2. 자동 모드 스위칭 토글
  autoToggle.addEventListener('change', (e) => {
    isAutoModeEnabled = e.target.checked;
  });

  // 3. 모드 셀렉터 변경
  modeSelect.addEventListener('change', (e) => {
    currentDetectedMode = e.target.value;
    updateProfileFields(shadow, currentDetectedMode);
    
    // 수동으로 모드를 변경했을 때도 해당 모드에 부합하는 신뢰도로 갱신
    const activeConfidence = globalConfidences[currentDetectedMode] || 0;
    const confidenceBadge = shadow.getElementById('cdp-confidence-badge');
    if (confidenceBadge) {
      confidenceBadge.innerText = `신뢰도: ${activeConfidence}%`;
    }
  });

  // 4. 자연화 강도 선택
  levelBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      levelBtns.forEach(b => b.classList.remove('cdp-active', 'cdp-active-mint'));
      selectedLevel = btn.getAttribute('data-level');

      if (selectedLevel === 'strong') {
        btn.classList.add('cdp-active-mint'); // Strong일 때는 민트색으로 강조
      } else {
        btn.classList.add('cdp-active');
      }
    });
  });

  // 5. 자연화 변환 실행
  transformBtn.addEventListener('click', () => {
    const text = originalInput.value;
    if (!text || text.trim() === '') {
      alert('AI 초안 텍스트를 입력해주세요.');
      return;
    }

    const charLimitVal = shadow.getElementById('cdp-char-limit-input') ? parseInt(shadow.getElementById('cdp-char-limit-input').value, 10) : null;

    // 로딩바 표시 및 버튼 비활성화
    const resultView = shadow.getElementById('cdp-humanized-result');
    if (resultView) {
      resultView.innerHTML = `
        <div class="cdp-loading-container">
          <div class="cdp-spinner"></div>
          <div style="font-size: 13px; font-weight: 500; text-align: center;">AI가 자연스러운 문맥을 학습하여 교정 중입니다...</div>
          <div class="cdp-progress-bar-container">
            <div class="cdp-progress-bar-fill"></div>
          </div>
        </div>
      `;
    }
    transformBtn.disabled = true;
    transformBtn.style.opacity = '0.6';
    transformBtn.innerText = '변환 중...';

    // 로컬 스토리지에 저장된 유저 프로필 로드
    const mode = currentDetectedMode;
    const keys = [
      'aiProvider',
      `${mode}_profileTone`,
      `${mode}_profileExp`,
      `${mode}_profileTarget`,
      `${mode}_profileJob`,
      `${mode}_profileEpisode`,
      `${mode}_profilePersona`,
      'profileTone',
      'profileExp',
      'profileTarget',
      'profileJob',
      'profileEpisode',
      'resume_profileEpisode',
      'email_profileEpisode',
      'sns_profileEpisode'
    ];

    chrome.storage.local.get(keys, (res) => {
      const provider = res.aiProvider || 'default_nvidia';
      if (provider === 'simulation') {
        alert('AI 모델이 선택되지 않았습니다. 설정 페이지(⚙️)에서 사용할 AI 모델(OpenAI, Gemini 등)을 먼저 선택하고 API 키를 등록해주세요.');
        // 로딩바 및 버튼 복원
        if (resultView) resultView.innerHTML = '변환을 실행하시면 김대필의 정교한 교정을 거쳐 목적에 맞게 다듬어진 설득력 있는 문장이 이곳에 나타납니다.';
        transformBtn.disabled = false;
        transformBtn.style.opacity = '1';
        transformBtn.innerText = '자연화 변환';
        return;
      }

      const profile = {
        tone: (profileTone ? profileTone.value : '') || res[`${mode}_profileTone`] || res['profileTone'] || '',
        experience: (profileExp ? profileExp.value : '') || res[`${mode}_profileExp`] || res['profileExp'] || '',
        target: (profileTarget ? profileTarget.value : '') || res[`${mode}_profileTarget`] || res['profileTarget'] || '',
        job: (profileJob ? profileJob.value : '') || res[`${mode}_profileJob`] || res['profileJob'] || '',
        episode: (profileEpisode ? profileEpisode.value : '') || res[`${mode}_profileEpisode`] || res['profileEpisode'] || res['resume_profileEpisode'] || res['email_profileEpisode'] || res['sns_profileEpisode'] || ''
      };
      const persona = res[`${mode}_profilePersona`] || 'professor';

      // 0. 확장 프로그램 컨텍스트 유효성 검사
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        alert('확장 프로그램 연결이 끊어졌습니다. 페이지를 새로고침해주세요.');
        // 로딩바 및 버튼 복원
        if (resultView) resultView.innerHTML = '변환을 실행하시면 김대필의 정교한 교정을 거쳐 목적에 맞게 다듬어진 설득력 있는 문장이 이곳에 나타납니다.';
        transformBtn.disabled = false;
        transformBtn.style.opacity = '1';
        transformBtn.innerText = '자연화 변환';
        return;
      }

      const customInstruction = shadow.getElementById('cdp-custom-instruction') ? shadow.getElementById('cdp-custom-instruction').value : '';

      // 백그라운드로 자연화 요청
      try {
        const p = chrome.runtime.sendMessage({
          action: 'humanize',
          data: {
            text: text,
            level: selectedLevel,
            mode: currentDetectedMode,
            profile: profile,
            charLimit: isNaN(charLimitVal) ? null : charLimitVal,
            customInstruction: customInstruction,
            persona: persona
          }
        }, (response) => {
          // 버튼 상태 즉시 복원
          transformBtn.disabled = false;
          transformBtn.style.opacity = '1';
          transformBtn.innerText = '자연화 변환';

          if (chrome.runtime.lastError) {
            alert('백그라운드 서비스 워커와의 통신 실패. 페이지를 새로고침한 후 다시 시도해 주세요.');
            if (resultView) resultView.innerHTML = '변환을 실행하시면 김대필의 정교한 교정을 거쳐 목적에 맞게 다듬어진 설득력 있는 문장이 이곳에 나타납니다.';
            return;
          }
          if (!response || !response.success) {
            const errMsg = response ? response.error : '알 수 없는 오류';
            if (errMsg.includes('403') || errMsg.includes('Forbidden')) {
              alert('NVIDIA 기본 연동 키의 무료 크레딧이 만료되었거나 비활성화 상태입니다. 설정(⚙️)으로 가셔서 [Google Gemini] 또는 [OpenAI] 제공사를 선택하고 본인의 API Key를 입력하여 무료/유료 서비스를 즉시 전환해 주십시오.');
            } else {
              alert(`변환 요청 중 오류가 발생했습니다:\n${errMsg}`);
            }
            if (resultView) resultView.innerHTML = '변환을 실행하시면 김대필의 정교한 교정을 거쳐 목적에 맞게 다듬어진 설득력 있는 문장이 이곳에 나타납니다.';
            return;
          }

          // 결과 반영 및 하이라이트 효과 적용
          latestHumanizedText = response.humanizedText;
          renderHumanizedResult(shadow, response.humanizedText, response.warnings);
          updateCharCounts(); // 결과 글자 수 반영

          // 모델 배지 업데이트
          const modelNameText = shadow.getElementById('cdp-model-name-text');
          const modelStatusDot = shadow.getElementById('cdp-model-status-dot');
          if (modelNameText && response.modelUsed) {
            modelNameText.innerText = `AI 모델: ${response.modelUsed}`;
            if (modelStatusDot) {
              modelStatusDot.style.backgroundColor = response.modelUsed.includes('시뮬레이터') ? '#64748B' : '#0D9488';
            }
          }

          // 분석 대시보드 게이지 업데이트
          updateDashboard(shadow, response.aiDetectionScore, response.atsScore);

          // 내역 저장 호출
          saveToHistory(shadow, currentDetectedMode, text, response.humanizedText);
        });

        if (p && typeof p.catch === 'function') {
          p.catch(err => {
            // 버튼 상태 즉시 복원
            transformBtn.disabled = false;
            transformBtn.style.opacity = '1';
            transformBtn.innerText = '자연화 변환';
            if (resultView) resultView.innerHTML = '변환을 실행하시면 김대필의 정교한 교정을 거쳐 목적에 맞게 다듬어진 설득력 있는 문장이 이곳에 나타납니다.';
            alert('백그라운드 연결 오류가 발생했습니다. 페이지를 새로고침해주세요.');
          });
        }
      } catch (err) {
        console.error(err);
        // 오류 시 상태 복원
        transformBtn.disabled = false;
        transformBtn.style.opacity = '1';
        transformBtn.innerText = '자연화 변환';
        if (resultView) resultView.innerHTML = '변환을 실행하시면 김대필의 정교한 교정을 거쳐 목적에 맞게 다듬어진 설득력 있는 문장이 이곳에 나타납니다.';
      }
    });
  });

  // 6. 웹페이지에 삽입 버튼
  insertBtn.addEventListener('click', () => {
    if (!latestHumanizedText) {
      alert('먼저 자연화 변환을 수행해주세요.');
      return;
    }
    insertTextToActiveElement(latestHumanizedText);
    showNotification('웹페이지의 입력창에 텍스트가 반영되었습니다!');
  });

  // 7. DOCX 다운로드
  docxBtn.addEventListener('click', () => {
    const originalText = originalInput.value;
    if (!originalText || !latestHumanizedText) {
      alert('다운로드할 자연화 변환 데이터가 존재하지 않습니다.');
      return;
    }
    downloadDocx(originalText, latestHumanizedText);
  });

  // 8. 프로필 데이터 자동 저장 및 복구
  // 복구
  updateProfileFields(shadow, currentDetectedMode);
  updateCharCounts(); // 초기 복구 시점에 글자 수 카운팅 계산

  const profilePersona = shadow.getElementById('cdp-profile-persona');

  // 변경 이벤트 시 자동 저장
  const saveProfile = () => {
    const mode = currentDetectedMode;
    const data = {};
    data[`${mode}_profileTone`] = profileTone.value;
    data[`${mode}_profileExp`] = profileExp.value;
    data[`${mode}_profileTarget`] = profileTarget.value;
    data[`${mode}_profileJob`] = profileJob.value;
    data[`${mode}_profileEpisode`] = profileEpisode.value;
    data[`${mode}_profilePersona`] = profilePersona.value;
    
    // 호환성을 위해 기본 키로도 동시 저장하여 기존 백그라운드와의 마찰 제거
    data['profileTone'] = profileTone.value;
    data['profileExp'] = profileExp.value;
    data['profileTarget'] = profileTarget.value;
    data['profileJob'] = profileJob.value;
    data['profileEpisode'] = profileEpisode.value;
    data['profilePersona'] = profilePersona.value;

    chrome.storage.local.set(data);
  };
  profileTone.addEventListener('input', saveProfile);
  profileExp.addEventListener('input', saveProfile);
  profileTarget.addEventListener('input', saveProfile);
  profileJob.addEventListener('input', saveProfile);
  profileEpisode.addEventListener('input', saveProfile);
  if (profilePersona) {
    profilePersona.addEventListener('change', saveProfile);
  }

  // 9. 최근 변환 내역 로드 및 삭제/복사 바인딩
  loadAndRenderHistory(shadow);

  const historyList = shadow.getElementById('cdp-history-list');
  if (historyList) {
    historyList.addEventListener('click', (e) => {
      const target = e.target;
      if (target.classList.contains('cdp-history-copy-btn')) {
        const text = target.getAttribute('data-text');
        navigator.clipboard.writeText(text).then(() => {
          showNotification('내역이 클립보드에 복사되었습니다!');
        });
      } else if (target.classList.contains('cdp-history-del-btn')) {
        const logId = parseInt(target.getAttribute('data-id'), 10);
        chrome.storage.local.get(['historyLogs'], (res) => {
          const logs = res.historyLogs || [];
          const updatedLogs = logs.filter(item => item.id !== logId);
          chrome.storage.local.set({ historyLogs: updatedLogs }, () => {
            loadAndRenderHistory(shadow);
            showNotification('내역이 삭제되었습니다.');
          });
        });
      }
    });
  }
}

/**
 * 사이드바 모드 UI 강제 업데이트
 */
function updateSidebarModeUI(mode, confidence) {
  if (!sidebarRoot) return;
  const shadow = sidebarRoot.shadowRoot;
  if (!shadow) return;

  const modeSelect = shadow.getElementById('cdp-mode-select');
  const confidenceBadge = shadow.getElementById('cdp-confidence-badge');

  if (modeSelect) {
    const prevMode = modeSelect.value;
    modeSelect.value = mode;
    if (confidenceBadge) {
      confidenceBadge.innerText = `신뢰도: ${confidence}%`;
    }
    // 실제 작성 모드가 변경되었을 때만 스토리지에서 새로운 모드 데이터를 불러와 필드를 갱신(덮어쓰기)합니다.
    if (prevMode !== mode) {
      updateProfileFields(shadow, mode);
    }
  }
}

/**
 * 모드에 맞춰 동적으로 라벨 및 플레이스홀더를 변경하고 저장된 데이터를 가져오는 헬퍼
 */
function updateProfileFields(shadow, mode) {
  const profileTone = shadow.getElementById('cdp-profile-tone');
  const profileExp = shadow.getElementById('cdp-profile-exp');
  const profileTarget = shadow.getElementById('cdp-profile-target');
  const profileJob = shadow.getElementById('cdp-profile-job');
  const profileEpisode = shadow.getElementById('cdp-profile-episode');
  const profilePersona = shadow.getElementById('cdp-profile-persona');
  if (!profileTone || !profileExp || !profileTarget || !profileJob || !profileEpisode || !profilePersona) return;

  const labelTone = shadow.getElementById('cdp-label-tone');
  const labelExp = shadow.getElementById('cdp-label-exp');
  const labelTarget = shadow.getElementById('cdp-label-target');
  const labelJob = shadow.getElementById('cdp-label-job');
  const labelEpisode = shadow.getElementById('cdp-label-episode');

  if (mode === 'resume') {
    if (labelTone) labelTone.innerText = '원하는 말투/톤';
    profileTone.placeholder = '예: 차분하고 신뢰감을 주는 존댓말';
    
    if (labelExp) labelExp.innerText = '경력 및 백그라운드';
    profileExp.placeholder = '예: 3년차 프론트엔드 개발자';

    if (labelTarget) labelTarget.innerText = '지원회사';
    profileTarget.placeholder = '예: 네이버';

    if (labelJob) labelJob.innerText = '업직종';
    profileJob.placeholder = '예: IT/프론트엔드 개발자';
    
    if (labelEpisode) labelEpisode.innerText = '핵심 강점/에피소드';
    profileEpisode.placeholder = '자소서에 녹여내고 싶은 나만의 구체적인 에피소드나 역량 키워드';
  } else if (mode === 'email') {
    if (labelTone) labelTone.innerText = '이메일 말투/톤';
    profileTone.placeholder = '예: 격식 있고 정중한 비즈니스 톤';
    
    if (labelExp) labelExp.innerText = '발신자 직무/직책 및 회사';
    profileExp.placeholder = '예: ABC테크 마케팅팀 대리';

    if (labelTarget) labelTarget.innerText = '수신자 정보';
    profileTarget.placeholder = '예: 프로젝트 협력사';

    if (labelJob) labelJob.innerText = '관계/직급';
    profileJob.placeholder = '예: 담당 실장님';
    
    if (labelEpisode) labelEpisode.innerText = '자주 쓰는 문맥/요건';
    profileEpisode.placeholder = '이메일 본문에 자주 들어가는 주요 요청사항이나 양식 안내';
  } else if (mode === 'sns') {
    if (labelTone) labelTone.innerText = '포스팅 말투/톤';
    profileTone.placeholder = '예: 친근하고 이웃 소통을 이끄는 반말';
    
    if (labelExp) labelExp.innerText = '채널 주제 및 타깃';
    profileExp.placeholder = '예: IT 테크 정보 리뷰 블로그';

    if (labelTarget) labelTarget.innerText = '채널 주제';
    profileTarget.placeholder = '예: IT 테크 정보 리뷰';

    if (labelJob) labelJob.innerText = '타깃 독자층 및 관심사';
    profileJob.placeholder = '예: 2030 IT/테크 얼리어답터';
    
    if (labelEpisode) labelEpisode.innerText = '해시태그 및 핵심 키워드';
    profileEpisode.placeholder = '포스팅에 자주 삽입하고 싶은 대표 키워드와 태그 목록';
  }

  // 로컬 스토리지에서 해당 모드의 데이터 불러오기
  chrome.storage.local.get([
    `${mode}_profileTone`, 
    `${mode}_profileExp`, 
    `${mode}_profileTarget`,
    `${mode}_profileJob`,
    `${mode}_profileEpisode`,
    `${mode}_profilePersona`
  ], (res) => {
    const activeEl = shadow.activeElement;
    if (activeEl !== profileTone) profileTone.value = res[`${mode}_profileTone`] || '';
    if (activeEl !== profileExp) profileExp.value = res[`${mode}_profileExp`] || '';
    if (activeEl !== profileTarget) profileTarget.value = res[`${mode}_profileTarget`] || '';
    if (activeEl !== profileJob) profileJob.value = res[`${mode}_profileJob`] || '';
    if (activeEl !== profileEpisode) profileEpisode.value = res[`${mode}_profileEpisode`] || '';
    if (activeEl !== profilePersona) profilePersona.value = res[`${mode}_profilePersona`] || 'professor';
  });
}

/**
 * 자연화 결과물 하이라이트 렌더링
 */
function renderHumanizedResult(shadow, text, warnings) {
  const resultView = shadow.getElementById('cdp-humanized-result');
  if (!resultView) return;

  let html = text;

  // 경고 알림 문구가 존재할 시 상단 경고 배너 삽입
  if (warnings && warnings.length > 0) {
    const warningBanner = `<div class="cdp-warning-banner" style="background-color: #FEF3C7; border: 1px solid #F59E0B; border-radius: 8px; padding: 8px 10px; margin-bottom: 12px; font-size: 11.5px; color: #92400E; display: flex; flex-direction: column; gap: 4px; box-sizing: border-box; line-height: 1.4;"><div style="font-weight: 700; display: flex; align-items: center; gap: 4px; border-bottom: 1px solid rgba(245, 158, 11, 0.3); padding-bottom: 4px; margin-bottom: 2px;">⚠️ 입력 문맥 분석 주의 알림</div><div style="display: flex; flex-direction: column; gap: 4px; text-align: left;">${warnings.map(w => `<div style="display: flex; gap: 6px; align-items: flex-start; line-height: 1.4;"><span style="color: #F59E0B; font-weight: bold; flex-shrink: 0;">•</span><span style="flex-grow: 1;">${w}</span></div>`).join('')}</div></div>`;
    html = warningBanner + html;
  }

  // 문맥에 맞게 개행 문자(\n)를 HTML br 태그로 변경하여 줄바꿈 적용
  const formattedHtml = html.replace(/\n/g, '<br/>');
  resultView.innerHTML = formattedHtml;
}

/**
 * 대시보드 게이지 업데이트
 */
function updateDashboard(shadow, aiScore, atsScore) {
  const aiVal = shadow.getElementById('cdp-ai-score-val');
  const aiFill = shadow.getElementById('cdp-ai-score-fill');
  const atsVal = shadow.getElementById('cdp-ats-score-val');
  const atsFill = shadow.getElementById('cdp-ats-score-fill');

  if (aiVal && aiFill) {
    aiVal.innerText = `${aiScore}%`;
    aiFill.style.width = `${aiScore}%`;
    // AI 탐지율은 낮을수록 안전하므로, 60% 이상이면 적색(위험), 미만이면 녹색(안전)
    if (aiScore >= 60) {
      aiFill.className = 'cdp-gauge-bar-fill cdp-gauge-red';
    } else {
      aiFill.className = 'cdp-gauge-bar-fill cdp-gauge-green';
    }
  }

  if (atsVal && atsFill) {
    atsVal.innerText = `${atsScore}%`;
    atsFill.style.width = `${atsScore}%`;
    // ATS 매칭 적합도는 높을수록 좋으므로, 60% 이상이면 녹색(우수), 미만이면 적색(부족)
    if (atsScore >= 60) {
      atsFill.className = 'cdp-gauge-bar-fill cdp-gauge-green';
    } else {
      atsFill.className = 'cdp-gauge-bar-fill cdp-gauge-red';
    }
  }
}

/**
 * 텍스트 삽입 기능
 */
function insertTextToActiveElement(text) {
  const el = activeInputEl || document.activeElement;
  if (!el) return;

  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (el.isContentEditable) {
    el.innerText = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/**
 * DOCX 다운로드 생성 및 저장 기능 (Blob 기반 XML 구현)
 */
function downloadDocx(original, humanized) {
  const docxContent = `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
    <head>
      <title>김대필 자연화 보고서</title>
      <!--[if gte mso 9]>
      <xml>
        <w:WordDocument>
          <w:View>Print</w:View>
          <w:Zoom>100</w:Zoom>
        </w:WordDocument>
      </xml>
      <![endif]-->
      <style>
        body { font-family: 'Malgun Gothic', Arial, sans-serif; line-height: 1.5; padding: 20px; }
        h1 { color: #1E40AF; border-bottom: 2px solid #1E40AF; padding-bottom: 8px; }
        .section { margin-bottom: 24px; padding: 12px; border: 1px solid #E5E7EB; border-radius: 6px; background-color: #F9FAFB; }
        .title { font-weight: bold; color: #1F2937; margin-bottom: 8px; }
        .content { font-size: 11pt; color: #374151; white-space: pre-wrap; }
        .highlight { background-color: #D1FAE5; }
      </style>
    </head>
    <body>
      <h1>김대필 (ContextWrite) 자연화 변환 리포트</h1>
      <p style="color: #6B7280; font-size: 9pt;">작성 시간: ${new Date().toLocaleString()}</p>
      
      <div class="section">
        <div class="title">[ 원본 AI 초안 ]</div>
        <div class="content">${original.replace(/\n/g, '<br/>')}</div>
      </div>
      
      <div class="section" style="border-color: #0D9488;">
        <div class="title" style="color: #0D9488;">[ 자연화 변환 결과물 ]</div>
        <div class="content">${humanized.replace(/\n/g, '<br/>')}</div>
      </div>
    </body>
    </html>
  `;

  const blob = new Blob(['\ufeff' + docxContent], {
    type: 'application/msword;charset=utf-8'
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `김대필_자연화결과_${new Date().toISOString().slice(0, 10)}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 간단한 하단 커스텀 알림 토스트 렌더러
 */
function showNotification(msg) {
  if (!sidebarRoot) return;
  const shadow = sidebarRoot.shadowRoot;
  if (!shadow) return;

  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '20px';
  toast.style.right = '400px'; // 사이드바 옆에 뜨도록 조정
  toast.style.backgroundColor = '#1F2937';
  toast.style.color = '#FFFFFF';
  toast.style.padding = '8px 16px';
  toast.style.borderRadius = '6px';
  toast.style.fontSize = '12px';
  toast.style.zIndex = '10000001';
  toast.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
  toast.style.transition = 'opacity 0.3s';
  toast.innerText = msg;

  shadow.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/**
 * 사이드바 제어 함수들
 */
function toggleSidebar() {
  if (!sidebarContainer) return;
  if (sidebarContainer.classList.contains('cdp-open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function openSidebar() {
  if (!sidebarContainer) return;
  if (sidebarRoot) {
    const targetWidth = sidebarContainer.style.width || '380px';
    sidebarRoot.style.width = targetWidth;
    sidebarRoot.style.height = '100vh';
  }
  sidebarContainer.classList.add('cdp-open');
}

function closeSidebar() {
  if (!sidebarContainer) return;
  sidebarContainer.classList.remove('cdp-open');
  // 슬라이드 애니메이션(0.3s)이 완료된 후 sidebarRoot 크기를 0으로 축소하여 페이지 클릭 간섭 방지
  setTimeout(() => {
    if (sidebarContainer && !sidebarContainer.classList.contains('cdp-open') && sidebarRoot) {
      sidebarRoot.style.width = '0';
      sidebarRoot.style.height = '0';
    }
  }, 300);
}

/**
 * 최근 변환 내역 로드 및 렌더링
 */
function loadAndRenderHistory(shadow) {
  const historyList = shadow.getElementById('cdp-history-list');
  if (!historyList) return;

  chrome.storage.local.get(['saveHistoryEnabled', 'historyLogs'], (res) => {
    const saveEnabled = res.saveHistoryEnabled !== false; // 기본값 true
    const logs = res.historyLogs || [];

    if (!saveEnabled) {
      historyList.innerHTML = `<div style="font-size: 11px; color: #94A3B8; text-align: center; padding: 16px 0;">설정에서 '작성 내역 자동 저장'이 비활성화 상태입니다.</div>`;
      return;
    }

    if (logs.length === 0) {
      historyList.innerHTML = `<div style="font-size: 11px; color: #94A3B8; text-align: center; padding: 16px 0;">저장된 최근 작성 내역이 없습니다.</div>`;
      return;
    }

    let html = '';
    logs.forEach(log => {
      let modeClass = 'resume';
      let modeName = '자소서';
      if (log.mode === 'email') { modeClass = 'email'; modeName = '이메일'; }
      if (log.mode === 'sns') { modeClass = 'sns'; modeName = 'SNS/블로그'; }

      // 텍스트 이스케이프 처리 (HTML 태그 오작동 방지)
      const cleanHumanizedText = (log.humanizedText || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

      html += `
        <div class="cdp-history-item">
          <div class="cdp-history-item-header">
            <span class="cdp-history-badge ${modeClass}">${modeName}</span>
            <span>${log.timestamp || ''}</span>
          </div>
          <div class="cdp-history-body">${cleanHumanizedText}</div>
          <div class="cdp-history-actions">
            <button class="cdp-history-btn cdp-history-copy-btn" data-text="${cleanHumanizedText}">복사</button>
            <button class="cdp-history-btn cdp-history-del-btn" data-id="${log.id}">삭제</button>
          </div>
        </div>
      `;
    });

    historyList.innerHTML = html;
  });
}

/**
 * 신규 변환 결과를 내역에 추가 저장
 */
function saveToHistory(shadow, mode, original, humanized) {
  chrome.storage.local.get(['saveHistoryEnabled', 'historyLogs'], (res) => {
    const saveEnabled = res.saveHistoryEnabled !== false;
    if (!saveEnabled) return;

    const logs = res.historyLogs || [];
    const dateStr = new Date().toLocaleString('ko-KR', { hour12: false }).slice(2, 16); // "26. 07. 07. 09:50"

    const newLog = {
      id: Date.now(),
      timestamp: dateStr,
      mode: mode,
      originalText: original,
      humanizedText: humanized
    };

    // 앞에 추가하고 최대 20개로 제한
    const updatedLogs = [newLog, ...logs].slice(0, 20);

    chrome.storage.local.set({ historyLogs: updatedLogs }, () => {
      loadAndRenderHistory(shadow);
    });
  });
}
