---
name: chrome-extension-dev
description: 크롬 확장 프로그램(Manifest V3) 개발 및 백그라운드/컨텐츠 스크립트 디버깅과 로직 통합을 보조하는 전문 스킬입니다.
---

# 크롬 확장 프로그램(Manifest V3) 개발 스킬 지침

본 지침은 Manifest V3 규격을 충족하는 크롬 확장 프로그램(김대필)을 개발, 수정 및 빌드할 때 사용하는 가이드입니다.

## 1. 아키텍처 핵심 구성 요소 개발 지침

### 1.1 콘텐츠 스크립트 (Content Script)
- **역할:** 웹페이지 DOM에 직접 접근하여 활성화된 입력 폼(`activeElement`)을 감지하고, 플로팅 삽입 버튼을 렌더링합니다.
- **포커스 감지 예제:**
  ```javascript
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el.tagName === 'TEXTAREA' || el.isContentEditable) {
      // 500ms 디바운스 적용 후 백그라운드로 콘텍스트 수집 요청
      debounceDetectContext(el);
    }
  });
  ```

### 1.2 백그라운드 서비스 워커 (Background Service Worker)
- **역할:** 브라우저 백그라운드에서 실행되며 외부 AI API 연동, 스마트 자동 모드 판별 로직(Rule/LLM 하이브리드)을 처리합니다.
- **메시지 리스너 구현:**
  - `chrome.runtime.onMessage.addListener((message, sender, sendResponse) => { ... })` 패턴을 안전하게 활용하고 비동기 응답 시 `return true;`를 유지합니다.

---

## 2. API 통신 및 에러 핸들링
- 네트워크 요청 실패 및 권한 거부 예외 처리를 명확히 구현합니다.
- 사용자의 민감한 개인 정보(비밀번호, 개인 인증 토큰 등)가 API 로그에 노출되지 않도록 전처리 마스킹을 수행합니다.

---

## 3. 로컬 테스트 및 로드 방법
1. 브라우저 주소창에 `chrome://extensions/` 접속
2. 우측 상단의 **개발자 모드 (Developer mode)** 활성화
3. **압축해제된 확장 프로그램을 로드합니다 (Load unpacked)** 버튼 클릭 후 프로젝트 디렉토리 선택
