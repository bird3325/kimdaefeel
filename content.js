// 김대필 (ContextWrite) Content Script

let activeInputEl = null;      // 현재 포커스된 입력창 엘리먼트
let debounceTimer = null;      // 맥락 감지용 디바운스 타이머
let latestHumanizedText = '';  // 가장 최근에 변환 완료된 텍스트
let isAutoModeEnabled = true;  // 자동 모드 스위칭 활성화 여부
let currentDetectedMode = 'resume';

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
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggle-sidebar') {
      toggleSidebar();
    }
  });

  // 사이드바 DOM 구조 생성
  createSidebarDOM();
}

/**
 * 1. 입력창 포커스 감지 및 500ms 디바운스
 */
function handleFocusIn(e) {
  const el = e.target;
  
  // 비밀번호 입력창 및 민감 입력창 무시
  if (el.tagName === 'INPUT' && el.type === 'password') {
    hideFloatingButton();
    return;
  }

  if (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && el.type === 'text')) {
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
 * 2. 주변 컨텍스트 수집 및 백그라운드 전송
 */
function detectContextAndSync(el) {
  if (!el) return;

  const url = window.location.href;
  const title = document.title;
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
  if (!chrome.runtime || !chrome.runtime.id) {
    return;
  }

  // 백그라운드로 분석 요청
  try {
    const p = chrome.runtime.sendMessage({
      action: 'analyze-context',
      data: { url, title, placeholder, label: labelText }
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

    // 신뢰도가 80% 이상이고 자동 스위칭이 활성화되어 있을 때만 모드 자동 전환
    if (isAutoModeEnabled && response.confidence >= 80) {
      currentDetectedMode = response.mode;
      updateSidebarModeUI(response.mode, response.confidence);
    } else {
      updateSidebarModeUI(currentDetectedMode, response.confidence || 0);
    }

    // 미니 플로팅 아이콘 표시
    showFloatingButton(el);
  });
}

/**
 * 3. 미니 플로팅 버튼 생성 및 배치
 */
function showFloatingButton(targetEl) {
  if (!floatingBtn) {
    floatingBtn = document.createElement('div');
    floatingBtn.className = 'cdp-floating-btn';
    floatingBtn.title = '김대필 (자연화 텍스트 삽입)';
    
    // 번개 모양 또는 AI 아이콘 느낌의 간단한 SVG 삽입
    floatingBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
      </svg>
    `;

    // 클릭 시 가장 최근의 자연화 결과 텍스트 즉시 주입
    floatingBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      
      if (latestHumanizedText) {
        insertTextToActiveElement(latestHumanizedText);
        showNotification('자연화 텍스트가 삽입되었습니다!');
      } else {
        // 최근 결과물이 없으면 사이드바를 열어 입력을 유도
        openSidebar();
        showNotification('먼저 사이드바에서 자연화 변환을 수행해주세요.');
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

  // 입력창의 우측 하단 안쪽 또는 바로 밖에 배치
  const buttonSize = 28;
  const top = rect.top + scrollTop + rect.height - buttonSize - 6;
  const left = rect.left + scrollLeft + rect.width - buttonSize - 6;

  floatingBtn.style.top = `${top}px`;
  floatingBtn.style.left = `${left}px`;
}

/**
 * 4. 슬라이드인 사이드바 DOM 생성 (Shadow DOM 사용)
 */
function createSidebarDOM() {
  // 이미 생성되어 있다면 중복 방지
  if (document.getElementById('cdp-sidebar-root')) return;

  sidebarRoot = document.createElement('div');
  sidebarRoot.id = 'cdp-sidebar-root';
  
  // Shadow Host 자체에 대한 포지셔닝 보강 (자식 fixed 요소들의 정상 노출 보증)
  sidebarRoot.style.position = 'fixed';
  sidebarRoot.style.top = '0';
  sidebarRoot.style.right = '0';
  sidebarRoot.style.height = '0';
  sidebarRoot.style.width = '0';
  sidebarRoot.style.zIndex = '99999999';
  
  document.body.appendChild(sidebarRoot);

  // Shadow root 열기 (격리된 스타일 보장)
  const shadow = sidebarRoot.attachShadow({ mode: 'open' });

  // CSS 직접 인라인 주입 (CSP 우회 및 렌더링 무결성 보증)
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    /* 1. 미니 플로팅 버튼 스타일 */
    .cdp-floating-btn {
      position: absolute;
      z-index: 10000000;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background-color: #1E40AF;
      border: 2px solid #FFFFFF;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.15);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s cubic-bezier(0.25, 0.8, 0.25, 1), background-color 0.2s;
      pointer-events: auto;
    }
    .cdp-floating-btn:hover {
      transform: scale(1.15);
      background-color: #0D9488;
    }
    .cdp-floating-btn svg {
      width: 14px;
      height: 14px;
    }

    /* 2. 슬라이드인 사이드바 컨테이너 */
    .cdp-sidebar-container {
      position: fixed;
      top: 0;
      right: 0;
      width: 380px;
      height: 100vh;
      background-color: #FFFFFF;
      box-shadow: -4px 0 20px rgba(0, 0, 0, 0.15);
      z-index: 9999999;
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
      font-family: Arial, sans-serif;
      color: #1F2937;
      box-sizing: border-box;
    }
    .cdp-sidebar-container.cdp-open {
      transform: translateX(0);
    }

    /* 3. 헤더 영역 */
    .cdp-header {
      padding: 16px;
      background-color: #1E40AF;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #E5E7EB;
    }
    .cdp-header-title {
      font-size: 16px;
      font-weight: bold;
      margin: 0;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .cdp-header-controls {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 12px;
    }

    /* 토글 스위치 */
    .cdp-switch {
      position: relative;
      display: inline-block;
      width: 36px;
      height: 20px;
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
      background-color: #9CA3AF;
      transition: .3s;
      border-radius: 20px;
    }
    .cdp-slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .3s;
      border-radius: 50%;
    }
    input:checked + .cdp-slider {
      background-color: #0D9488;
    }
    input:checked + .cdp-slider:before {
      transform: translateX(16px);
    }
    .cdp-close-btn {
      background: none;
      border: none;
      color: #FFFFFF;
      font-size: 20px;
      cursor: pointer;
      line-height: 1;
      padding: 0;
      margin-left: 10px;
    }

    /* 4. 사이드바 바디 */
    .cdp-body {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 20px;
      background-color: #F9FAFB;
    }
    .cdp-section {
      background-color: #FFFFFF;
      border-radius: 8px;
      padding: 14px;
      border: 1px solid #E5E7EB;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }
    .cdp-section-title {
      font-size: 14px;
      font-weight: bold;
      color: #1F2937;
      margin-top: 0;
      margin-bottom: 12px;
    }

    /* 5. 모드 셀렉터 */
    .cdp-select {
      width: 100%;
      padding: 8px 12px;
      font-size: 14px;
      border-radius: 6px;
      border: 1px solid #E5E7EB;
      background-color: #FFFFFF;
      color: #1F2937;
      outline: none;
      cursor: pointer;
    }
    .cdp-select:focus {
      border-color: #1E40AF;
    }

    /* 6. 에디터 영역 */
    .cdp-editor-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .cdp-textarea-wrapper {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .cdp-label {
      font-size: 12px;
      font-weight: bold;
      color: #4B5563;
    }
    .cdp-textarea {
      width: 100%;
      height: 90px;
      padding: 8px 10px;
      font-size: 14px;
      line-height: 1.25;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      resize: none;
      box-sizing: border-box;
      outline: none;
    }
    .cdp-textarea:focus {
      border-color: #1E40AF;
    }
    .cdp-result-view {
      min-height: 90px;
      padding: 8px 10px;
      font-size: 14px;
      line-height: 1.25;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      background-color: #FFFFFF;
      white-space: pre-wrap;
      word-break: break-all;
      box-sizing: border-box;
    }
    .cdp-highlight {
      background-color: rgba(13, 148, 136, 0.1);
      border-bottom: 1px dashed #0D9488;
      padding: 1px 2px;
      border-radius: 2px;
    }
    .cdp-level-group {
      display: flex;
      gap: 8px;
    }
    .cdp-level-btn {
      flex: 1;
      padding: 6px 0;
      font-size: 12px;
      border: 1px solid #E5E7EB;
      background-color: #FFFFFF;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .cdp-level-btn.cdp-active {
      background-color: #1E40AF;
      color: #FFFFFF;
      border-color: #1E40AF;
    }
    .cdp-level-btn.cdp-active-mint {
      background-color: #0D9488;
      color: #FFFFFF;
      border-color: #0D9488;
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
      gap: 4px;
    }
    .cdp-gauge-header {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: #4B5563;
    }
    .cdp-gauge-bar-bg {
      width: 100%;
      height: 8px;
      background-color: #E5E7EB;
      border-radius: 4px;
      overflow: hidden;
    }
    .cdp-gauge-bar-fill {
      height: 100%;
      width: 0%;
      border-radius: 4px;
      transition: width 0.5s ease-out, background-color 0.3s;
    }
    .cdp-gauge-green {
      background-color: #10B981;
    }
    .cdp-gauge-red {
      background-color: #EF4444;
    }

    /* 8. 프로필 학습 패널 */
    .cdp-profile-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .cdp-input {
      width: 100%;
      padding: 6px 8px;
      font-size: 12px;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      box-sizing: border-box;
      outline: none;
    }
    .cdp-input:focus {
      border-color: #1E40AF;
    }

    /* 9. 푸터 영역 */
    .cdp-footer {
      padding: 16px;
      border-top: 1px solid #E5E7EB;
      background-color: #FFFFFF;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .cdp-primary-btn {
      width: 100%;
      padding: 10px 0;
      font-size: 14px;
      font-weight: bold;
      border: none;
      border-radius: 6px;
      background-color: #0D9488;
      color: #FFFFFF;
      cursor: pointer;
      transition: background-color 0.2s;
      text-align: center;
    }
    .cdp-primary-btn:hover {
      background-color: #0B7A70;
    }
    .cdp-secondary-btn {
      width: 100%;
      padding: 8px 0;
      font-size: 12px;
      border: 1px solid #E5E7EB;
      border-radius: 6px;
      background-color: #FFFFFF;
      color: #4B5563;
      cursor: pointer;
      transition: all 0.2s;
      text-align: center;
    }
    .cdp-secondary-btn:hover {
      background-color: #F9FAFB;
      border-color: #D1D5DB;
    }
    .cdp-btn-row {
      display: flex;
      gap: 8px;
    }
    .cdp-btn-row button {
      flex: 1;
    }
  `;
  shadow.appendChild(styleEl);

  // 사이드바 컨테이너 생성
  sidebarContainer = document.createElement('div');
  sidebarContainer.className = 'cdp-sidebar-container';
  
  // HTML 구성
  sidebarContainer.innerHTML = `
    <!-- 헤더 -->
    <div class="cdp-header">
      <h3 class="cdp-header-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align: middle;">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
        </svg>
        김대필 (ContextWrite)
      </h3>
      <div class="cdp-header-controls">
        <span>자동 모드</span>
        <label class="cdp-switch">
          <input type="checkbox" id="cdp-auto-toggle" checked>
          <span class="cdp-slider"></span>
        </label>
        <span id="cdp-confidence-badge" style="font-weight: bold; background: #0D9488; padding: 2px 6px; border-radius: 10px;">신뢰도: -</span>
        <button class="cdp-close-btn" id="cdp-close-btn">&times;</button>
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

      <!-- 2. 에디터 영역 (비교 뷰) -->
      <div class="cdp-section cdp-editor-section">
        <p class="cdp-section-title">AI 초안 자연화 (Humanize)</p>
        
        <div class="cdp-textarea-wrapper">
          <label class="cdp-label">Original AI 초안</label>
          <textarea class="cdp-textarea" id="cdp-original-input" placeholder="여기에 어색한 AI 초안을 입력하거나 문장을 작성하세요."></textarea>
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
          <label class="cdp-label">Humanized 결과 (민트색: 개선된 문맥)</label>
          <div class="cdp-result-view" id="cdp-humanized-result">변환을 실행하면 여기에 인간다운 자연스러운 문장으로 변환되어 나타납니다.</div>
        </div>
      </div>

      <!-- 3. 분석 대시보드 -->
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

      <!-- 4. 프로필 학습 패널 -->
      <div class="cdp-section">
        <p class="cdp-section-title">개인 맞춤형 프로필 학습</p>
        <div class="cdp-profile-form">
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="cdp-label">원하는 말투/톤</label>
            <input type="text" class="cdp-input" id="cdp-profile-tone" placeholder="예: 정중하고 부드러운 격식체">
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="cdp-label">경력 및 백그라운드</label>
            <input type="text" class="cdp-input" id="cdp-profile-exp" placeholder="예: 3년차 프론트엔드 개발자">
          </div>
          <div style="display: flex; flex-direction: column; gap: 4px;">
            <label class="cdp-label">핵심 강점/에피소드</label>
            <textarea class="cdp-textarea" id="cdp-profile-episode" placeholder="자주 녹여내고 싶은 나만의 핵심 에피소드나 키워드를 적어주세요." style="height: 60px; font-size:12px;"></textarea>
          </div>
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
  const profileEpisode = shadow.getElementById('cdp-profile-episode');

  let selectedLevel = 'light';

  // 1. 닫기 버튼
  closeBtn.addEventListener('click', closeSidebar);

  // 2. 자동 모드 스위칭 토글
  autoToggle.addEventListener('change', (e) => {
    isAutoModeEnabled = e.target.checked;
  });

  // 3. 모드 셀렉터 변경
  modeSelect.addEventListener('change', (e) => {
    currentDetectedMode = e.target.value;
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

    // 로컬 스토리지에 저장된 유저 프로필 로드
    chrome.storage.local.get(['profileTone', 'profileExp', 'profileEpisode'], (res) => {
      const profile = {
        tone: res.profileTone || '',
        experience: res.profileExp || '',
        episode: res.profileEpisode || ''
      };

      // 0. 확장 프로그램 컨텍스트 유효성 검사
      if (!chrome.runtime || !chrome.runtime.id) {
        alert('확장 프로그램 연결이 끊어졌습니다. 페이지를 새로고침해주세요.');
        return;
      }

      // 백그라운드로 자연화 요청
      try {
        const p = chrome.runtime.sendMessage({
          action: 'humanize',
          data: {
            text: text,
            level: selectedLevel,
            mode: currentDetectedMode,
            profile: profile
          }
        }, (response) => {
          if (chrome.runtime.lastError) {
            alert('백그라운드 서비스 워커와의 통신 실패. 페이지를 새로고침한 후 다시 시도해 주세요.');
            return;
          }
          if (!response || !response.success) {
            alert('변환 요청 중 오류가 발생했습니다.');
            return;
          }

          // 결과 반영 및 하이라이트 효과 적용
          latestHumanizedText = response.humanizedText;
          renderHumanizedResult(shadow, response.humanizedText);

          // 분석 대시보드 게이지 업데이트
          updateDashboard(shadow, response.aiDetectionScore, response.atsScore);
        });

        if (p && typeof p.catch === 'function') {
          p.catch(err => {
            alert('백그라운드 연결 오류가 발생했습니다. 페이지를 새로고침해주세요.');
          });
        }
      } catch (err) {
        console.error(err);
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
  chrome.storage.local.get(['profileTone', 'profileExp', 'profileEpisode'], (res) => {
    if (res.profileTone) profileTone.value = res.profileTone;
    if (res.profileExp) profileExp.value = res.profileExp;
    if (res.profileEpisode) profileEpisode.value = res.profileEpisode;
  });

  // 변경 이벤트 시 자동 저장
  const saveProfile = () => {
    chrome.storage.local.set({
      profileTone: profileTone.value,
      profileExp: profileExp.value,
      profileEpisode: profileEpisode.value
    });
  };
  profileTone.addEventListener('input', saveProfile);
  profileExp.addEventListener('input', saveProfile);
  profileEpisode.addEventListener('input', saveProfile);
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

  if (modeSelect) modeSelect.value = mode;
  if (confidenceBadge) {
    confidenceBadge.innerText = `신뢰도: ${confidence}%`;
  }
}

/**
 * 자연화 결과물 하이라이트 렌더링
 */
function renderHumanizedResult(shadow, text) {
  const resultView = shadow.getElementById('cdp-humanized-result');
  if (!resultView) return;

  // 개선된 어휘나 문맥 단어들을 연한 민트색 배경으로 하이라이팅하는 모크 렌더러
  // 결과물 텍스트에서 괄호 처리된 부분이나 핵심 변경 표현들을 감지하여 span 처리
  let html = text
    .replace(/(\[.*?\])/g, '<span class="cdp-highlight">$1</span>')
    .replace(/(할 수 있었습니다|프로세스를 효율적으로|정중하고 부드러운)/g, '<span class="cdp-highlight">$1</span>');

  resultView.innerHTML = html;
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
  a.download = `김대필_자연화결과_${new Date().toISOString().slice(0,10)}.doc`;
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
  sidebarContainer.classList.add('cdp-open');
}

function closeSidebar() {
  if (!sidebarContainer) return;
  sidebarContainer.classList.remove('cdp-open');
}
